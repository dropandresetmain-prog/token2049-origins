# Current Capsule issues

Pre-Masumi integration. This is the current operational triage; older lane dispositions are
historical evidence in Git and the append-only E2E/Global reports. Local passing tests do not
resolve external gaps. See [verification](evidence/pre-masumi-integration.md) and
[retained provider results](work/COMPLETED_LANES.md).

## Act Now

| Issue / why it matters | Recommended action | Risk of deferring |
|---|---|---|
| Future signer use must preserve canonical configuration and protected Cardano/Solana histories. Existing Cardano budget is exhausted; a legacy independent signer bypasses it. | Before any future authorized spending, use the bounded payer and existing absolute shared ledger; privately provision canonical names. Never reset histories or run the legacy signer concurrently. No provisioning/spending performed here. | Duplicate/out-of-policy spending or lost recovery authority. This does not block offline integration. |

Resolved in this candidate: missing Solana ws runtime peer and incomplete gateway example config.
Inherited safety fixes remain implemented: durable funding recovery, lease fencing, fee scaling,
explicit funding selection, conservative unknown outcomes, strict provider readback, bounded payer
history, current Shopify PCI/actionability/diagnostics and retained-shadow discovery exclusion.
These are not open issues; their original evidence is preserved.

## Investigate Now

| Issue / why it matters | Recommended action | Risk of deferring |
|---|---|---|
| Deterministic Shopify paid acceptance is UNRESOLVED: pur_01M48PSSTDQDR4VGPAQPC2VRYZ had one Pay, held reservation, no confirmed order/receipt. Zero orders does not prove not-sent. | Reconcile only the original attempt read-only; do not retry/mutate or create replacement payment. Preserve evidence. | Unknown merchant outcome and blocked paid acceptance; retry could duplicate. |
| Original abandoned-checkout lookup lacks protected AbandonedCheckout approval despite read_orders. | Obtain original Admin Timeline evidence through an authorized human lookup. No scope expansion here. | Original error/root cause remains unavailable; fresh browser strings cannot reconstruct it. |
| Global shadow exact sandbox quote remains unresolved; shipping/tax/total never froze. | Investigate original row/rate/tax mismatch in a future authorized read-only check; preserve strict quote checks. | Global lane remains PARTIAL; parser fixtures cannot prove external quote/order acceptance. |
| Official Catalog transaction-offer retention interpretation is unconfirmed. | Clarify reduced durable transaction snapshots against official no-caching guidance before wider/deployed operation. | Possible usage-policy conflict; do not broaden retention claims. |
| Atlas ambiguous-create lookup/recovery NOT_VERIFIED. Ticketing evidence passed separately. | Verify safe read-only recovery in a separately authorized acceptance task; do not repeat uncertain create. | An unknown created order can remain unresolved; blind repeat risks duplication. |
| ChatGPT host MCP connection NOT_VERIFIED. Protocol tests use fixtures/local core. | Test actual host connection in a later authorized task, preserving canonical tools/authority. | Host authentication/delivery may fail despite protocol PASS. |
| Deployment environment, token validity, public origin, browser architecture, US market and rail readiness remain unverified. Template alone is not runtime proof. | Verify actual configuration at an authorized deployment checkpoint; use public Storefront auth, DATABASE_URL and BLOCKFROST_PROJECT_ID; preserve histories. | Unusable checkout/rail or changed funding commitments. No deployment in this integration. |
| Recorded free Render DB expires 5 November 2026 at 14:55 Singapore, no managed backups. | Recheck service metadata before use and export before expiry; paid upgrade needs authorization. | Hosted data/access loss; recorded date is historical metadata, not a fresh check. |
| Solana requires authenticated /prepare and the provided payer. | Use supplied payer; design durable stock-client preparation separately before claiming interoperability. | Stock clients are rejected; no universal x402-client compatibility claim. |

## Park for Later

