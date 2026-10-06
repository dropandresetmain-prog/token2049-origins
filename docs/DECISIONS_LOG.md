# Capsule decisions log

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
