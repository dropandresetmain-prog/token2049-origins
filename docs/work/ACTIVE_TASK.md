# Active task — post-integration planning baseline

## Goal

Plan and execute the minimum remaining work from the verified pre-Masumi main baseline to a judge-ready TOKEN2049 Origins submission.

## Baseline

Repository: dropandresetmain-prog/token2049-origins

Authoritative main:
8a76225364bf3b56fe2bf192297ee17b86d8f540

Pre-Masumi integration local gate:
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
- Shopify deterministic path
- Shopify Global discovery/shadows
- Atlas
- Nuitée
- OCBC
- HTTP + MCP
- proof/evidence
- approved Capsule UI V3 reference

## Pending / not proven

- Masumi/Sokosumi integration
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

- [ ] Decide/integrate or explicitly exclude final Masumi lane.
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
