# Combined FX and hosted recovery deployment

Date: 7 October 2026, Singapore time. Branch: `codex/hosted-stall-recovery`.

## Published and deployed state

- Recovery commit: `4c565a7`.
- Original FX commit: `25c36ce`; integrated as `b86551e`. Conflicts in MCP instructions, offer descriptions and core search preserve both FX authority and recovery behavior.
- Final deployed code: `d7ae869a358410e20b47e23901d6879fb8e348fc`, including actionable quote-provider failures.
- Gateway: `srv-db2jgqnavr4c73e9blrg`, deploy `dep-db2pdic9v7es739pkha0`, Render status `live`.
- Payer: `srv-db2mnk1srm7s73c1f5c0`, deploy `dep-db2pdic9v7es739pkil0`, Render status `live`.
- Both deploy the exact tested SHA. Automatic deployment remains off; service branches and main were not changed. The integration branch is pushed to origin.
- Public gateway: https://token2049-origins.onrender.com; payer: https://t2o-cardano-payer.onrender.com.

The gateway includes additive migration 0007. Successful startup is evidence that its awaited migration checks completed; applied SQL rows were not independently queried. Rollback must retain migration 0007 and compatible purchase-view code. FX adds no migration or dependency.

## Files and behavior

FX and recovery implementation files are detailed in `docs/FX.md` and `docs/work/HOSTED_STALL_RECOVERY.md`. The acceptance follow-up changes `src/core/service.ts`, `src/execution/shopify/shadow.ts` and `tests/integration/shopify-global-sandbox.test.ts`: typed provider quote failures now return `provider_error` with route, provider code, outcome and retryability, rather than a generic 500. An unavailable sandbox variant names the shipping country and requests operator review. No availability, price, approval or funding guard was relaxed.

## Verification

- Combined backend suite: 1,079 tests passed; after the provider-error regression, 1,080 tests passed across 57 files.
- Console: 84 tests passed across nine files; console typecheck passed.
- Backend typecheck, gateway build and whitespace checks passed again after the final code change.
- Hosted OAuth discovery, registration, consent, PKCE token exchange, code-replay rejection, foreign-Origin rejection, MCP initialize/list/security metadata and instructions passed.
- Payer health and authenticated readiness passed; wrong-token requests were rejected. Wallet balance and transfer acceptance were not tested.
- Original S$35 travel-adapter search with Singapore shipping succeeded and retained the original SGD budget and converted USD search bound.
- A synthetic US-delivery quote on the initial combined code passed after 140 seconds. Two `quote_pending` results were collected using identical arguments. The final quote retained SGD display evidence, USD approval amount and connected Cardano source; funding instruction was 0.024990 tUSDM under the existing 1:1000 testnet policy. It was not purchased or funded.
- Final deployed code was checked again with Singapore shipping: search succeeded, and unavailable-product quoting returned the expected actionable `provider_error`, `shadow_not_visible`, `outcome=not_sent`, `retryable=false`.

Synthetic quote checks create retained sandbox shadow products and checkout/cart state. They never called authenticated `buy` or `/pay`, placed a provider order, signed a blockchain transfer or changed the payer ledger. The existing smoke includes one unauthenticated `/pay` rejection check. Credentials stayed in process memory and existing secret files; no environment file was committed.

## Singapore blocker at the original deployment

**Investigate Now: Singapore Storefront availability.** The tested shadow variant is available in the US context but `availableForSale=false` in SG despite USD 16.00 pricing in both contexts. This still blocks an exact Singapore quote, so the deployed flow is not yet accepted end to end for Singapore delivery.

Read-only checks confirmed an active Singapore market, product and variant publication in its active auto-publishing catalog, the general shipping profile's active Singapore Standard rate, and an active online-fulfilling location. The shadow inventory item is untracked, its inventory policy is DENY, and available quantity is zero. These facts narrow the problem; they do not establish the root cause or justify bypassing availability.

Diagnostic identity: product `gid://shopify/Product/10356503478329`, variant `gid://shopify/ProductVariant/50676715388985`; Singapore catalog `gid://shopify/MarketCatalog/126408654905`, publication `gid://shopify/Publication/230994772025`; general shipping profile `gid://shopify/DeliveryProfile/117635022905`. Further acceptance created another retained shadow for the same adapter and showed the same failure.

Next task: explain and fix Singapore contextual availability for newly prepared controlled sandbox shadows, verify one synthetic S$35/SG quote with frozen FX evidence, and then let the user explicitly approve the exact quote and rail in ChatGPT. Preserve market-specific availability and prices, quote digest/expiry, existing payer authority and signing history. No automatic purchase/payment, inventory-policy bypass or broad Shopify configuration change is part of this handoff.

