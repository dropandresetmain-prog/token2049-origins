# Capsule decisions log

## 11 October2026 — final integrated cold acceptance

Correct only the demonstrated gateway readiness mismatch:90s fixed Worker,110s wake caller,130s preparation, unchanged45s MCP pending. Two independently cold deployed cycles PASS including authenticated readiness, independent startup and safe invalid-ID400. Existing conditional authorization then restores only unchanged payer signing and original grants/customer scope after backup/history/fencing gates. No agent transaction. Prior failures remain evidence; do not infer undocumented Render rules. [Acceptance](architecture/PAYER_READINESS_REPAIR.md).

## 11 October2026 — final independent cold diagnostic

Owner authorized one additional direct fixed-health diagnostic, retaining all payment authority disabled. Worker upstream90s and independent caller110s separate terminal classification from client cancellation. Actual cold request after91minutes passed200 with independent startup in33.135s; canonical histories unchanged. This successful duration is below the old75s deadline and does not establish a fix for intermittent ingress. Production gateway remains unchanged; separately budget its nested preparation deadlines and two fresh integrated cold cycles before reconsidering activation. [Exact evidence](architecture/PAYER_READINESS_REPAIR.md).

## 11 October 2026 — owner-authorized fixed health wake

A demonstrated Render gateway-to-sleeping-payer refusal (429 with x-render-routing:hibernate-rate-limited) blocks authenticated preparation. The owner explicitly authorized one Free Cloudflare Worker that calls only the existing payer GET/health from an external origin. A genuine cold diagnostic PASS preceded gateway integration; the first deployed integrated cold check also passes. The second integrated check FAILED (974.361s idle, direct429,75s client timeout, outer503, no payer startup). Stop under the owner failure rule; do not activate based on warm-only or intermittent success. Preserve the disabled candidate and exact evidence. Final Worker upstream status is unknown because the gateway cancelled before receiving its response.

The opt-in gateway trigger uses a new dedicated wake credential, never payment/OAuth credentials or financial payloads. Direct authenticated payer status must pass before the durable payment claim. Existing Render gateway/payer/MCP/OAuth/browser and Neon PostgreSQL stay canonical. No cron, keep-alive, storage, proxy, new signing service or payment retry is introduced. Approximate location/isolate rate limits are acceptable for health traffic; authoritative financial locks remain unchanged. [Exact evidence and release gates](architecture/PAYER_READINESS_REPAIR.md).

## 11 October 2026 — payment transport and owner-authorized cap alignment

Use authenticated, bounded read-only transport preparation before a durable payment claim. Repeat only safe GET readiness calls; never automatically retry POST /pay. Retain HTTP status and fixed response categories without secrets or transaction bodies. Unknown attempts remain blocked and require readback.

The owner explicitly requested Solana and Sui token/commercial caps match Cardano: 5,100,000 token base units per-payment/daily/cumulative, with the existing 1:1000 scale. Preserve all prior exposure and independent chain gas/sponsor limits. Apply additive immutable policy revisions only while fenced; no history reset or replacement wallet. Existing Render/MCP/OAuth infrastructure remains unchanged. [Implementation and release evidence](architecture/PAYER_READINESS_REPAIR.md).


## 11 October 2026 — authorized database exception and consolidated hosted activation

Status: owner-approved cutover complete; owner live purchase acceptance NOT RUN. The subsequent explicit Render-to-Neon authorization supersedes the 10 October database-retention decision below. Canonical state is Neon Free PG18 Singapore, direct/unpooled verified TLS; original Render source remains read-only with restored original access restrictions. Application gateway/MCP/OAuth/console/providers/Playwright remain on existing Render infrastructure.

One reused Free payer runs all three rails with exact-instance grants and preserved histories. Actual Render secret mounts are symlinks (lstat0777, resolved0640); Sui correctly refused them. A bounded selected-only private-file staging correction preserves downstream key identity and permission guards; normal startup/listing never initializes all signers. Both services are live at `cb7b96e9e43a09842c1e9ee031bd1d8e3ec73e78`. No Cloudflare, queue, new service or paid plan. [Evidence and rollback boundary](architecture/CONSOLIDATED_PAYER.md).

## 10 October 2026 — keep Render; consolidate payer ownership

Status: historical architecture correction; superseded only for the database by the explicit 11 October authorization above.

The corrected architecture keeps existing Render PostgreSQL 18, gateway/MCP/OAuth, console, providers and Playwright. It supersedes the proposed Neon/Cloudflare replacement. Reuse the existing Cardano service for one payer with three internal rails and multiple owned wallet sources; no per-wallet/service deployment and no wake orchestration.

