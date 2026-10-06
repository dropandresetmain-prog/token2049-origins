# Test checklist — Commerce Core

Local tests and external acceptance are separate. Fixtures are test-only, carry `local_fixture`, and never satisfy an external acceptance row. See [local verification](evidence/local-verification.md) for commands and [ACTIVE_TASK](work/ACTIVE_TASK.md) for blockers.

## Human orchestration checks

- [x] Missing flight destination/date, hotel dates and retail query/reference produce controlled `needs_input`.
- [x] Nested contact/passenger/address/document fields collect progressively; malformed/unknown fields refuse.
- [x] Complete canonical schemas remain strict; no conversational drafts or fabricated demo answers.
- [x] Provider requirement allowlist and array bounds; unmodelled/out-of-phase requirements fail safely.
- [x] Selected option required, quote-scoped and persisted with approval; no Cardano default or independent client rail.
- [x] Selected option is frozen; worker refuses changed payment-choice approval before merchant execution.
- [x] Missing/blocked rails excluded; configured/passed allowed, fixtures selectable only in tests; multiple ready fixture rails have no default.
- [x] Authenticated payer status exposes only public identity, does not sign/call providers and refuses secret fields.
- [x] MCP shows matching public source and blocks mismatched source before purchase creation.
- [x] Repeated matching buy follows one purchase, including alternate keys and submitted/unknown/confirmed payments; no second funding on refusal.
- [x] Human projection covers every purchase state and finality/payment/merchant combinations without recovery jargon.
- [x] Owner-scoped proof stops at actual pending/unresolved boundary; no invented references; receipt excludes private/treasury data.
- [x] Browser fixture check: pending, complete and verifying views; exact commercial/testnet amounts, 1:1000 disclosure, masked source, expandable evidence and session clearing.
- [x] Existing settlement/Cardano/journal/Atlas/payer/PostgreSQL concurrency/recovery regressions stay green.
- [x] Strict typecheck, production compile, compiled gateway and MCP stdio smoke, local readiness and diff checks.
- [ ] Independent Opus review of the complete orchestration branch against reviewed PostgreSQL baseline.
- [ ] External acceptance: NOT_RUN. Review precedes any Shopify rehearsal, deployment or payment.

## PostgreSQL migration checks

- [x] Official postgres:18 local Compose service starts healthy on loopback; fresh volume/empty schema migration.
- [x] Ordered/checksummed migrations, concurrent startup, idempotent rerun, and failed-history startup guard.
- [x] Real PostgreSQL in all persistence tests; random schemas per fixture, no cross-file truncate/reset.
- [x] Transaction/savepoint rollback, exact huge integer amounts, immutable balanced journal across connections.
- [x] Two-gateway buy idempotency/quote uniqueness/capacity correctness; competing funding exclusion.
- [x] FOR UPDATE SKIP LOCKED skips a locked job; live leases are preserved; stale claim completion is fenced.
- [x] Funding/provider restart and readback recovery after fixture PostgreSQL session loss.
- [x] Compiled gateway process restart retains client ownership/auth; health/capabilities/inspect/401 guard pass.
- [x] Render free PostgreSQL TLS connection, migrations and isolated SQL write/read; external access restricted.
- [x] No provider purchases/payments during migration; no gateway deployment or change to existing resources.

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

## External acceptance hardening — local regressions

- [x] Strict demo JSON boundary; canonical scenarios consume the typed SSOT; relative search dates.
- [x] USD 1.00 / 10.00 / 183.40 / 123.47 / zero / limit convert exactly; unsupported currency/precision reject.
- [x] Quote digest binds policy; current demo policy edits and process restart preserve the original stored amount.
- [x] Commercial principal/fee/total and chain principal/fee/total persist and remain visible in evidence/receipt.
- [x] Wrong signed scale, amount, asset, payee, network or decimals refuses before facilitator calls.
- [x] USD 100 + USD 1 fee becomes 0.100000 + 0.001000 = 0.101000; journal balances per distinct asset.
- [x] Absolute existing protected ledger accepted; missing/relative/malformed path or vanished history refuses.
- [x] First-time offline setup initializes ledger; existing wallet with missing history demands reconciliation.
- [x] Atlas closed gate refuses quotes/funding and all execution writes; gate-on behavior/readback retained.
- [x] Worker error logging omits SQL detail, credentials and raw provider bodies; durable retries unchanged.

External evidence remains **NOT_RUN**. Independent hardening review precedes the separate UNFUNDED
Shopify rehearsal. Shopify IN-1 and Atlas IN-2/IN-3 are unchanged blockers; do not start these actions here.

## Fresh external acceptance sequence

