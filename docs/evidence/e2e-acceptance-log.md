# First external E2E acceptance — issue and fix log

Branch `build/e2e-acceptance`, started from reviewed `59fc2d5`. Running log of every problem hit during the
first Shopify-sandbox acceptance run and what fixed it. No secrets, tokens or raw provider bodies here.

| # | Phase | Issue | Cause | Fix / status |
|---|---|---|---|---|
| 1 | Preflight | Demo query `"test tee"` returned 0 variants | Dev store held only Shopify's sample catalog (snowboards, ski wax); the "test product" was never created, `SHOPIFY_TEST_PRODUCT_VARIANT_ID` empty | Created `Agent Commerce Test Tee` (handle `agent-commerce-test-tee`, USD 9.95, one variant, shipping required, inventory untracked, no selling plan/discount) via Admin `productSet` |
| 2 | Preflight | New product invisible to Storefront API | Admin-created products are not published to the Storefront channel; the Admin app has no `write_publications` scope | Human published the product to the channel in Shopify Admin; Storefront search, variant-gid and product-gid lookups then passed |
| 3 | Preflight | Demo SSOT referenced no stable product | `productHandle` was `null` and unused by code; free-text query only | `demo/demo-data.json` now has handle + `productRef` (variant gid); `DemoConfig` schema gained a validated `productRef` field |
| 4 | Preflight | `.env.local` names differ from the app's env names | Setup lane used `CARDANO_PROVIDER_PROJECT_ID` (app reads `BLOCKFROST_PROJECT_ID`); facilitator URL and payer cap vars empty; stale `DATABASE_PATH` | Not needed for the unfunded rehearsal; map at deployment step |
| 5 | Rehearsal | Quote failed `shopify_shipping_unavailable` for the SG buyer | Store shipping zones covered only the US (Standard 8.00, Express 15.00) | Seeded an SG shipping zone (flat Standard USD 8.00); see #7 |
| 6 | Seeding | Admin app lacked scopes for publications/shipping/locations/inventory/markets (read-only by design; only write_products existed) | Provisioning created a minimal read-oriented app (token2049-commerce) | Added read/write publications, shipping, inventory, markets and read_locations to shopify.app.toml; `shopify app deploy --allow-updates` (version token2049-commerce-3); store owner approved via oauth/install link. NOTE: these broader scopes are on the same app whose client credentials the gateway uses — deploy-time decision whether Render gets a read-only app instead |
| 7 | Seeding | **OPEN — Singapore not sellable in this store.** All products report availableForSale=false in any non-US market context (SG and CA), although Admin shows the SG market (ACTIVE), catalog, publication, SG shipping zone and 100 units at the Shop location | Root cause not found after exhaustive Admin-side seeding; US (primary market) works. Sample products behave the same, so it is store/market-level, not product-level | **Decision: proceed with a US synthetic buyer (New York, NY 10001) for the retail demo.** Demo SSOT (buyer + retail.shipToCountry) switched to US; hard-coded SG in tests/unit/shopify.test.ts now follows demo data. Singapore seed objects left in place. Follow-up: root-cause SG market availability before any Singapore-framed retail demo |
| 8 | Seeding | Product inventory untracked | Initial seed used inventoryPolicy CONTINUE, untracked | Now tracked, 100 available at Shop location |
| 9 | Rehearsal | Storefront `cartCreate` returns `THROTTLED` (HTTP 200, no retry-after) | Shopify limits checkout/cart creation per minute and recommends a request queue with exponential backoff (shopify.dev Storefront API rate limits). We call from a server with a PUBLIC token and no `Shopify-Storefront-Buyer-IP`, so Shopify cannot tell buyers apart and applies a shared limit; undocumented per-IP/session/shop factors reported by community. My own diagnostic carts tripped it and it persisted >20 min | Stop probing; retry loop with spacing. Candidate code fixes (pending approval): bounded exponential backoff on THROTTLED in StorefrontClient cartCreate; consider private delegate token + buyer-IP header for the deployed gateway |
| 10 | Rehearsal | Quote path failed with opaque "operation failed" once the throttle cleared (19:04) | Non-typed errors (e.g. zod) were flattened to a generic message, hiding the cause; client was also being edited mid-run | `toProviderError` now reports error class / zod issue paths (never values). Cause still unseen until next cart succeeds |
| 11 | Rehearsal | Throttle persists with private delegate token, buyer-IP header and 16 s backoff | Shopify cart-creation allowance appears very small and slow to refill (cleared once after ~11 quiet minutes); duration undocumented | Backoff + private token + buyer IP kept as hardening. **OPEN BLOCKER** — see report options |
| 12 | Seeding | Delegate Storefront token expires | Delegate tokens inherit short lifetime | Deployed gateway must mint its own at runtime or use a long-lived approach; do not copy the local token to Render |
| 13 | Process | Own diagnostics caused self-inflicted throttling; too-long guessed waits | Repeated probe carts and polling | Rule: one cart per attempt, no probing between attempts |
| 14 | Rehearsal (permalink diagnostic) | Cart permalink redirected to the storefront password page | Dev store storefront is password-protected; `SHOPIFY_STORE_PASSWORD` was never provisioned (empty in .env.local; absent from all setup material). The real driver already handles the gate but needs the password, so the production checkout path needs it too | Needs the password in ignored env (human supplies; never pasted in chat). Diagnostic-only permalink mode added to `scripts/shopify-rehearsal.ts` (`--permalink`); production adapter unchanged |
| 15 | Rehearsal (IN-1) | **Hosted card-field origin blocked by the driver's network allow-list** | Card inputs (`card-fields-number/expiry/verification_value/name`, also `issue_date`/`issue_number`) are served in iframes from `checkout.pci.shopifyinc.com`; the allow-list only permits the store, `cdn.shopify.com`, `checkout.shopify.com`, `*.shopifycdn.com`. With the host blocked, `cardNumberFrame` count = 0 and the Pay button is disabled; with the exact host allowed, all four frames mount and Pay is enabled. Driver iframe selectors (`iframe[name^="card-fields-…"]`) are correct | Proposed minimal fix: add exact host `checkout.pci.shopifyinc.com` (no wildcard). Not applied yet (awaiting Checkpoint 2 approval) |
| 16 | Rehearsal | Blocked Shopify telemetry: `otlp-http-production.shopifysvc.com`, `error-analytics-sessions-production.shopifysvc.com`, `atlas.shopifysvc.com`; subframe `shop.app` document | Non-essential analytics/Shop Pay; checkout works without them | Leave blocked (privacy-preserving) |
| 17 | Rehearsal | `choose_shipping` fails with `total_mismatch` immediately after address fill | Driver race: `chooseQuotedShipping` counts radios without waiting; Shopify renders "Standard"/"Express" a few seconds after the address is complete (confirmed: absent at failure, present after a 10 s wait) | Proposed fix: wait (bounded by the step timeout) for the quoted shipping option before choosing. Not applied yet |
| 18 | Rehearsal | Browser checkout resolved the **Singapore** market from caller IP (`/en-sg/stock-problems`) | Market inferred from IP; all non-US markets show products unavailable (issue 7) | Diagnostic forces US via `localization` cookie + `country=US`. **Production consequence**: the deployed gateway (Render Singapore) and any browser it drives must pin the market, e.g. via cart `buyerIdentity.countryCode`/permalink `country` param, or Singapore availability must be fixed |
| 19 | Rehearsal | Permalink checkout URL bounced to storefront `/` in a fresh browser | Checkout token belongs to a cart session; fresh context lacked its cookies | Diagnostic seeds the HTTP session cookies in `attach` hook. Not applicable to production (driver follows the API checkout URL) |
| 20 | Rehearsal | Dev-store storefront password gate (see #14) | `SHOPIFY_STORE_PASSWORD` unset | Provided by human; driver handles gate (`password_gate` step observed) |
| 21 | Rehearsal (IN-1) | `verify_total` could never match on the live checkout | Parser forbade newlines between "Total" and the amount; Shopify renders `Total` / `USD` / `$17.95` on separate lines (observed total 17.95 = 9.95 + 8.00 shipping, no tax line) | Parser now allows the label and amount on adjacent lines; regression test with the live layout (also rejects wrong amount/currency and "Subtotal"-only) |
| 22 | Rehearsal (IN-1) | `verify_test_gateway` failed: live Bogus checkout never prints "Bogus Gateway" | It shows its own instructions ("1 to simulate an approved transaction / 2 declined / 3 gateway failure") | Safeguard now also accepts that exact phrase (Bogus-specific; Shopify Payments test mode text is rejected); tests added |
| 23 | Rehearsal (IN-1) | `force:true` on the final pay click | Both the driver's trial click and an independent harness trial click passed (full actionability) | `force:true` removed; a click that fails actionability now errors (post-checkpoint failure is treated as unknown, which is conservative) |
| 24 | Rehearsal | Production-path throttle | Single `cartCreate` via the production client (private token + buyer IP, retries disabled) succeeded after ~27 quiet minutes with no cart writes | Permalink-backed production path NOT needed. Operational rule: avoid probe carts; one cart per quote. Backoff retained |
| 25 | Rehearsal | **Result:** `REHEARSAL_STOPPED_BEFORE_PAY_CLICK` via cart permalink, zero orders | Steps passed: open_checkout, fill_email, select_country, fill_name, fill_address, select_province, choose_shipping, verify_total, verify_test_gateway, fill_test_card, reverify_total; pay button "Pay now" enabled; trial clicks passed | Rehearsal was permalink-based (diagnostic). The production quote→checkout path (cartCreate URL) has NOT been rehearsed end to end; recommended once more after a quiet window, before funding |

## Production-path continuation — 2026-10-06

Remote and local E2E head both verified at `4bdcc75a91b67d21c0438beb8bb61cb8656945b4`; clean worktree and ancestry from `59fc2d5` verified. The checkout is `C:/Dev/t2o-e2e-acceptance`. Main remains `95a896c`. Existing permalink rehearsal was not repeated.

| ID | Stage | Symptom / exact status | Root cause | Classification | Fix / focused verification | Open / demo reliability |
|---|---|---|---|---|---|---|
| 26 | Production unfunded quote, 12:16 UTC | `cartCreate` and delivery selection completed, then `shopify_total_unavailable`: `exact cart total unavailable: totals or tax are estimated/missing`. No browser step started; Admin readback found 0 new orders. | Not yet known: existing diagnostic omitted estimate flags and tax presence. | Investigate Now | Added allowlisted Storefront monetary/estimate/status diagnostics and two bounded read-only checks of the same cart on quote failure. No change to exact-total guards. Baseline focused Shopify tests: 39/39 PASS. Artifact: `artifacts/e2e/20261006T121600Z-production/`. | Open; blocks production-path quote and first funded E2E. No payment, order, purchase or Cardano transaction. |

Deprecated CartCost tax/duty fields are documented at https://shopify.dev/docs/api/storefront/2026-10/objects/CartCost. Deprecation alone does not prove the live cause or authorize an estimated quote.

### Issue 26 — confirmed cause and terminal Phase 1 disposition

At 12:19:18–12:19:23 UTC (20:19 Singapore), one cartCreate, one delivery-selection mutation and two bounded reads of the SAME cart all returned HTTP 200 with no GraphQL error codes. Every response contained:

- USD 17.95 total; USD 9.95 subtotal; USD 8.00 selected shipping.
- totalAmountEstimated=true; subtotalAmountEstimated=true; totalTaxAmountEstimated=true.
- totalTaxAmount=null; totalDutyAmount=null.

The estimate flags did not settle during the bounded reads. Capsule correctly rejected this as shopify_total_unavailable. No exact quote was created; no browser opened. The arithmetic residual is zero, but null tax is NOT evidence of finalized zero tax. The observed amounts remain estimates.

Official provider explanation: [Shopify tax/duties deprecation](https://shopify.dev/changelog/posts/tax-and-duties-are-deprecated-in-storefront-cart-api) says these are finalized at checkout. This corroborates the live missing-tax result; it does not guarantee that later reads will become exact.

Root cause: the adapter requires non-estimated cart totals and explicit tax, while this real Storefront cart never supplied them in the observed responses. This is an external contract mismatch, not a shipping-selector error or a throttle failure. Resolving it requires a product/provider-strategy decision about obtaining the exact quote from checkout before approval/funding. We did NOT infer zero tax, ignore estimate flags, hardcode 17.95, downgrade to permalinks or change the exact-total guard.

Independent catalog lookup at 12:20:42 UTC verified exactly one US offer: Agent Commerce Test Tee, quantity 1, variant gid://shopify/ProductVariant/50670884094009, indicative item price USD 9.95. That read created no cart. Both attempts independently read zero newly created Admin orders. Both process preflights found zero active payer processes. The rehearsal requires APP_ENV=sandbox and rejects configured CARDANO_/PAYER_/BLOCKFROST_/SOLANA_ variables.

Artifacts (ignored, sanitized):

- artifacts/e2e/20261006T121600Z-production/ — original failed production attempt.
- artifacts/e2e/20261006T121900Z-production-diagnostics/ — one instrumented retry, same-cart reads, catalog readback, final working diff and reconciliation.

There were exactly two successful cart creations in this continuation, one per production attempt. Neither attempt observed throttling. No additional cart probes were made. Historical throttle risk remains an operational concern.

### Full-run issue disposition (append-only reconciliation)

This table supersedes historical open/proposed wording ONLY for the listed disposition; the original attempts above are preserved. Prior fixes were inspected in committed 4bdcc75; prior external evidence was not rerun or relabelled.

| ID | Classification | Root cause / recommended action and final status | Evidence / risk of deferral or acceptance |
|---|---|---|---|
| 1 | Act Now | Missing dedicated demo product; created Test Tee. Resolved in prior run; retain canonical variant reference. | Earlier Admin seed; current read-only lookup confirms title, variant and USD 9.95. Missing seed would break discovery. |
| 2 | Act Now | Product unpublished to Storefront; owner published. Resolved. | Current exact variant lookup returns one US offer. Unpublished product would block discovery. |
| 3 | Act Now | Unstable free-text-only demo reference; typed productRef added. Resolved. | Committed demo/config boundary and current variant match. Wrong reference would select wrong merchandise. |
| 4 | Investigate Now | Setup env aliases differ from gateway names. Open for funded/deployment preflight; map privately and verify actual readiness. | Original env-name finding; this rehearsal has no funding rail. Deferral beyond deployment would block Cardano/DB configuration. |
| 5 | Park for Later | SG shipping coverage missing; SG zone seeded, but SG sellability still unresolved (#7). Canonical US workaround accepted. | Prior seed/readback; current US shipping USD 8.00. Deferral blocks an SG-framed retail demo. |
| 6 | Ignore / Accept Risk | Provisioning app has broad scopes. Accepted temporarily; determine required runtime scopes/token flow before deployment, minimize after E2E. | Prior OAuth/app deployment. Broad app authority remains a cleanup risk; no new scopes added here. |
| 7 | Park for Later | Non-US market sellability unresolved. Open; retain approved US buyer and investigate SG in seeded-data lane. | Prior market diagnostics; current US catalog lookup works. Do not present this as a working SG retail demo. |
| 8 | Act Now | Initial inventory untracked; prior seed enabled tracking and 100 units. Resolved historically. | Prior inventory seed; current available US offer. Inventory quantity was not independently recounted here. |
| 9 | Ignore / Accept Risk | Shared cart-creation throttle; bounded backoff and quiet-window policy adopted. No current throttle. | Instrumented retry: one cartCreate HTTP 200, no errors. Rate limiting may still interrupt later real attempts. |
| 10 | Act Now | Generic provider errors hid diagnostic paths. Resolved locally; this continuation added allowlisted monetary/flag/status evidence. | Committed error-class handling and new JSONL. Missing diagnostics would slow safe contract diagnosis. |
| 11 | Ignore / Accept Risk | Short backoff could not clear earlier long throttle. Accepted operational limit; wait rather than hammer after exhaustion. | Historical >20-minute failures; current retry has no throttle. Bounded retries cannot guarantee availability. |
| 12 | Investigate Now | Local private delegate token has short lifetime. Open; verify deployable token mint/refresh approach before Render. | Prior token provisioning; current token works locally. Copying it to Render would create an expiring deployment. |
| 13 | Act Now | Diagnostic probe carts caused throttling. Resolved process rule: one cart per real attempt; no exploratory writes. | Current request count explicitly recorded. Repeated probes could block the demo. |
| 14 | Act Now | Store password missing. Resolved in ignored local env; retain secure provisioning requirement. | Prior password-gate rehearsal; configured-name preflight confirms present. Missing hosted password could block checkout. |
| 15 | Act Now | Exact hosted PCI origin omitted. Resolved in 4bdcc75 with checkout.pci.shopifyinc.com only. | Prior hosted frames and committed allowlist. Current browser was not reached; avoid broader allowlists. |
| 16 | Ignore / Accept Risk | Telemetry/Shop Pay hosts blocked. Keep blocked; accepted. | Prior checkout reached pay boundary without telemetry. Alternate non-canonical checkout features may remain unavailable. |
| 17 | Act Now | Shipping radios rendered after an immediate check. Resolved by bounded waiting in 4bdcc75. | Prior live race and current focused tests. Production cart browser path still needs rehearsal after #26. |
| 18 | Investigate Now | Browser market may follow egress IP. US API quote context works, but production browser market remains unverified. Open. | Current US catalog/cart requests; prior SG browser redirect. Deferral could break a Render Singapore checkout. |
| 19 | Ignore / Accept Risk | Diagnostic permalink lacked session cookies. Diagnostic-only cookie seeding resolved; production path must use API checkout URL. | Prior permalink harness. Does not establish production browser behavior. |
| 20 | Act Now | Dev-store password gate blocked browser. Resolved locally, same root cause as #14. | Prior password_gate handling. Render still needs private password provisioning. |
| 21 | Act Now | Total parser rejected Shopify multiline layout. Resolved in 4bdcc75. | Live-layout regression and current focused tests. Parser success is not proof of an exact pre-funding cart quote. |
| 22 | Act Now | Bogus wording differed from literal gateway name. Resolved with Bogus-specific instruction phrase. | Prior live wording and focused test; generic real-card test wording remains rejected. |
| 23 | Act Now | Final click used force:true. Resolved: normal actionability required. | Prior trial clicks and committed source. Current production browser boundary has not been reached. |
| 24 | Ignore / Accept Risk | Earlier production client throttled; clean call succeeded after quiet window. No current throttle. | Two successful production creations here; instrumented retry had one request. No availability guarantee inferred. |
| 25 | Ignore / Accept Risk | Only permalink diagnostic reached pay boundary. Preserve PARTIAL evidence; production acceptance remains incomplete. | Prior stopped-before-pay summary; current production quote blocked by #26. Never report this as production-path PASS. |
| 26 | Investigate Now | Real cart totals estimated and explicit tax null. OPEN BLOCKER. Obtain approval for a checkout-based exact-quote strategy; preserve approval/funding/purchase boundaries. | Four same-cart responses show identical estimate flags/null tax; no browser, zero new Admin orders. Accepting these as exact would misstate commercial terms. |
| 27 (inherited MCP F-1) | Act Now | Conflict guidance suggested fresh quote after payment/merchant activity. Resolved in 4bdcc75: follow get_purchase, never create another purchase in that case. | Committed MCP regression/source inspected; owner's baseline 487/487 result. Not rerun in this Phase 1 continuation. Bad guidance could prompt duplicate spending. |

Count: 27 issue records, including overlapping historical symptoms (#14/#20, #9/#11/#24). Fourteen Act Now records are resolved, four Investigate Now records remain open (#4/#12/#18/#26), two are Park for Later (#5/#7), and seven are Ignore / Accept Risk. These counts are ledger records, not distinct root causes. One new external blocker (#26) was encountered in this continuation.

### Dedicated seed/data reconciliation

- Shopify: historical missing product (#1), unpublished product (#2), missing stable reference (#3), missing SG shipping (#5), unresolved non-US availability (#7), inventory tracking (#8), and missing password (#14/#20) are preserved above. Current US item/reference/quantity/price matches live discovery. Current API shipping is USD 8.00; tax is null and the total is estimated, so there is no exact quote confirmation. SG remains a deferred seed/config problem.
- Cardano: not reached in this continuation; no wallet/asset/treasury seed existence or balance is claimed. The known env-name mismatch (#4) remains for funded preflight. No usable funding configuration, payer or bridge was used.
- PostgreSQL: no DB/gateway purchase path invoked, no new purchase/quote/receipt persisted by this harness, no DB seeded-state verification claimed. Historical stale DATABASE_PATH remains part of #4; use DATABASE_URL at deployment.
- Other providers: not reached; no new seed claims. Atlas stays disabled.

### Verification and candidate state

- Focused offline Shopify tests against current source: 2 files, 39/39 PASS (rerun after diagnostics).
- Current strict TypeScript check: PASS. Current production build and migration-copy step: PASS.
- git diff --check: PASS. Targeted added-diff credential-pattern scan: no matches; no tracked secret/env files (examples excluded). This is a bounded scan, not a claim of exhaustive secret detection.
- Full suite: prior baseline result 487/487 PASS reported by owner; NOT rerun in this Phase 1 continuation. Financial/concurrency/funding recovery/MCP suites await Phase 2 authorization.
- Chain, DB/journal, paid provider result and proof UI: NOT_RUN here. No fabricated transaction/order/receipt identifiers.
- Branch/HEAD/remote E2E: build/e2e-acceptance / 4bdcc75a91b67d21c0438beb8bb61cb8656945b4. Working diagnostics/docs are uncommitted at the product-decision stop; not a new deployable candidate SHA.
- Local and remote main: 95a896c730cf893c3afd00919ebe16ad823a608b. No merge, push or deployment. Deployed SHA: NOT_DEPLOYED in this session.
- Final E2E verdict at this stop: BLOCKED. Human Checkpoint A has NOT been met.

Proposed bounded resolution, requiring human product/provider-strategy approval: use a read-only hosted checkout observation during quote creation to obtain finalized item/shipping/tax/currency/total before exposing an approvable quote, then preserve exact quote binding and revalidation at execution. Never authorize or click Pay during quote creation. This is a proposal, not implemented or externally proven.

One final Opus reconciliation review is appropriate for this terminal blocked candidate; no broad review or micro-review loop was launched. The next action is human approval of the bounded exact-quote provider-strategy change. Keep this chat for that focused continuation; move to a fresh chat only for the final independent review.

Diagnostic detail: the existing harness recorded ProviderError as generic `Error` because it read `code` rather than `providerCode`. Corrected future output to retain the typed provider code. Historical JSONL is unchanged; `shopify_total_unavailable` above is established by the guard/source and exact recorded message. No further external retry was made for this logging-only correction.

## Approved resolution of issue 26 — checkout observation

User authorized proceeding with the bounded provider-strategy change in this chat. The quote driver now opens the production cart checkout, fills the canonical synthetic buyer/address, selects the quoted delivery method, verifies Bogus wording and reads a settled, balanced item/shipping/tax/total summary without card entry, pay-button trial/click or payment checkpoint. It requires three consistent observations and rejects visible busy state, pending tax, missing nonzero tax, wrong currencies, unsupported adjustments and inconsistent amounts. A checkout that omits its zero-tax row is accepted only when the final checkout total exactly balances the independently checked subtotal and selected shipping; API null tax is never treated as zero.

The executor freezes the checkout breakdown and post-observation cart binding. Execution revalidates cart identity/line/buyer/address/cost/delivery binding and the entire frozen checkout breakdown before the existing durable pay_click checkpoint. Legacy cart-exact quotes retain their original fail-closed estimate/tax checks. No funding, settlement, journal, approval or core recovery code changed. Added bounded regressions; final results and external rehearsal evidence follow after validation.

| 28 | Production checkout quote, 12:55 UTC | Read-only browser reached read_checkout_totals; post-observation API cart read then failed shopify_address_changed. No quote exposed; zero new Admin orders. | Which address/identity field changed is not yet known; raw values are intentionally absent from evidence. | Investigate Now | Added field-name-only rejection details and boolean fulfillment comparison diagnostics. Artifact artifacts/e2e/20261006T125500Z-checkout-quote/. | Open pending bounded diagnosis; affects quote reliability. No card, payment or order. |

Focused tests before this attempt: 60/60 PASS; strict typecheck/diff check PASS. One cartCreate, one delivery selection, one post-quote cart read, no throttle.

Issue 28 diagnosis: at 12:57 UTC a second real attempt confirmed all fulfillment comparisons true EXCEPT delivery-group country/province, before and after the browser. Browser quote succeeded again and no order was created. Current Storefront delivery.addresses exposes selected CartDeliveryAddress countryCode/provinceCode; implementation now requests it, requires exactly one selected address, cross-checks the delivery-group fields and retains strict requested fulfillment matching. Modern cart hashes additionally bind the selected addresses; legacy hash calculation is unchanged. Missing group codes may be supplied only by explicit selected-address evidence; conflicting non-null group codes still reject. Focused address/hash regressions added; external confirmation follows.

## Human Checkpoint A — production-path unfunded rehearsal complete

At 2026-10-06 13:01:14 UTC / 21:01:14 Singapore, the real production path reached REHEARSAL_STOPPED_BEFORE_PAY_CLICK. Evidence: artifacts/e2e/20261006T130100Z-selected-address/02-shopify-rehearsal.jsonl and 03-rehearsal-summary.md. This result supersedes the earlier blocked Phase 1 disposition only; all failed attempts remain above and in their original artifacts.

- Actual item: Agent Commerce Test Tee, quantity 1, gid://shopify/ProductVariant/50670884094009.
- Exact observed checkout breakdown: USD 9.95 item + USD 8.00 Standard shipping + USD 0.00 tax = USD 17.95. Checkout omitted the zero-tax row; the complete settled summary balanced exactly. The API tax remained null and was not used as zero-tax evidence.
- Market: US selected address and en-us checkout. API CartDeliveryAddress country/province matched requested US/NY. Derived delivery-group country/province were confirmed absent (presence booleans false).
- Checkout path: API cartCreate checkout URL (/cart/c/:token) resolved to /checkouts/cn/:token/en-us on token2049-test-store.myshopify.com. The API-path classification is established by the trusted-URL guard accepting only /cart/c/ or /checkouts/, and the historical quote artifact's /other label; logging now names /cart/c/ explicitly without exposing tokens.
- Hosted payment iframe: checkout.pci.shopifyinc.com. Bogus wording: 1 approved / 2 declined / 3 gateway failure, verified before test-card entry.
- Pay now: visible, enabled, both normal actionability trial checks passed; the pre-click checkpoint threw RehearsalStop, so no real click occurred.
- Exactly one search, one cartCreate, one delivery selection and one post-observation cart read for the passing attempt. HTTP 200/no GraphQL errors; zero throttle retries.
- Quote observation and the subsequent execution-driver rehearsal used separate fresh browser contexts, both passed the storefront password gate. Quote observation entered no card data; the later unfunded driver filled only published Bogus test values and stopped before Pay.
- Independent Admin readback: 0 orders created since this run started. Payer process preflight: 0. No usable funding rail in process, no bridge, no gateway purchase, no Cardano transaction and no payment.

| ID | Classification / final status | Root cause / fix | Verification / remaining risk |
|---|---|---|---|
| 26 | Act Now — resolved for Phase 1 | API totals remained estimates and tax null. User-approved read-only hosted-checkout observation now freezes a settled full breakdown before approval/funding. Execution checks that breakdown plus the exact cart binding; legacy guards preserved. | Real production quote + later fresh checkout both matched USD 17.95; focused new quote/no-pay/breakdown regressions passed. Paid execution still NOT_RUN. |
| 28 | Act Now — resolved | Delivery-group MailingAddress omitted country/province codes even though selected CartDeliveryAddress carried US/NY. Read selected address, require exactly one, cross-check group values, reject conflicts and bind selected-address data in modern cart signatures. | Passing live artifacts confirm omitted group codes and matching selected codes. Missing/conflicting addresses and legacy-hash preservation regressions passed. |
| 29 | Act Now — resolved diagnostics | Quote artifact path logger labelled a trusted /cart/c/ checkout URL /other. Added explicit sanitized /cart/c/:token label for future runs. Historical artifact unchanged. | Source/trusted URL guard and final /checkouts/.../en-us browser path establish the actual path. No provider behavior change or external rerun needed. |

### Current issue/seed status and verification at Checkpoint A

- Complete ledger now contains 29 records. All fixes during this continuation are recorded (#26, #28, #29 and the diagnostic improvements under #10). Historical overlapping issue records remain intact.
- Still open Investigate Now: #4 private deployment env-name mapping, #12 deployable Storefront token mint/refresh flow, and the Render-specific part of #18 browser market verification. Current local production US market path passed.
- Park for Later: #5/#7 SG shipping/market sellability seed cleanup. SG is not proven. Historical product/publication/reference/inventory/password problems remain in the dedicated seed section; current item/reference/price and selected US/NY address match live provider evidence. Cardano/Postgres/other-provider seeds still NOT_REACHED in Phase 1.
- Accepted/deferred operational risk: intermittent cartCreate throttling may recur despite this successful single request; broader provisioning scopes (#6) need runtime-scope verification before deployment and post-E2E minimization. Telemetry remains blocked. No scope expansion occurred.
- Current focused tests: 2 files, 66/66 PASS. Strict typecheck PASS; current production build/migration copy PASS; diff check PASS. Final diagnostic path/comment edits are nonfunctional; typecheck/diff scan repeated afterward. Bounded secret scan covers the complete added diff and tracked sensitive filenames; results recorded with the saved final diff.
- Full suite and financial/MCP/Postgres/funding-recovery candidate checks are reserved for Phase 2 after CONTINUE. Prior 487/487 is historical, not current candidate evidence.
- Working source remains uncommitted on build/e2e-acceptance at base HEAD 4bdcc75a91b67d21c0438beb8bb61cb8656945b4. Main and remote main remain 95a896c730cf893c3afd00919ebe16ad823a608b; no deployment. Phase 2 will validate, commit and push the complete meaningful fixes.
- Overall E2E verdict at this mandatory human pause: PARTIAL. No funded/paid/proof receipt acceptance is claimed. Exact next action: wait for CONTINUE at Human Checkpoint A, then prepare the deployable candidate. Do not merge, deploy or fund before the later explicit checkpoints.

The production Capsule Shopify path now reaches the irreversible payment boundary safely.

## Phase 2 — deployable candidate preparation

User sent CONTINUE after Human Checkpoint A. Candidate verification/commit/push is authorized; main merge, Render deployment and all funding/payment remain gated by later human checkpoints.

| ID | Stage | Symptom / cause | Classification | Fix / evidence | Final status / deferral risk |
|---|---|---|---|---|---|
| 30 | Candidate deployment configuration | render.yaml still pointed at build/postgres-persistence from the migration lane. | Act Now | Set prepared branch to main; retained autoDeployTrigger off, sandbox, Singapore and separately provisioned DB/private secret variables. No Render API mutation/deployment. | Resolved in candidate; stale branch could deploy the wrong implementation if deferred. |

Focused MCP/settlement/safety checks: 7 files, 102/102 PASS. PostgreSQL concurrency/idempotency and funding recovery: 2 files, 25/25 PASS against local isolated-schema fixtures. No provider/payer operations or env-secret files loaded by these tests.

### Deployment authentication and scope reconciliation

Read-only public-auth catalog access passed at 2026-10-06T13:12:58Z with the private delegate explicitly
unset: exactly one canonical variant, USD 9.95, zero cart writes. Independent Admin readback then
matched the configured public token in memory to one issued StorefrontAccessToken,
gid://shopify/StorefrontAccessToken/117839069241, created 2026-10-06T09:14:35Z. Only the safe ID,
timestamp, scope names and match booleans were saved; no token/raw response was printed or persisted.
Evidence: artifacts/e2e/20261006T130100Z-selected-address/08-deployment-public-auth.json and
09-storefront-token-provenance.json. No token creation, delegate mutation or scope change occurred.

The public token's granted scopes are unauthenticated_read_product_listings,
unauthenticated_read_product_inventory, unauthenticated_read_checkouts and
unauthenticated_write_checkouts. The current app includes those and read_orders plus the existing
broader provisioning grants. Actual runtime operations require product listings + checkout read/write
and independent Admin read_orders; inventory is granted but no current quantity query requires it.
Issue 6 remains Ignore / Accept Risk for this bounded run; minimize provisioning grants afterward.
No additional grants were requested. Deferring cleanup retains excess credential authority.

Issue 12 is resolved for the intended deployment profile: use SHOPIFY_STOREFRONT_TOKEN public auth and
leave SHOPIFY_STOREFRONT_PRIVATE_TOKEN unset. The runtime can refresh its independent Admin token,
but cannot mint/rotate delegates. The local one-off delegate inherits parent lifetime and is not a
permanent deployment credential. Current public-token provenance/scopes/catalog access are proven;
Render validity, cart/browser behavior and token revocation/lifetime remain deployment readiness
checks. Avoiding the private delegate may retain shared public-auth throttle risk (#9/#11/#24).

Issue 4 remains Investigate Now until actual Render env verification. The candidate Blueprint/runbook
now name DATABASE_URL (not DATABASE_PATH), BLOCKFROST_PROJECT_ID (not CARDANO_PROVIDER_PROJECT_ID),
the required receive-only Cardano config and gateway Shopify variables. No values were transferred to
Render. Payer caps/keys/ledger/bridge remain local, separate and not used. Issue 30 is resolved by the
main branch/manual-deploy template and explicit canonical gateway env declarations. Wrong env names
would leave the gateway unusable; final URL and readiness checks must precede quote approval/funding.

### Candidate verification and Human Checkpoint B

- Shopify directly affected regressions: 2 files, 66/66 PASS.
- Focused MCP/settlement/safety: 7 files, 102/102 PASS.
- PostgreSQL concurrency/idempotency/funding recovery: 2 files, 25/25 PASS, isolated local schemas.
- Full suite: 26 files, 514/514 PASS at 2026-10-06 21:10:58 Singapore (12.07 seconds). Focused counts
  are subsets of this suite, not additional full-suite tests. No payer or live provider calls from tests.
- Strict typecheck and production build/migration copy PASS; repeated after final documentation/config.
- Complete working diff check PASS. Bounded added-diff/157-tracked-file secret scan found zero added
  secret patterns or sensitive tracked filenames. Six existing matches are known local Compose
  placeholders or a synthetic worker-error redaction fixture. No real credentials found or exposed.
  Scan is bounded, not proof against every possible secret; sanitized report 10-candidate-secret-scan.json.
- Fetch/reconciliation: remote E2E unchanged at base 4bdcc75a91b67d21c0438beb8bb61cb8656945b4;
  remote main unchanged at 95a896c730cf893c3afd00919ebe16ad823a608b. Both baseline 59fc2d5 and main
  are ancestors of the candidate. Unrelated remote build/ui movement was observed and left alone.
- The complete meaningful fixes/docs/config will be committed and pushed only to build/e2e-acceptance.
  Exact resulting SHA and clean local/remote match are recorded in the checkpoint report/artifact.
  No main merge, deployment, purchase, order, Cardano transaction or receipt is claimed.

Ledger contains 30 unique issue records: 19 resolved (1,2,3,8,10,12,13,14,15,17,20,21,22,23,26,27,28,29,30);
2 Investigate Now deployment checks remain open (4,18); 2 Park for Later SG seed/market issues (5,7);
6 Ignore / Accept Risk operational/scope/diagnostic limits (6,9,11,16,19,24); and historical partial
rehearsal evidence (25) remains preserved without relabelling it paid PASS. Complete classifications
and original failures above are retained. No additional seed mismatch was found in Phase 2.

Seed evidence remains component-specific: live Shopify item/reference/price and canonical US address
verified; SG sellability unresolved. Isolated local PostgreSQL fixtures passed, but deployed customer/
client seed and production DB content are not yet verified. Cardano asset/treasury/payer balances/
ledger and other-provider seeds remain NOT_REACHED by this run. Never infer them from demo JSON.

Overall E2E verdict remains PARTIAL at mandatory Checkpoint B. Remaining external risks: deployed
config/public URL/token/browser/market readiness, Shopify intermittent throttle, exact Preprod
facilitator/Blockfrost/asset/treasury and separate payer readiness, and still-unexecuted paid merchant
readback/journal/proof acceptance. Next action requires human authorization to fast-forward main and
deploy the exact committed candidate SHA. No merge/deploy/payment is authorized merely by Phase 2
CONTINUE. Final independent reconciliation review is reserved for full PASS or a terminal blocker.