Bind exact approval to `selectedSourceId` and immutable quote/funding option; list registrations without chain fan-out. Keep keys outside gateway, persist before signing/submission, preserve original Cardano/Solana/Sui histories and independent caps. Sui's durable hosted history uses PostgreSQL with signature-verified import. Legacy runtimes require explicit process/credential fencing; new database grants cannot fence old images. No cap increase or history reset is implied. Details: [consolidated payer record](architecture/CONSOLIDATED_PAYER.md).


Current decisions that supersede or extend the pinned launch planning snapshot.

## Product

### Capsule is the product name
Status: settled.

Capsule is a buyer-side commerce gateway for external AI agents, not a chatbot, wallet, marketplace or merchant checkout product.

Core thesis:
Any agent. Agent-native money in. Ordinary commerce out.

### Agent conversation is separate from deterministic commerce
Status: settled.

The host agent handles conversation/reasoning. Capsule owns typed validation, exact quotes, authority, funding truth, durable execution, accounting, reconciliation and proof. Channels do not write the journal or mark purchases funded/paid.

### Progressive missing-information loop
Status: implemented.

Incomplete search/fulfillment input returns structured needs_input. The host asks only for missing canonical fields, merges the answer and retries. The model must not invent required customer information.

## Authority and funding

### Funding source selection is explicit
Status: implemented.

No default Cardano or first-option selection. The quote exposes available fundingOptionId values; the human explicitly selects one and approves exact terms. Purchase creation derives rail/network/asset/payee/amount from the stored selected option.

### Testnet settlement is 1:1000
Status: implemented.

Commercial notional and public-testnet stablecoin quantity are separate facts. The fixed 1:1000 testnet notional scale is disclosed and bound into the quote/funding requirement. It is not FX or real economic conversion.

### Payer keys stay outside the gateway
Status: implemented.

Cardano/Solana signing authority remains in separate bounded payer processes with protected history/caps. Never reset signer history to regain budget.

## Persistence and execution

### PostgreSQL only
Status: implemented.

Local tests/dev use PostgreSQL 18; hosted runtime uses Render PostgreSQL. SQLite is unsupported.

### Unknown outcomes never trigger blind retry
Status: implemented.

Provider/payment ambiguity is preserved as unresolved/unknown with exposure held. Recovery is readback-first. The user is never told to manage duplicate prevention.

## Shopify

### Deterministic controlled-store Shopify path remains valuable
Status: settled.

The Capsule-owned dev-store product path remains the simplest fallback and regression path even after live discovery exists.

### Real discovery and sandbox execution are deliberately decoupled
Status: implemented partially, externally PARTIAL.

Live Shopify Global Catalog discovery identifies real source product/variant/merchant/price/availability. Selecting an offer creates one durable shadow product in Capsule's dev store. Execution uses Capsule's controlled sandbox. Never claim the source merchant received the order/payment.

### Global Catalog source evidence and sandbox execution evidence remain separate
Status: implemented.

Source item price is not the source merchant's all-in checkout amount. Capsule sandbox shipping/tax/total are separate and require their own exact quote.

## Demo/data

### demo/demo-data.json is a scenario SSOT, not proof of external state
Status: settled.

Every final demo run must preflight actual provider inventory, wallets, balances, configuration, database state and UI fixture references. Seed/preflight policy is in docs/demo/SEED_DATA.md.

## UI

### Capsule UI V3 is approved
Status: settled.

DESIGN.md and docs/design/ui-v3/ are the visual authority. Runtime wiring is still pending. The judge view should prioritize intent, payment source, progress, provider result and proof—not raw logs.

## Integration/release

### main at 8a76225364bf3b56fe2bf192297ee17b86d8f540 is the pre-Masumi implementation baseline
Status: verified.

Completed E2E/crypto/providers/Shopify Global/UI references were integrated and locally verified before fast-forward promotion. Masumi was deliberately excluded pending its separate lane.

### Final review happens after final integration
Status: planned.

Once all chosen final lanes are integrated, use Astra for one final review+fix of the exact candidate, then run the actual final E2E on that exact SHA. Avoid micro-review loops unless a high-risk ambiguity requires one.

### Native Masumi integrates as task remuneration, separate from purchase principal
Status: implemented and locally verified.

The completed native lane is integrated onto current main based on 84c0aef. Exact fee lock/result/payout and restart proof is retained; the combined local gate passed 735/735 tests across 35 files. Reauthorization and unresolved outcomes retain truthful core state, and late tasks never initiate a new native submission. Public Sokosumi marketplace delivery remains partial. See docs/work/MASUMI_INTEGRATION.md; the earlier pre-Masumi decision remains historical.
