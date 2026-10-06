# Shopify Global Catalog → Capsule sandbox evidence

Date: 2026-10-06, Asia/Singapore (UTC+8). Lane branch: `build/shopify-global-sandbox`. Verified remote base before branch creation: `origin/build/e2e-acceptance` at `0afd377681fe0e27e0ea86cf2cfaa34cdb970769`. No merges or changes to other lanes.

## Verdict

| Boundary | Verdict | Evidence |
| --- | --- | --- |
| Global Catalog access / discovery | PASS | Real official search and selected-variant lookup |
| Shadow product | PASS | One native-ID product, published; independent Admin and Storefront readback |
| Exact real sandbox quote | FAIL / unresolved guard | Checkout summary rejected; no immutable quote persisted |
| Sandbox execution | NOT_RUN | No funding, card entry, Pay or order in this lane |
| Overall lane | PARTIAL | Order and real receipt acceptance remain unproved |

Funding is `local_fixture` only in local test composition. No external chain transaction or real Cardano call occurred. Real discovery and shadow evidence must not be presented as real order evidence.

## Official access verification

Product: Shopify Global Catalog over Universal Commerce Protocol MCP. Endpoint: `POST https://catalog.shopify.com/api/ucp/mcp`, JSON-RPC `tools/call` with `search_catalog` / `lookup_catalog`. Agent metadata uses `https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json`. This keyless profile path worked; no application, API key or approval blocked this run.

