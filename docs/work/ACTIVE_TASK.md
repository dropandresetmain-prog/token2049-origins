# Capsule scoped E2E reliability and customer-experience repair
Updated 12 October 2026 Singapore. Re-read before resuming work or any irreversible action. Distinct UX/reliability milestone; the long infrastructure history is preserved separately.

## Objective
Implement the repairs from the completed owner E2E investigation through code, focused verification, documentation, checkpoint commits and a deployment-ready handoff. Stop at READY_FOR_OWNER_AUTHORIZATION. No deployment, no live quotes, no purchase/payment/broadcast/provider write, no authoritative database mutation, no key relocation, no cap/policy change.

## Corrected scope (five workstreams)
1. WS1 payment-state semantics: a nondefinitive outcome stays confirmation-pending, never a definitive rejected payment. Files: src/funding/sui/adapter.ts, src/funding/solana/adapter.ts, src/core/service.ts (verifyAndRecord + FundResult), src/channels/http/app.ts (fund route), clients/sui/pay.ts, clients/multiwallet/engines.ts, clients/payer/bridge.ts, src/channels/mcp/tools.ts, src/core/views.ts, shared progress/contracts. Canonical purchase state stays authoritative; a stale failed handoff must not override confirmed payment/completed commerce. Preserve durable reservations, signed-candidate persistence, recovery and exactly-once merchant idempotency. Never auto-retry payment POSTs, rebuild an uncertain candidate or switch wallets. Do not weaken definitive rejection.
2. WS2 quote continuation: an identical repeated request joins/safely collects the same operation across response loss and process restart; a completed quote must never be reported as an unavailable payment network. Smallest durable mechanism, no generic queue/workflow framework. Shopify quote prep can create a sandbox shadow product: prevent duplicate preparation and reject changed payloads under the same operation identity.
3. WS3 grounded confirmation + usable evidence: only a canonical completed purchase with independently verified funding and required merchant status may produce TICKET ISSUED / BOOKING CONFIRMED / ORDER CONFIRMED. Include clickable existing receipt/proof links; preserve access controls and redaction. Atlas itineraryDownload is plain HTTP on an IP host: validate secure transport before implementing; never expose an unsafe link or manufacture a ticket. Hotels: establish actual supported confirmation capability; discount/experience vouchers are not hotel booking documents.
4. WS4 currency + authorization UX: flight/hotel budgets are received/approved as exact USD terms (ChatGPT converts); preserve the original budget/reference, never silently discard or exceed it. Align schemas/tool instructions/validation errors; preserve retail FX enforcement. Clarify the owner passcode signs into the protected demo account, distinct from quote-specific purchase approval. Do not remove the login gate, change the passphrase, weaken scopes or assume a visible host permission card per purchase. Retain one clear sandbox/testnet disclosure.
5. WS5 bounded discovery + latency: inspect Shopify browser waits/resource pressure for small demonstrated improvements on the existing Playwright/Chromium path. Preserve genuine catalog images/descriptions/specs; distinguish merchant facts from inferred enrichment; translate neighborhood requests into grounded coordinates/radius; reuse nationality only from an explicit profile attribute bound to the actual guest. Keep bounded; do not delay WS1/WS2.

## Repository and checkpoint
- Remote: https://github.com/dropandresetmain-prog/token2049-origins.git.
- Repair branch: codex/capsule-e2e-reliability; worktree: C:/Dev/token2049-origins-e2e-reliability.
- Base checkpoint: 51ff776dea12adededd832890e8924a0e1936182 (docs: investigate owner E2E outcomes and scoped repair plan), verified clean and pushed.
- Deployed (read-only reference, unchanged): gateway 86f519450b1d61d5c42f8bbadb685b49f01ea798 dep-db5q9jdckfvc73b35c50; payer 3945f9c52cf76e1960569d53416361bcd42de175 dep-db5la02jnfac73ast890; Worker version 00ee6d4a-afdd-4807-ad05-f46d33fa1986.
- Canonical database: authorized Neon Free PG18 Singapore (unchanged). Main unchanged: 7c09b37eaaeda2bf3eec94fc1e3456118962f636.
- Prior ledger preserved: docs/work/NEON_MIGRATION_PRE_E2E_REPAIR_CHECKPOINT_20261012.md (byte-identical copy of the pre-repair ACTIVE_TASK.md).

## Incident anchors (read-only; never replay or mutate)
- Atlas/Sui VERIFIED: pur_01M4NRRCVHXW6GZEX35S7H20EM / quo_01M4NRP0XJZYP3GZH13PR8QT9Y; 74300 base units (0.07430 test USDC); digest Ay5s27wUT4GEtjQ2DtFTbgkVrbN8uQbxTrDYYLhrCCnX; checkpoint 393742179; Atlas order TESTA20261011232029042; receipt rcp_01M4NRT6FNB35NV4KQV7362Y1T. First read was nondefinitive payment_required, mislabeled payment_rejected/HTTP422, then same-digest recovery confirmed and Atlas ticketed with no second funding or merchant attempt.
- Shopify/Solana quote quo_01M4NSPKAB116PPJ9Z0KVGHVT2 USD20.99 (12.99+8 shipping+0 tax); Solana option fop_01M4NSPKAAVPSZ4EPHQ70PVZWS 20990 base units; prep 107.093s beyond the 45s MCP window; no pending collection or buy observed; quote expired.
- Nuitée/Cardano claimed booking 3899895 has no canonical record; existing-booking readback HTTP404/code4004 (unsupported). Three older expired incident purchases: do not retry or mutate.

