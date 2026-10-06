# Shopify controlled development checkout protocol

Local implementation: PASS (44 focused fixture tests, TypeScript typecheck). External acceptance: BLOCKED_EXTERNAL. No external API request or browser checkout was run. Fixture evidence is explicitly labelled `local_fixture`; runtime evidence uses `fresh_external` and provider environment `test`.

## Integration APIs

`createShopifyExecutor(env, options?)` is exported from `src/execution/shopify/index.ts` and implements the core `CommerceExecutor` port. Default dependencies are Storefront GraphQL, independent read-only Admin GraphQL and a Playwright-core driver. Options provide clock/fetch and local fixture seams; overriding clients or driver labels evidence `local_fixture`. Keep those seams out of production wiring.

`createShopifyWebhookRouter({storeDomain, secret, onReconcile})` is exported from `src/execution/shopify/webhook.ts`. Mount its `/` POST handler at the Shopify webhook prefix **before** global `express.json()`:

```ts
app.use('/v1/webhooks/shopify', createShopifyWebhookRouter({
  storeDomain, secret: shopifyClientSecret, onReconcile: enqueueReadback,
}));
app.use(express.json());
```

The router consumes exact raw bytes with a 256 KiB limit, rejects compression and JSON-parsed bodies, verifies HMAC-SHA256 with timing-safe comparison, requires the configured shop header and permits only `orders/paid` / `orders/updated`. It returns 202 only after the callback resolves; failed enqueue returns 503 so Shopify can retry. The callback receives `{orderId, quoteNonce, deliveryId, topic}` only. Payload payment claims, addresses and emails never reach it.

The core hook must durably enqueue independent retrieval for a matching Shopify attempt/purchase. If an unknown checkout has no order GID yet, the quote nonce can locate the server-held quote reference. Duplicate and out-of-order hints may enqueue again: deduplication and terminal-state guards belong to core jobs/journal. The callback must never finalize commerce, release capacity or write ledger entries from webhook payload values. The adapter imports no core persistence or ledger code.

## Safety and behavior

- Only a configured `*.myshopify.com` domain is used. Storefront/Admin fetches reject redirects. Checkout URLs require HTTPS, the exact configured host, no credentials/port, and a checkout/cart checkout path. Browser main navigation stays on that store; subresources are limited to the store and a small Shopify CDN/checkout list. New hosted asset domains fail closed and require verified review.
- `SHOPIFY_DEV_STORE_CONFIRMED=true` and `SHOPIFY_BOGUS_GATEWAY_ENABLED=true` explicitly gate the lane. No real card inputs exist. Synthetic fulfillment requires `Test Buyer`, an `example.com` email, no phone, and a province code where supplied. Use only a synthetic shipping address. No page screenshots, traces, video or HAR are enabled; logs accept step names only.
- Search produces indicative item costs. Quote creates a buyer/address-bound Storefront cart, selects deterministic cheapest shipping, then requires non-estimated total/subtotal/tax, one delivery group, explicit tax balancing item + shipping + tax, no discounts/duties and the requested delivery address. Unsupported or estimated configurations remain non-executable. Tax fields are deprecated but currently available; their removal must fail closed until a replacement quote procedure is validated.
- Private references contain cart handles/checkout URL (including Shopify cart secret) and hashes of fulfillment/cart state. They must remain server-held. Public quote summaries do not echo address, email or cart credentials.
- Execution compares the original cart state, fulfillment hash, selected shipping, exact currency and total. It checks again immediately before the pay checkpoint. The browser selects the quoted shipping title, requires the quoted currency next to the final displayed total, confirms the test gateway, stops on CAPTCHA/OTP and durably awaits `pay_click` before one payment click.
- `shopify_started` is durable before browser work. A resumed attempt with that checkpoint or `pay_click` only retrieves; it never launches checkout again. A failure after `pay_click` is unknown and retains exposure. In-process concurrent calls share one execution result.
- Browser confirmation is a locator hint, never payment evidence. Admin readback binds an order's `customAttributes.t2o_quote` to the quote nonce. It requires `test=true`, `displayFinancialStatus=PAID`, matching presentment-currency total, and successful test Bogus SALE/CAPTURE transactions summing exactly to that total. Authorization, pending, manual-paid, different currency/amount/gateway, refund/void, multiple nonce matches and missing orders remain unknown. Test payment is `simulated_paid` and proves no bank clearing or physical fulfillment.
- The Admin client mints and caches a client-credentials token and uses queries only. No order creation, draft completion or paid-marking mutation is present. An order GID checkpoint enables direct retrieval. Before one exists, recent search is limited to 25 matching orders; an older hidden candidate remains unknown and requires operator review rather than re-payment.

## External blockers and acceptance

Required configuration: `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_STOREFRONT_TOKEN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_BROWSER_EXECUTABLE`, and both explicit development/Bogus flags. Optional `SHOPIFY_STORE_PASSWORD`, `SHOPIFY_HEADLESS` (default true), `SHOPIFY_API_VERSION` (default 2026-10). No Shopify environment variables were provisioned in this lane.

The development store and app must belong to the same Shopify organization for client-credentials authentication. The installed app needs `read_orders`; the Storefront token needs catalog/cart access. Configure test catalog inventory, shipping and tax so the chosen destination returns a final non-estimated cart total. Activate the Bogus/Test payment gateway and provision a compatible Chromium executable. The precise hosted checkout selectors, embedded card-field frame names and outbound asset host list have not been validated live. Updated gateway branding might change selectors. A missing or changed selector stops execution; never relax test gating to make a live checkout pass.

External acceptance must demonstrate a real development checkout and independent readback, unchanged quote amount/fulfillment, successful test SALE/CAPTURE, redacted evidence, and a signed webhook traversing the raw-body route. If browser checkout becomes uncertain, inspect/retrieve the original order; never rerun the payment click. No checkout was attempted without credentials and a configured development-store boundary.

## Official references checked 2026-10-06

- [Storefront CartCost](https://shopify.dev/docs/api/storefront/latest/objects/CartCost): estimate flags, totals and deprecated tax/duty fields.
- [CartSelectableAddressInput](https://shopify.dev/docs/api/storefront/latest/input-objects/CartSelectableAddressInput) and [CartDeliveryGroup](https://shopify.dev/docs/api/storefront/latest/objects/CartDeliveryGroup): selected one-time address and delivery options.
- [Admin OrderTransaction](https://shopify.dev/docs/api/admin-graphql/latest/objects/OrderTransaction): transaction kind/status/test and amount currency fields.
- [Client credentials authentication](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant): own-organization store/app restriction and token lifecycle.
- [Webhook delivery verification](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries): raw-byte HMAC and idempotent delivery handling.
- [Shopify test payment gateway](https://help.shopify.com/en/manual/checkout-settings/test-orders/payments-test-mode): simulated payment inputs and test-order limits.

## Checks

```powershell
npm run typecheck
npm exec vitest run tests/unit/shopify.test.ts tests/unit/shopify-webhook.test.ts tests/unit/shopify-browser.test.ts
npm test
npm run build
```

Focused coverage: exact shipping/tax arithmetic, estimated/discount/duty rejection, changed quote/fulfillment, spend/config/test identity gates, concurrent execution, durable checkpoint failure, uncertain payment/restart/readback, unpaid/manual/authorized/pending/mismatched evidence, order nonce binding, URL/redirect controls, real raw-body HTTP HMAC, duplicates/out-of-order callbacks, retryable enqueue, and mocked browser checkpoint-before-click/challenge/gateway/navigation behavior.
