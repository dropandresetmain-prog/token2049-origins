# Test checklist — Commerce Core

Local tests and external acceptance are separate. Fixtures are test-only, carry `local_fixture`, and never satisfy an external acceptance row. See [local verification](evidence/local-verification.md) for commands and [ACTIVE_TASK](work/ACTIVE_TASK.md) for blockers.

## Local checks

- [x] Strict TypeScript check and gateway production build.
- [x] Full contract/unit/integration suite: auth/scopes/ownership, immutable authority, money rounding, fee-only rejection, replay, concurrency, journal balance, reservation release/hold/consume and restart readback.
- [x] Prepared funding survives settlement-response loss and a real database restart; no second settlement or duplicate journal. Same-header pre-settlement retry receives fresh recovery work; startup repairs missing jobs.
- [x] Quote expiry checked after readiness, before provider commit markers, after verification and after awaited confirmation. Late submitted/confirmed/recovered funds remain refundable and never execute.
- [x] Read-only funding confirmation/recovery and ticket refresh continue after 12 attempts, including thrown transport errors, with manual-required events.
- [x] Currency/scale/amount anomalies retain exposure and principal liability. Subsequent matching/cancelled readback cannot erase the anomaly.
- [x] Numeric provider handles survive private checkpoints; public PII/token redaction remains active.
- [x] MCP gateway/bridge URL boundaries and redirect rejection; separate payer authority and client CLI role/customer binding.
- [x] Shopify raw HMAC before JSON, bad signature rejection, durable delivery dedupe, no payload-driven payment posting, strict Admin test-payment readback, no forbidden Admin mutations.
- [x] Atlas payment gate and explicit zero-fee checks; no paid claim from holds; independent reference/amount proof and forward-only ticket refresh.
- [x] Nuitée sandbox key guard, exact readback identities and ambiguity precedence over refusal codes.
- [x] Scoped evidence/bank reads, public inspect shell, persisted fixture provenance and read-only OCBC observations.
- [x] Compiled gateway startup, health/capabilities, public inspect and protected evidence smoke.
- [x] Sanitized readiness: every real adapter reports MISSING_CONFIG. Strict readiness exits 1 as expected.
- [x] Container build/runtime/browser/volume checks PASS on Linux ARM64; non-root Chromium launch, scoped auth and database/token persistence across restart. No public deployment/live checkout claim.

## Fresh external acceptance sequence

1. Provision receive-only Preprod treasury configuration, an official Preprod Blockfrost project, facilitator, disposable payer wallet with tADA and exact tUSDM, separate tokens for the SAME customer, reviewed caps and protected shared payer ledger. Verify supported network/scheme and independent chain access without printing secrets.
2. Provision own Shopify dev store/Bogus gateway and permissions. Independently resolve Atlas's founder payment-path decision; keep the flag false until approval. Provision verified LiteAPI sandbox key and OCBC API subscriptions/session access.
3. Run a fresh customer-authenticated search, exact quote and digest/max-total approval. Capture the funding challenge, identifiers and expiry, with secrets/PII removed.
4. Fund through the bounded payer. Confirm on independent Blockfrost: Preprod network, canonical transaction hash, exact treasury output/asset/amount, signed quote commitment and required depth. Confirm persisted core journal and reservation before merchant execution.
5. For EACH route, execute a new funded sandbox purchase once, independently retrieve it and capture the safe receipt. Shopify: test PAID + Bogus SALE/CAPTURE; Atlas: approved test balance + explicit zero fee + paid/ticket status; Nuitée: exact booking/client/hotel identities + sandbox simulated payment.
6. Capture a restart/timeout and duplicate webhook/funding retry against the sandbox without a second merchant write. Compare journal balance, exposure and public evidence labels. Preserve unresolved states; do not manufacture success to finish the checklist.
7. Capture OCBC masked account/card/transaction observations separately from purchasing evidence, marking inaccessible APIs and historical dates. They never reconcile simulated capacity to cash.
8. Save sanitized new evidence under `docs/evidence/` with environment, source, timestamp, implementation SHA, command, identifiers, readback result and caveats. Raw secrets/PII stay outside Git. Update external rows individually; readiness alone never changes a purchase row to PASS.

All eight steps currently remain BLOCKED_EXTERNAL. Solana funding, live Masumi/Sokosumi listing/task acceptance, polished console, demo/video/slides and final submissions are separate launch lanes and are NOT_RUN here.
