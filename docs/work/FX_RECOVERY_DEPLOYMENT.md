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

## Remaining issue and exact next task

**Investigate Now: Singapore Storefront availability.** The tested shadow variant is available in the US context but `availableForSale=false` in SG despite USD 16.00 pricing in both contexts. This still blocks an exact Singapore quote, so the deployed flow is not yet accepted end to end for Singapore delivery.

Read-only checks confirmed an active Singapore market, product and variant publication in its active auto-publishing catalog, the general shipping profile's active Singapore Standard rate, and an active online-fulfilling location. The shadow inventory item is untracked, its inventory policy is DENY, and available quantity is zero. These facts narrow the problem; they do not establish the root cause or justify bypassing availability.

Diagnostic identity: product `gid://shopify/Product/10356503478329`, variant `gid://shopify/ProductVariant/50676715388985`; Singapore catalog `gid://shopify/MarketCatalog/126408654905`, publication `gid://shopify/Publication/230994772025`; general shipping profile `gid://shopify/DeliveryProfile/117635022905`. Further acceptance created another retained shadow for the same adapter and showed the same failure.

Next task: explain and fix Singapore contextual availability for newly prepared controlled sandbox shadows, verify one synthetic S$35/SG quote with frozen FX evidence, and then let the user explicitly approve the exact quote and rail in ChatGPT. Preserve market-specific availability and prices, quote digest/expiry, existing payer authority and signing history. No automatic purchase/payment, inventory-policy bypass or broad Shopify configuration change is part of this handoff.

Deferring means the next Singapore quote stops with operator guidance. Unknown payment outcomes still require reconciliation; process loss does not authorize automatic resending. A fresh chat for the distinct Shopify availability investigation is recommended, using this file plus the FX and recovery notes.