1. Provision receive-only Preprod treasury configuration, an official Preprod Blockfrost project, facilitator, disposable payer wallet with tADA and exact tUSDM, separate tokens for the SAME customer, reviewed caps and protected shared payer ledger. Verify supported network/scheme and independent chain access without printing secrets.
2. Provision own Shopify dev store/Bogus gateway and permissions. Independently resolve Atlas's founder payment-path decision; keep the flag false until approval. Provision verified LiteAPI sandbox key and OCBC API subscriptions/session access.
3. Verify the disclosed scaled-testnet policy and protected existing payer ledger. Run a fresh customer-authenticated search, exact quote, explicit option selection and digest/max-total/selected-option approval. Capture the funding challenge, identifiers and expiry, with secrets/PII removed.
4. Fund through the bounded payer. Confirm on independent Blockfrost: Preprod network, canonical transaction hash, exact treasury output/asset/amount, signed quote commitment and required depth. Confirm persisted core journal and reservation before merchant execution.
5. For EACH route, execute a new funded sandbox purchase once, independently retrieve it and capture the safe receipt. Shopify: test PAID + Bogus SALE/CAPTURE; Atlas: approved test balance + explicit zero fee + paid/ticket status; Nuitée: exact booking/client/hotel identities + sandbox simulated payment.
6. Capture a restart/timeout and duplicate webhook/funding retry against the sandbox without a second merchant write. Compare journal balance, exposure and public evidence labels. Preserve unresolved states; do not manufacture success to finish the checklist.
7. Capture OCBC masked account/card/transaction observations separately from purchasing evidence, marking inaccessible APIs and historical dates. They never reconcile simulated capacity to cash.
8. Save sanitized new evidence under `docs/evidence/` with environment, source, timestamp, implementation SHA, command, identifiers, readback result and caveats. Raw secrets/PII stay outside Git. Update external rows individually; readiness alone never changes a purchase row to PASS.

All eight steps currently remain BLOCKED_EXTERNAL. Solana funding, live Masumi/Sokosumi listing/task acceptance, polished console, demo/video/slides and final submissions are separate launch lanes and are NOT_RUN here.

## Current canonical Capsule Shopify E2E — 2026-10-06

This section supersedes earlier NOT_RUN/BLOCKED_EXTERNAL statements only for the completed Shopify
unfunded rehearsal and local candidate checks below. It does not enable the other provider lanes.

- [x] Live canonical US variant and indicative USD 9.95 item price independently verified.
- [x] Production search -> one Storefront cartCreate -> delivery selection -> exact hosted checkout
  observation -> fresh browser execution rehearsal -> STOP before pay_click.
- [x] Settled item/shipping/tax/total frozen; absent API tax is not treated as zero. Selected explicit
  CartDeliveryAddress verified against the request and delivery group; post-observation cart bound.
- [x] US/NY, Standard shipping, store password, Bogus wording, real hosted frames and normal Pay
  actionability verified. No Pay click, new Admin order, purchase, payer process or Cardano transaction.
- [x] Shopify focused regressions 66/66; MCP/settlement/safety 102/102; PostgreSQL concurrency,
  idempotency and funding recovery 25/25 using isolated local schemas.
- [x] Full current candidate suite: 26 files, 514/514 PASS; strict typecheck and production build PASS.
- [x] Public Storefront authentication independently searched the canonical product without cart writes.
- [ ] Exact candidate SHA approved, main fast-forwarded and deployed; final HTTPS base URL bound.
- [ ] Actual Render environment aliases, token/scopes, migrations, browser/US market and Cardano/MCP
  readiness verified; payer remains local and unused at the deployed checkpoint.
- [ ] Fresh deployed exact quote and explicit Cardano funding source approved by the human.
- [ ] One Preprod funding attempt independently confirmed with exact asset/treasury/amount/commitment.
- [ ] Exactly one Shopify test PAID order, successful Bogus SALE/CAPTURE and independent Admin readback.
- [ ] Exactly one purchase/funding event/execution effect, balanced journal/reservation and matching proof
  receipt independently reconciled. Overall paid E2E remains PARTIAL until these checks pass.

All issues and seed mismatches remain in docs/evidence/e2e-acceptance-log.md; current sanitized passing
artifacts are under ignored artifacts/e2e/20261006T130100Z-selected-address/. Do not repeat the successful
unfunded rehearsal merely to fill a checklist. One final independent reconciliation review follows a
full PASS or a genuine terminal/ambiguous blocker; no per-fix review loop.

### Shopify-only paid attempt with fixture funding — terminal outcome

- [x] One real production cart/quote, one isolated local purchase, one clearly local_fixture funding
  event, normal worker, durable pay_click checkpoint and one normal Bogus submission.
- [x] No frozen cart changes/throttle; exact USD 17.95 maintained before Pay.
- [x] Timeout classified unresolved; capacity held, no fabricated receipt/provider reference.
- [x] Independent Admin currently returned 0 new/bound orders; this is not definitive no-effect proof.
- [x] Local DB trial balance remains zero; proof projection says Verifying result and local_fixture.
- [ ] Shopify paid order, successful Bogus transaction and independent matching provider result.
- [ ] Final receipt and completed proof UI. These were NOT reached and must not be marked PASS.

Issue 31 is a mandatory ambiguity stop. No automatic retry, new order or replacement funding.
Current overall verdict UNRESOLVED. Preserve original state and wait for read-only reconciliation.

### Read-only investigation and diagnostic regressions

- [x] Original cart/order reads; no new cart, worker tick, Pay, funding or payer.
- [x] Bogus inputs match official guidance; no mismatch established.
- [x] abandonedCheckouts HTTP 200 / ACCESS_DENIED for protected-data approval; no scope expansion.
- [x] Passive post-Pay snapshot before browser closes; no raw text or field values.
- [x] Four regressions: timeout, throwing diagnostics, post-Pay challenge, actual Pay failure;
  original errors and single submission/checkpoint preserved.
- [x] Focused 78/78, full 518/518 (26 files), typecheck/build/migrations PASS.
- [ ] Original abandoned-checkout Timeline error/outcome obtained from human.
- [ ] Issue 31 authoritatively reconciled; zero orders/fresh page are insufficient.
- [ ] Paid Shopify/readback/receipt PASS. Overall UNRESOLVED; no Pay retry.