## Constraints and authorization (verbatim)
- Authorizes: isolated code changes and justified dependencies; read-only deployed config/log/history inspection; offline fixtures and disposable native PostgreSQL tests; read-only inspection of existing provider records; exact-file checkpoint commits and pushes to the repair branch.
- Does NOT authorize: new live quotes creating provider state; purchases/prebooks/holds/orders/bookings/merchant writes; payment signing with existing keys, broadcasts or funding; key relocation, policy/cap changes or ledger resets; authoritative database mutations; deployment replacement, authority changes or main promotion.
- Continue all independent authorized work before requesting one consolidated release authorization. Do not repeatedly ask permission for routine coding.
- Preserve existing Render Free gateway/MCP/OAuth/console, one consolidated Render Free payer, existing Neon database, narrow health-only Cloudflare wake Worker, Atlas/Nuitée/Shopify integrations, original wallet identities/histories/sponsor roles/signer fences, existing 1:1000 scaling and aligned caps, and quote digest/selected source/explicit approval binding. No infrastructure migration, new application service, paid plan, keep-alive job, general retries or manual wake requirement.

## Task ledger
- [x] Isolated repair worktree at 51ff776; prior ledger preserved as dated checkpoint; this compact ledger written.
- [x] Investigated payment-state and quote-continuation code paths; WS1 misclassification chain fully traced (see evidence below).
- [ ] WS1 payment-state semantics repair + fixtures.
- [ ] WS2 durable idempotent quote continuation + fixtures.
- [ ] WS3 grounded confirmation + receipt/proof links + fixtures.
- [ ] WS4 currency contract + authorization UX alignment + fixtures.
- [ ] WS5 bounded discovery/latency improvements + fixtures.
- [ ] Verification: affected tests during implementation, then one justified integrated fixture gate; native PostgreSQL for changed persistence/locking; typecheck.
- [ ] One fresh independent review (financial states/authorization/idempotency/recovery/customer-facing claims), findings classified Act Now / Investigate Now / Park for Later / Ignore / Accept Risk.
- [ ] Documentation, ledger, manual sheet, READY_FOR_OWNER_AUTHORIZATION handoff.

## WS1 evidence (traced at 51ff776)
- src/funding/sui/adapter.ts:9 pending() = {ok:false, code:'payment_required', reason:'Sui outcome retained for independent recovery', settlementAttempted:true}; :30 definitive failure adds definitiveFailure:true.
- src/funding/solana/adapter.ts:77,86 share the same nondefinitive payment_required + settlementAttempted:true signal (payer_broadcast mode). Cardano returns ok:true/paymentState:'submitted' (already 202). Masumi returns payment_invalid/settlementAttempted:false.
- src/core/service.ts:674-691 verifyAndRecord journals funding.rejected and throws for EVERY non-ok verification, only special-casing definitiveFailure (closeFailedFunding) and settlementAttempted===false (delete candidate + reset not_received). The nondefinitive branch wrongly emits a terminal rejection while leaving payment_state='unknown' and the recovery candidate intact.
- clients/sui/pay.ts:101-109 forwards gateway funding status; only 202 marks the signer ledger accepted. clients/multiwallet/engines.ts:53 turns any non-202 Sui result into payment_rejected; clients/payer/bridge.ts:30 maps payment_rejected to HTTP422.
- src/channels/mcp/tools.ts:~510-549 persists the failed handoff and returns a rejected payment field, while its canonical status logic at :528 already reports confirmation_pending for unknown payment state, so the reply carries conflicting signals.
- src/core/views.ts:40,77 retains the historical failed handoff as audit evidence; it must not overrule canonical payment confirmation.

## Next action
Implement WS1 in the worktree: classify the nondefinitive funding result as confirmation-pending across service.ts (verifyAndRecord + FundResult), app.ts (202), and MCP presentation; keep definitive rejection and settlementAttempted===false unchanged; add fixtures (inconclusive funding then same-digest confirmation: one candidate, no retry, one merchant execution, pending then final headline; plus lost-response and stale-failed-handoff display). Then WS2-WS5, verification, independent review, handoff.

## Evidence links
- docs/work/OWNER_E2E_INVESTIGATION_20261011.md — authoritative investigation, per-journey matrix, findings triage, minimum repair plan.
- docs/work/NEON_MIGRATION_PRE_E2E_REPAIR_CHECKPOINT_20261012.md — preserved pre-repair infrastructure ledger.
- docs/HANDOFF.md, docs/KNOWN_ISSUES.md, docs/architecture/CONSOLIDATED_PAYER.md, deploy/consolidated-payer-release.json — deployed state and boundaries.
