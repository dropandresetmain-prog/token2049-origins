# Architecture decisions and boundaries

Release: `launch-2026-10-06-v1`.
This supersedes the previous planning checkpoint `ae9297fca6c725f3b370ed69f97dcedeaf02b6f9` where later conversation changed a decision. It does not claim any implementation has passed.

## Founder decisions carried forward

1. **Product:** one purchasing capability for customers' existing agents, spanning ordinary commerce. Do not reopen generic ideation or sell retries/recovery as differentiation. Existing competitors do not invalidate building our own implementation.
2. **Core commerce:** Shopify retail, Atlas flights and Nuitée hotels. Shopify was never approved for demotion. A blocked integration remains a core blocker, not a newly optional feature.
3. **Money:** internal treasury, USD reporting currency, native asset quantities retained. Cardano Preprod and Solana Devnet use genuine wallets and test stablecoins; tADA/SOL are needed for fees and chain-specific account/output requirements.
4. **Fiat/cards:** OCBC is the intended bank/card relationship. Build our own narrowly scoped simulation/accounting; do not add Lithic, Reap, Airwallex or another card simulator to the launch stack. Shopify's test gateway supplies merchant-side test-payment evidence. A live low-value purchase requires later explicit authorization.
5. **Supplier independence:** supplier credit/prefunding is stretch. Atlas/Nuitée are ways to reach inventory, not privileged suppliers or mandatory treasury pools. One agent contract can use protocols, platform APIs, provider APIs and eventually browser/payment execution.
6. **Channels:** ChatGPT plugin, Claude/Cursor/Codex MCP and Sokosumi Coworker are outside core commerce. No channel writes the ledger or duplicates booking/checkout logic.
7. **New Cardano route:** build Masumi/Sokosumi in parallel with the original plan, then integrate. The organizer's marketplace preference makes a listed, runnable Preprod Coworker a track priority; it is not evidence that the broad published eligibility rules changed.
8. **UX:** customer agent owns shopping conversation; our separate console shows purchase, funding, treasury and merchant evidence. Security feature: spending capability without exposing raw keys or card details to the model.
9. **Identity:** guest commerce first. Existing merchant-account linking and assisted registration remain future capabilities, not already-supported features.
10. **Work style:** Opus continues while Min Htet provisions accounts/keys. Credential waits must not stop independent implementation. No fabricated integrations or silent scope cuts.

## Engineering corrections required by those decisions

These are implementation safeguards, not newly approved feature exclusions.

### OCBC is not an assumed card-network simulator

Existing access was described in conversation as account/card reads. No current test proves that a Shopify test checkout reaches OCBC, issues an OCBC virtual card, mutates an OCBC sandbox account or produces an OCBC card transaction. Keep observed bank/card snapshots separate from internally simulated purchasing capacity. A merchant paid event does not establish bank settlement.

### A credit-card purchase is not automatically a cash withdrawal

Separate spending-capacity reservations, merchant payment evidence, card payable and actual bank movement. Do not decrement an OCBC balance or claim cleared issuer settlement from a Shopify webhook alone. Receiving crypto does not create fiat cash; a sandbox capacity seed must be explicitly synthetic and separately accounted for.

### Existing Atlas reuse has a payment constraint

Read-only source inspection found `src/providers/atlas/transactionAdapter.ts` in `qoder-atlas` at `e79c387ebacc5a9e4a9350666e0dd8a501921d01`. Its documented payment path is `pay.do` with a sandbox test-balance handle; it is not an OCBC-card path.

Keep Atlas core. Verify available card/test-payment options. Do not import that supplier-balance path as the default architecture. If the only provider-generated sandbox booking requires its test balance, record the exact conflict and request a bounded sandbox-only exception; continue all other work. Neither silently restore supplier prefunding nor relabel test balance as card spend.

### Masumi task earnings and purchase principal are different

The workshop's page 10 shows a result/payment request before Sokosumi funds escrow, followed by payout after a dispute window. That is not proof that dynamic purchase principal is safely funded before an irreversible order.

The parallel lane must establish actual protocol timing, dynamic amount support and the meaning of any escrow signal. A task fee, reported credits, a payment request or a channel callback is not purchase funding. Preserve separate principal and service-fee evidence. Keep the direct funding route usable while resolving this.

### Sandbox evidence is not production settlement

A Shopify test payment can prove merchant-side test behavior. A Cardano/Solana transfer can prove testnet funding. Matching them through our journal does not prove that Visa linked the sandboxes, that test assets were redeemed, or that a physical product/room/ticket was fulfilled.

### Shopify checkout must actually complete

Cart creation, `continue_url`, Admin order creation or `orderMarkAsPaid` is not proof that a buyer paid an independent merchant. Use supported buyer checkout and test-payment completion on a controlled development store. Store-admin access may provision test products and independently verify results; it must not manufacture the claimed purchase.

### Credentials stay outside model-visible surfaces

Use credential references and a restricted executor/signer. Redact logs, traces, browser screenshots, crash output and tool results. Do not store a real CVV in `.env`, a vault or a database for repeated future purchases; do not retain it after authorization. No production-card collection or live payment is authorized for this first lane.

## Overall parallel architecture

```text
ChatGPT plugin / MCP clients / Sokosumi Coworker / future channels
                              |
                   authenticated core contract
                              |
              authorization + quotes + purchases + journal
                    /                         \
       funding verification                commerce execution
       Cardano / Solana / Masumi*           Shopify / Atlas / Nuitée
                    \                         /
                       evidence and receipts
```

`*` Masumi funding support is distinct from the Sokosumi channel wrapper and is integrated only after its payment semantics are established. Provider and chain SDK types must not leak into the core contract.

## Supplier universality: precise claim

The common contract removes client-specific integrations. Platform/protocol connectivity can extend merchant reach without one integration per shop. Generic payment credentials do not by themselves operate an arbitrary website, bypass login/CAPTCHA or guarantee acceptance. Broad browser execution remains a later capability; the controlled Shopify checkout worker is allowed in core as the retail execution mechanism.

## Issue triage

| Issue | Classification | Required action |
|---|---|---|
| Prior scope drift / stale “do not implement” notes | Act Now | Use this release and preserve scope/lane matrix |
| Missing external credentials | Investigate Now | Record readiness per integration; keep implementing independent work |
| Atlas sandbox payment method vs supplier-credit decision | Investigate Now | Prove permitted mechanism; surface exception rather than hiding it |
| Masumi fee/principal timing | Investigate Now | Parallel lane establishes evidence before spending integration |
| Unknown provider result after timeout | Act Now | Reconcile; never assume safe to spend again or release exposure |
| Fake funding bypass or unsigned success callback | Act Now | Reject in runnable service; tests only use isolated fixtures |
| Funding shortage for full quoted test purchase | Investigate Now | Fund wallets sufficiently; never silently charge pennies for a full-price purchase |
| Native SDK/runtime compatibility | Investigate Now | Bound the spike; pin a working combination |
| Production off-ramp/card issuance/licensing | Park for Later | No production claim or real-money operation |
| Extra supplier rails, exchange demo, NOWNodes | Park for Later | Not allowed to displace core |
| Guaranteed merchant coverage and distributed exactly-once claims | Ignore / Accept Risk | Do not make those claims; document bounded supported coverage |