| Issue / why it matters | Recommended action | Risk of deferring |
|---|---|---|
| Shopify SG market unsupported. | Add evidenced sellability/currency/shipping support separately; current sandbox live lane is USD/US only. | SG purchases unavailable; do not silently substitute market. |
| Masumi NOT INTEGRATED / PENDING SEPARATE LANE. | Integrate only its completed verified checkpoint later. | Current baseline does not include that lane. |
| UI V3 runtime implementation, polished console/submissions. | Consume approved DESIGN.md/assets in a separate UI milestone. | Current runtime retains existing proof/inspect views; design approval is not runtime completion. |
| FX, shadow cleanup scheduling and delegated budgets. | Keep USD/item/quantity caps and retained audit shadows until separately designed. | Limited scope and growing retained test inventory. |
| Operator mutation/refund tooling and stale signer-lock/reservation recovery. | Design audited proof-based reconciliation; never repair by history deletion or raw mark-paid/journal edits. | Held exposure/limits require manual attention; automatic refunds unavailable. |
| Write-only custom purchase clients cannot retrieve idempotent retry views. | Keep default read+write scopes or define combined retry scope separately. | Custom clients may fail retry authorization. |
| Masked bank last-four identifiers can collide. | Add private stable pseudonymous identity when needed. | Distinct observation projections can collapse; journal/capacity unaffected. |
| Strong human/wallet-session attestation; distributed/HA workers and lease renewal. | Treat as separate milestones; keep bounded one-gateway/worker topology. | Current approval proves channel submission, and HA behavior is not validated. |
| Additional live funding crash windows; mainnet, Token-2022, ALTs, remote sponsor hosting. | Retain local recovery coverage and supported Preprod/Devnet scope; test separately if requested. | Unsupported paths remain unproved or fail policy checks. |

## Ignore / Accept Risk

| Constraint / why it matters | Guard / recommended action | Risk accepted |
|---|---|---|
| Shopify throttling, broad existing provisioning scopes, unspecified keyless Catalog quota and public Devnet RPC limits. | Bounded retries/backoff, quiet windows, no repeated cart probing or blind Pay/transfer retry. Minimize scopes later; never invent buyer IP. | Availability delays; finite hackathon provisioning exposure. |
| Core/proof reads use bounded advisory locks; one worker topology. | Keep external I/O outside transactions and current concurrency/idempotency tests. | Limited throughput; lock contention fails safely. |
| Windows mode 0600 is best effort; privileged operators can bypass shared signer history. | Apply private OS ACLs and sole signer access; one canonical absolute history path. | OS/operator trust remains required; Cardano incidental ADA bounded by wallet/per-transaction caps. |
| Legacy frozen quotes/obligations lack current option IDs or scaled policy. | Requote new buys, preserve old digests/amounts/origins/recovery. | Hardened payer rejects old new-payment challenges; no silent rewrite. |
| Cardano commitment and Solana co-sign flow require supplied payers. | Reject unsupported signatures and preserve exact immutable candidate. | Third-party clients need the documented integration seam. |
| Shopify finite order-discovery window and untracked sandbox inventory. | Persist direct handles, use verified webhook hints; source shadow provenance required. | Missing order may need manual lookup; test inventory does not prove real fulfillment. |
| Cross-currency anomalies have no automated valuation; source item observation is not merchant all-in price. | Hold exposure and label sandbox shipping/tax/total; reject unsupported FX. | Manual financial reconciliation; no source merchant order/payment claim. |
| Testnet assets, synthetic fiat/card capacity and sandbox provider payment. | Retain 1:1000 and fixture/sandbox disclosures, including funding fixture labels. Nuitée USD 96.24 fee evidence applies only to tested method. | No production, FX/redemption, bank/Visa settlement or economic equivalence claim. |
| Payer source identity/status is configured identity, not wallet balance/cap approval. | Payer enforces caps before signing; never switch rail silently. | A valid quote can still be refused by payer. |
| Solana transitive optional TypeScript peers still declare ^5 with pinned TypeScript 6. | Preserve tested lockfile; current strict typecheck/build and all runtime suites pass. | npm peer warnings; revalidate compatibility when upgrading dependencies. |