Deferring means the next Singapore quote stops with operator guidance. Unknown payment outcomes still require reconciliation; process loss does not authorize automatic resending. A fresh chat for the distinct Shopify availability investigation is recommended, using this file plus the FX and recovery notes.

## Singapore shipping repair, 7 October 2026

The availability blocker was a missing **effective market shipping configuration**, not inventory policy. The controlled store uses Shopify's market-driven shipping model. Singapore market `gid://shopify/Market/72964341817` had `delivery.shipping=null` and no parent markets. It therefore inherited the shop default of no shipping. The General delivery profile's Singapore Standard rate existed but did not configure market shipping. US had explicit market shipping options; Canada had an option with no eligible origin location.

Authoritative contract: [Shopify market-driven shipping API](https://shopify.dev/changelog/posts/market-driven-delivery-profiles-admin-api), especially the rule for null shipping on a market without a parent. Read-only diagnosis also confirmed the shadow's assigned location matched the legacy profile group and the SG rate had no weight or price conditions.

The live fix adds one active USD 8.00 `Standard` flat-rate option to **only Singapore's sandbox market**, restricted to `gid://shopify/Location/96693715001`. Created option: `gid://shopify/DeliveryFlatRateOptionDefinition/937756917817`. No collection restriction, free-shipping threshold or transit-time promise was added. Currency, market publication, inventory tracking, quantities and inventory policy were not changed.

Before/after causal check on variant `50676715388985`: SG `availableForSale=false` became `true`, with USD 16.00 in both reads. US remained available at USD 16.00; CA remained unavailable at USD 15.20. Independent Admin readback still reports untracked inventory, `DENY`, available quantity zero and the same fulfillment location. No availability guard was bypassed.

Changed files:

- `scripts/shopify-sg-shipping.ts`: an operator-only check/repair. With existing sandbox Shopify environment variables loaded, `npx.cmd tsx scripts/shopify-sg-shipping.ts` is read-only; `--apply` repairs only the missing configuration after checking the live development-store, USD, SG-only market, no-parent and fulfillment-location boundaries. Existing differing configurations require operator review. Successful writes require independent readback; unknown outcomes are inspected before another write. Run one repair invocation at a time. This script is not called during quoting or startup.
- `tests/unit/shopify-sg-shipping.test.ts`: 19 tests cover the configuration gap, exact constrained mutation, readback, repeated apply, unknown-outcome recovery, unsafe boundaries and preservation of existing configuration.
- `tests/unit/shopify.test.ts`: adds a country-context regression showing a priced US-available shadow still fails closed in SG until SG shipping makes Storefront availability true.
- `src/execution/shopify/browserCheckout.ts` and `tests/unit/shopify-browser.test.ts`: the configuration repair exposed a second deterministic SG blocker. Live quote-only browser diagnosis showed no accessible city input in SG shipping or billing, only `aria-hidden` autofill clones. The existing driver filled a hidden shipping city clone and then timed out waiting for an accessible billing city. Skip city entry for SG in both forms; other countries retain their required city fields. The regression simulates both missing SG controls, checks all other synthetic billing fields, and proves quoting never enters a card or touches Pay. Existing US visible-field failures still stop before payment.
- This deployment handoff records configuration and acceptance evidence.

Checks: 203 relevant tests across six files passed (the four above plus browser payment-boundary and low-memory tests); backend typecheck, gateway build including console assets, and whitespace checks passed. A live local quote-only run of the patched driver read USD 16.00 item + USD 8.00 shipping + USD 0.00 tax = USD 24.00 without entering card details or clicking Pay.

Deployment decision: the market configuration change applies live; the additional SG browser fix requires a gateway deployment. Payer code and authority are unaffected, so the payer remains at `d7ae869a358410e20b47e23901d6879fb8e348fc`. Automatic deployment stays off; service branches, payer policy, signer, ledger and secret files are unchanged. Gateway deployment and final hosted evidence are recorded below when complete.

Hosted verification: pending final collection. The old local SG smoke fixture initially supplied `province: "Singapore"`, which correctly failed the synthetic province-code guard. Singapore requires no province, so acceptance omits it; no runtime guard was changed. A first configuration-only hosted attempt timed out at `fill_email`; this was not reproduced locally. Local diagnosis then reproduced and fixed the absent-city failure. Hosted verification calls only search/quote plus read-only payer readiness and OAuth checks; it contains no `/pay` or `buy` call.
