# Active task — post-integration planning baseline

## Goal

Plan and execute the minimum remaining work from the integrated main baseline, including native Masumi task remuneration, to a judge-ready TOKEN2049 Origins submission.

## Baseline

Repository: dropandresetmain-prog/token2049-origins

Latest integration base:
84c0aef7a7acd1851c590c54ccd8881b9dc365d5

Current tip: `git rev-parse HEAD`; current Masumi integration gate is docs/work/MASUMI_INTEGRATION.md.

Historical pre-Masumi integration local gate:
- 697/697 tests, 33 files PASS
- clean install/typecheck/build PASS
- PostgreSQL migrations/rerun PASS
- compiled gateway/MCP smoke PASS
- UI design asset sanity PASS
- bounded secret scan PASS

No deployment or new provider/payment/chain action occurred during integration.

## Integrated

- PostgreSQL
- progressive human orchestration
- explicit funding selection
- 1:1000 testnet settlement
- Cardano Preprod rail
- Solana Devnet rail
- native Masumi service-fee/task runtime; independently verified fee payout
- Shopify deterministic path
- Shopify Global discovery/shadows
- Atlas
- Nuitée
- OCBC
- HTTP + MCP
- proof/evidence
- approved Capsule UI V3 reference

## Pending / not proven

- actual Sokosumi public listing/platform authentication/task delivery
- runtime V3 UI
- deployment
- final combined E2E
- actual ChatGPT host connection
- final Astra review+fix
- submission package

Important external gaps:
- old Shopify paid attempt unresolved;
- Shopify Global exact sandbox quote partial/unresolved;
- Atlas ambiguous-create recovery unverified.

Do not retry old unresolved Shopify purchase pur_01M48PSSTDQDR4VGPAQPC2VRYZ.

## Required outcomes before submission

- [x] Integrate the verified native Masumi fee/task/payout lane without treating escrow as principal.
- [ ] Run demo seed/preflight audit for chosen final flow.
- [ ] Wire judge-facing V3 runtime enough for the canonical demo.
- [ ] Deploy exact candidate and verify runtime/browser/database/secrets.
- [ ] Verify host/client path used in the demo.
- [ ] Run Astra final review+fix on exact candidate.
- [ ] Run one final canonical E2E on that exact SHA.
- [ ] Capture fallback recording/screenshots/evidence.
- [ ] Reconcile track/submission requirements.
- [ ] Final README/setup/architecture/submission artifacts.
- [ ] Confirm no secrets committed.

## Constraints

- Protect known-good main.
- No speculative provider/feature expansion unless it materially improves judging.
- Unknown irreversible outcomes stop writes and reconcile; never blind retry.
- Preserve payer/sponsor histories.
- Do not overstate recorded evidence.
- Historical planning/evidence is not rewritten.
- Use current ROADMAP/KNOWN_ISSUES/ENVIRONMENT/architecture/demo docs.

## Next action

Start a fresh planning chat from main @ 8a76225364bf3b56fe2bf192297ee17b86d8f540. Inspect repository/current docs and decide the shortest path through remaining P0 work. Do not auto-start implementation before the plan is approved.

## Partner-lane integration ledger (branch integration/partner-lanes-final)
Base 5343235ebe6c341abdda95450065950a3d1051b7. Lane merge-base was 0234d20 (ancestor of main); commits were cherry-picked, no stale history merged. Not merged to main, not deployed.

| Lane | Status | Checkpoint | Conflicts | Focused tests |
|---|---|---|---|---|
| Chainlink CRE | PASS (code/sim evidence only) | df1a2c0 | none | bun 6/6, tsc clean |
| Hosted Solana MCP | PARTIAL | 82df9a4 | package.json, hosted-mcp config/router/integration test, bridge.ts private-mode removed on main | 234 hosted/payer/integration tests |
| Sokosumi | PARTIAL (no listing/job proof) | e6da869 | none | 45 Sokosumi/Masumi |
| Coinbase CDP | PARTIAL (zero sandbox accounts) | 2319681 | package.json scripts only; lock unchanged | 10 CDP |

Open decisions for Min Htet: Solana paid private service + persistent disk (or port Solana history to PostgreSQL); Sokosumi listing/live task evidence; CDP wallet/testnet proof.
