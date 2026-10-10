# Current Capsule issues

## Consolidated payer candidate triage — 10 October 2026

| Classification | Finding / recommended action | Risk of deferral / blocker |
|---|---|---|
| Act Now | Existing PostgreSQL 18 expires 5 Nov 2026 at 14:55:54 Singapore; establish approved internal consistent backup/export and restore evidence. No managed Free backup. | Financial history may become inaccessible; backup method/status is unresolved before cutover. |
| Act Now | Stop old commerce/signing processes and revoke old credentials before granting consolidated authority. Legacy images do not obey new database grants. | Concurrent signers/divergent history; mandatory owner-approved cutover gate. |
| Investigate Now | Measure exact candidate on Render Free, selected-rail initialization, memory and host behavior. | Local tests/builds cannot establish hosted readiness; pending approved deployment. |
| Investigate Now | Verify remaining workspace hours/build/bandwidth and spend settings; same quota serves unrelated projects. | Cannot certify no-spend capacity from published limits; account evidence pending. |
| Investigate Now | Verify final Solana exposure and complete Sui migration/old receipt access from protected retained history. | Lost caps/proof/recovery authority; final import and history reconciliation gated. |
| Park for Later | Consumer wallet onboarding, advanced orchestration and infrastructure replacement. | Outside current demo scope; synthetic isolation covers ownership contracts. |
| Ignore / Accept Risk | Free service sleep/restart and cold-start latency. | Accepted only with durable idempotency/readback; no warm-up requirement. |

Candidate live provider/rail rows are all NOT RUN. Existing hosted history is retained evidence, not consolidated runtime acceptance. Approval/cutover and rollback boundaries: [runbook](architecture/CONSOLIDATED_PAYER.md). The issue history below predates this candidate and must be read against these current gates.


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
- **Spend limits (owner-authorised 50x on 2026-10-07):** payer per-payment/daily/cumulative 5,100,000 base units (was 102,000), max fee 2,500,000,000 lovelace (was 50,000,000), max ADA output 10,000,000,000 lovelace (was 200,000,000); gateway `DEMO_PER_PURCHASE_LIMIT_USD_MINOR` 2,500,000 (USD 25,000; default was 50,000) and `SIMULATED_CARD_CAPACITY_USD_MINOR` 10,000,000 (USD 100,000; default 200,000). The payer's real exposure is still bounded by the wallet balance (about 104 tADA / 99.9 tUSDM) and by its cumulative cap, which includes the imported history (66,830 committed). The authorised payer policy lives in the protected payer directory (`.env.hosted-policy`), which the provisioner prefers.
- **Latency:** a live-offer quote takes ~2 minutes and order execution is similarly slow on the free 0.1-vCPU gateway; the conversation needs several "still running" polls.
- **Accepted:** single-owner passcode consent with global (not per-IP) lockout; stateless `/mcp` with no SSE; a failed or unconfirmed first payment attempt requires read-only `get_purchase` and reconciliation; never request a fresh quote to bypass an ambiguous attempt; a payer crash mid-signing leaves a `signing` ledger row that blocks only that purchase until an operator reconciles it.

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