Official references: [Global Catalog](https://shopify.dev/docs/agents/catalog/global-catalog), [Catalog guidance](https://shopify.dev/docs/agents/catalog), [productSet](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/productSet), [publishablePublish](https://shopify.dev/docs/api/admin-graphql/2026-10/mutations/publishablePublish), [Storefront products](https://shopify.dev/docs/api/storefront/2026-10/queries/products), [access scopes](https://shopify.dev/docs/api/usage/access-scopes).

Search query: `black mechanical keyboard`; context country US/currency USD; available filter; price maximum 10000 minor units; limit10. Availability is rechecked locally because an unavailable variant appeared despite the remote available filter. Selection lookup refreshes the same variant; no source merchant Storefront or scraping calls.

Official schema version `2026-08-25`: clustered product GID, native ProductVariant GID, seller Shop GID/name/URL, variant/product URL, integer minor price and currency, boolean availability, optional image metadata. Images are deliberately ignored. Search supports 1–50 results per request and pagination up to1000; lookup up to50 IDs. Numeric keyless quotas were not stated in the reviewed docs; keyless access has the lowest rate limits and cannot request increases. Optional Dev Dashboard credential access is distinct from Admin, uses the documented token exchange and `read_global_api_catalog_search`; it was not used.

Shopify prohibits caching search results and reusing/downloading images. We perform fresh search and initial selected lookup, retain only reduced Capsule offers and transaction evidence, and never retain raw search payloads or images. Whether the reduced durable-offer retention falls within the official transaction-use allowance is not explicitly settled by those docs: Investigate Now before deployment or broader operation.

## Real selected source

Observed at `2026-10-06T14:25:06.787Z` (22:25 Singapore).

| Fact | Value |
| --- | --- |
| Capsule offer | `off_01M48SN67MRJE4CRZ0MKENHXTK` |
| Product / variant title | Mercury K1 Lite - Transparent Black |
| Merchant | GravaStar |
| Merchant ID | `gid://shopify/Shop/29559881807` |
| Product ID | `gid://shopify/p/2R8cAck29kSGaK5AwnYWI9` |
| Variant ID | `gid://shopify/ProductVariant/45806643183861` |
| Product URL | [Source offer](https://www.gravastar.com/products/mercury-k1-lite-transparent-black?variant=45806643183861) |
| Source item price | USD89.95 (`8995` minor, scale2) |
| Availability | available at observation and subsequent lookup |
| Source evidence | `fresh_external` |

This is an observation, not a hardcoded demo product or promise of present availability. No source merchant received an order or payment.

## Retained shadow and independent verification

Owned store: `token2049-test-store.myshopify.com`; Admin API2026-10. Live shop readback: USD and `plan.partnerDevelopment=true`.

| Fact | Value |
| --- | --- |
| Shadow product | `gid://shopify/Product/10356016349241` |
| Shadow variant | `gid://shopify/ProductVariant/50671374139449` |
| Publication | Online Store, `gid://shopify/Publication/230951092281` |
| Source digest | `4cd9d5df846edffbae05150631c60f1a8324c875a5fec9ca1fb8248337f8d898` |
| Durable schema | `shopify_global_919caf70e863411c99e7becee0c23084` |
| Lifecycle | retained_demo; do not delete during the audit/demo window |
| Storefront readback | one available variant, USD89.95, verified again around14:32UTC |

Unique custom ID definition `capsule_sandbox.offer_id` uses Shopify's `id` type. Supplying `type: id` on the productSet identity input caused a METAFIELD_MISMATCH; letting the existing definition infer its type fixed the request. Exactly one product was created. After creation, an invalid `code` field in publication UserError selection stopped the request. Changing that selection to the documented `field message` recovered the same native-ID product and published it, without creating another product. Regression fixtures cover both corrections.

Independent Admin publication state and Storefront sale readiness were checked before durable ready mapping. Canonical product and shadow both use the General shipping profile, taxable physical goods; shadow inventory is untracked. Source images were absent. This provides real restart/reconciliation evidence for shadow creation, not economic-order idempotency evidence.

## Quote and payment boundary

One cart was created during the original quote attempt. The existing driver reached test-gateway verification and `read_checkout_totals`, then failed closed at14:29:56UTC. No approvable quote was written. Two later diagnostics reused the existing shadow and made one cart each, separated in time. Both refreshed the selected source and stopped at the same totals guard. No throttle was observed. External cart probing ended after the corrected diagnostic also failed.

Diagnostics retained booleans only: standalone Subtotal present, no item-count label, no Estimated taxes label, standalone Shipping/Free present, no numeric shipping row, one Total match, strict summary not readable. The parser now accepts a settled Free row only as zero when it agrees with the selected shipping rate and all existing exact checks; 18 added unit checks pass. That correction did not establish a valid live quote. Remaining row/rate/tax mismatch requires investigation; no further parser relaxation is justified by the available evidence.

| Commercial component | Proven real value |
| --- | --- |
| Source observed item | USD89.95 |
| Shadow Storefront item | USD89.95 |
| Capsule sandbox shipping | NOT_FROZEN |
| Capsule sandbox tax | NOT_FROZEN |
| Capsule sandbox exact total | NOT_FROZEN |
| Immutable quote/cart ID | No persisted quote; private checkout key/URL was not retained or published |
| Authorization/funding | NOT_RUN |
| Sandbox Pay/order/Admin order readback | NOT_RUN |
| Receipt/proof ID | NOT_PRODUCED |

The five-minute source offer expired during diagnosis. No canonical expiry bypass or source replacement occurred. Quote, approval, funding and source/sandbox receipt projection are tested with labelled fixtures, not represented as real external success.

## Inherited unresolved payment blocker

Original E2E purchase `pur_01M48PSSTDQDR4VGPAQPC2VRYZ` (quote `quo_01M48PSSSGY8KG6HYAJEAX9B2B`, attempt `att_01M48PSSXDE96996RCDHP89NTR`) remains unresolved after its prior Pay attempt. Reservation is held_unresolved; no verified order reference/receipt was available. Retained schema: `shopify_accept_cefde6fa7269419080a4509999373a78`.

Read-only evidence in the other lane at14:14UTC still showed ambiguity. Abandoned checkout access was denied by protected-customer-data requirements. That lane advanced later to `63df582c6e837b6ae3c35aefb9ec97d90347dd99` with passive diagnostic capture only. This branch retains its originally verified0afd base and did not merge the later changes. The manual harness detected one unresolved Shopify purchase and blocked paid mode. No new Pay is authorized until original-outcome reconciliation is complete.

## Local verification and findings

Final local verification: `npm test` **667/667 PASS across29 files**, `npm run typecheck` PASS, `npm run build` PASS, `git diff --check` PASS. Focused Catalog/shadow/old Shopify/browser suites passed; the full suite includes PostgreSQL lifecycle/concurrency/idempotency, nested-lock pool saturation, MCP/contracts and proof checks. The changed-file secret scan checked39 files against configured high-entropy secret values and live-token/private-key patterns: no new secret matches. Two existing local database example matches in README/RUNBOOK were unchanged from the base and were not additions. No `.env`, raw payload or customer data was staged. All local provider/order fixtures carry `local_fixture`; they do not prove real Bogus payment or Cardano.

- **Act Now — resolved locally:** unique identity input/publication schema fixes; strict Free shipping support; retained-shadow ordinary-discovery bypass. Deferring the bypass could produce purchases without source provenance; ordinary search/direct lookup now exclude shadows.
- **Investigate Now:** original post-Pay ambiguity. Read-only reconcile the exact original attempt; deferring leaves an unknown economic outcome and blocks paid acceptance.
- **Investigate Now:** exact new shadow checkout summary. Preserve strict checks and investigate against one retained cart in a future authorized run; deferring leaves quote acceptance unproved.
- **Investigate Now:** official Catalog transaction-retention interpretation. Obtain clarification before broader/deployed operation; deferring may conflict with provider usage guidance.
- **Park for Later:** FX, scheduled cleanup, delegated budgets. Reject cross-currency, retain evidence, require explicit approval; deferring bounds functionality but does not weaken current guarantees.
- **Ignore / Accept Risk:** untracked development inventory and unspecified numeric keyless quota. These affect test realism/availability; caps, no source orders, no blind payment retries and explicit failure handling bound current use.

Exactly one next action: fresh-chat read-only reconciliation of the original unresolved E2E attempt, with no new cart or Pay and no merges.
