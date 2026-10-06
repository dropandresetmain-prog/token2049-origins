# Current Capsule issues

Integration base: main @ 84c0aef7a7acd1851c590c54ccd8881b9dc365d5; native Masumi integration checks are in docs/work/MASUMI_INTEGRATION.md.

Historical issue ledgers remain in docs/evidence/. This file contains only current actionable triage.

## Act Now

| Issue | Action | Risk if deferred |
| --- | --- | --- |
| Protected Cardano/Solana signer histories and canonical private configuration must survive all future runs. | Before spending, use the bounded payer/sponsor and existing protected absolute histories. Never reset ledgers or run legacy signers concurrently. | Duplicate/out-of-policy spend or lost recovery authority. |
| Runtime UI V3 is not wired. | Implement the minimum V3 transaction/proof console needed for the stage demo, using real authenticated data. | Judge sees engineering shell/raw proof instead of the intended product. |
| Final demo seed/preflight is not systematized. | Implement/read through docs/demo/SEED_DATA.md before final E2E. | Demo fails on missing products/rates/wallet balances/config despite green code. |

## Investigate Now

| Issue | Action | Risk if deferred |
| --- | --- | --- |
| Historical Shopify submissions remain unresolved, including pur_01M48PSSTDQDR4VGPAQPC2VRYZ. A fresh corrected purchase now has independently verified paid test order #1001 and a receipt. | Preserve old attempts; never retry their Pay. Use same-order Admin reconciliation only. See the 2026-10-07 repair evidence. | Retrying old attempts risks duplication; fresh acceptance does not establish their outcome. |
| Shopify Global paid acceptance remains unexecuted. Exact sandbox quote now passes after the uppercase FREE parser repair. | Retain the ambiguity guard and verify the final approved funding/provider composition separately. | Global quote PASS and canonical paid Shopify PASS are not a paid Global end-to-end result. |
| Shopify Global Catalog reduced transaction-retention interpretation remains unclear. | Clarify against official guidance before broader/deployed operation. | Possible provider-usage-policy mismatch. |
| Atlas ambiguous-create recovery is NOT VERIFIED. | Verify read-only lookup/recovery only if Atlas becomes canonical/final-demo critical. | Unknown create could remain unresolved; blind repeat is unsafe. |
| ChatGPT host MCP connection is NOT VERIFIED. | Test actual host only if it materially improves judging/submission. | Protocol pass may not translate to host connectivity. |
| Deployment is NOT VERIFIED. | Deploy exact candidate; verify final origin, DB, browser, provider tokens, market and rail readiness. | Local success may not survive hosted runtime. |
| Actual Sokosumi marketplace delivery remains unverified after native Masumi integration. | Prepare approved public host/listing metadata, prove platform-to-agent authentication and run a bounded real platform task if needed for the demo. Keep fee and principal separate. | Native protocol success can be mistaken for marketplace acceptance. |
| Native ordinary Masumi withdrawal summaries are unreported; some recipient/refund/dispute variants are unsupported. | Use exact independent tagged chain payout proof; fail closed for unsupported variants and reject conflicting nonempty API amounts. | Empty summaries can be mistaken for zero earnings; unsupported variants need reconciliation. |
| Solana stock-client interoperability is limited by authenticated /prepare. | Use the provided payer for demo; redesign durable stock-client preparation only if required. | Do not claim universal stock x402 client compatibility. |
| Render free DB was recorded to expire 5 Nov 2026 14:55 Singapore with no managed backups. | Recheck before use; export before expiry. | Hosted data loss later. |

## Park for Later

- Shopify Singapore market support.
- FX/cross-currency execution.
- shadow cleanup scheduling.
- delegated agent budgets.
- production/mainnet funding.
- audited operator refund/correction tooling.
- write-only client retry ergonomics.
- bank observation stable private identity.
- strong human/wallet-session attestation.
- HA/distributed workers and lease renewal.
- generic browser commerce and arbitrary merchant-account linking.

## Hosted MCP

- **Unverified externally until provisioned:** the real ChatGPT OAuth/DCR handshake and the free payer's behaviour on Render (cold starts, Postgres connectivity from the payer service) are verified only by local/fixture tests; the provisioning script's final no-spend smoke is the first live check.
- **Operational:** free services sleep (first request after idle can take ~50 s, longer for two services); 750 free instance-hours per month are shared by all free services in the workspace; the Render Postgres instance has an expiry date.
- **Live offers vs. caps (decision needed before a real purchase):** the cheapest live travel adapter totals about USD 43.19 payable (43,190 base units at the 1:1000 testnet scale) while the protected payer's remaining cumulative headroom is 35,170 of 102,000. The payer (and the quote/`buy` guard) refuse it. Raising the cumulative cap is an owner decision; tooling never does it.
- **Latency:** a live-offer quote takes ~2 minutes and order execution is similarly slow on the free 0.1-vCPU gateway; the conversation needs several "still running" polls.
- **Cap headroom:** the canonical payer's current caps (102,000 base units cumulative) leave limited headroom after earlier spends; the payer refuses (never raises) a purchase above it. The provisioner's pre-spend report shows the exact headroom.
- **Accepted:** single-owner passcode consent with global (not per-IP) lockout; stateless `/mcp` with no SSE; a failed or unconfirmed first payment attempt is not resent by the same `buy` (check `get_purchase`, or request a fresh quote); a payer crash mid-signing leaves a `signing` ledger row that blocks only that purchase until an operator reconciles it.

## Ignore / Accept Risk for hackathon

- Shopify throttling/keyless Catalog quotas: use bounded retries, quiet windows and no probe spam.
- Existing broad Shopify provisioning scopes: minimize after hackathon; do not expand casually.
- One gateway/worker topology and bounded DB advisory-lock throughput.
- Windows file-mode limitations: protect private directories with OS ACLs.
- Supplied Cardano/Solana payer integration requirements.
- Finite Shopify order-discovery window and retained test shadows.
- Cross-currency anomaly valuation remains manual.
- Testnet assets/simulated fiat/sandbox provider payment are not production settlement.
- Solana optional peer warnings remain with the tested lockfile.

## Evidence rule

Local tests never close an external issue. Update this file only when runtime/code or retained external evidence actually changes the classification.
