# Payment readiness and cap repair — 11 October 2026

Owner scope: repair through hosted non-spending readiness; the owner runs fresh live purchases. Existing MCP/OAuth, Render Free services, PostgreSQL histories and merchant integrations remain canonical.

The three failed owner purchases are expired with unsafe failed handoffs. Their financial table hashes match the preceding snapshot; independent chain reads found no incident settlement, and merchant execution never started. The exact historical bridge HTTP status was not retained. An inactive payer/ingress failure is the leading explanation, with moderate confidence; it is not a proved HTTP 502/503 diagnosis. Existing report: C:/Dev/token2049-origins/output/cross-rail-investigation-20261011/REPORT.md.

The 1:1000 policy was active on all three quotes. Sui's 100,000-unit cap would independently reject the 112,050-unit request. The owner explicitly requested Solana and Sui match Cardano: per-payment/daily/cumulative 5,100,000 token units (5.1 test tokens / USD5,100 commercial at1:1000); commercial ceiling510,000 USD minor units. Sponsor fees and gas caps stay unchanged. Prior liabilities remain charged. Daily accounting retains unresolved exposure; Cardano/Solana use UTC days, Sui retains its conservative rolling24-hour rule.

## Implemented behavior

- Registered sources still require no wallet RPC. Only buying checks authenticated payer transport, before the durable payment claim. Bounded read-only GET retries handle transient readiness; no POST retry is introduced.
- An unclaimed purchase may resume only the same approval while valid. Existing running/unsafe handoffs remain blocked; claim rechecks quote expiry. Host pending replies stay bounded.
- Bridge errors expose HTTP status and a fixed response category; sanitized gateway/payer logs retain receipt/result evidence without response bodies, credentials or signed payloads.
- Additive0013 appends immutable policy amendments while wallets/grants are disabled. Baseline identities/policies, all signed candidates, reservations, blocked history and fee/gas exposure are retained. Configuration alone cannot raise a pinned cap.
- Authenticated GET /mcp/payer-readiness accepts no parameters. It probes status and sends one fixed invalid purchase ID to /pay. The ID fails before database/engine/signing access; canonical400 proves gateway-to-payer GET/POST transport only.

## Release and rollback

Run scripts/multiwallet/repair-release.mjs without arguments to inspect its default-deny plan. The approved existing resources and secret NAMES remain in deploy/consolidated-payer-release.json. No keys move in this repair.

1. Verify exact candidate/remote, Free plans, no-card quota evidence, focused tests/review and a recent protected backup with disposablePG18 full restore.
2. Quiesce the two existing services; old Solana/local signers stay retired. Inspect pending jobs/purchases/funding/merchant/handoffs; do not reset unknown outcomes.
3. Take a final consistent protected backup/restore. Fence registered sources and instance grants; temporarily restrict the demo core client's writes.
4. Apply only0013 and append the authorized Solana/Sui policies. Preserve all baseline/financial hashes; update only token/commercial cap env values and candidate instance ID.
5. Deploy the pinned SHA with signing disabled. One explicit operator check initializes each original rail read-only; remove the operator list and return to normal disabled command.
6. Verify OAuth/MCP/source ownership, historical receipt/proof/console, exact history, fixed transport diagnostic and cold ingress. Activate the exact candidate process before granting its three sources; restore commerce scope last.
7. Stop for owner E2E. Agent creates no quotes/purchases/provider writes/payments.

Rollback means fencing authority and reconciling the current canonical history. Never restore a stale snapshot or revive old signers. After0013, older binaries lacking that migration are not a compatible application rollback; use a reviewed forward repair that retains the migration and, if separately approved, appends a compensating policy. Failed incident purchases remain read-only.

## Verification checkpoint

Root typecheck, gateway/console build and payer compilation PASS. Integrated non-spending gate:10files/175tests PASS, including nine labeled provider/rail fixtures, OAuth, repeated buys/polling, no-handoff resume, immutable amendments and daily reservation accounting. Fresh independent source review found no payment/auth/custody blocker. Two Act Now release-runner findings (original-scope preservation and snapshot-start freshness) were fixed, with6isolated interruption/freshness assertions PASS. Deployed ingress proof is Investigate Now and blocks release until passed. Fresh protected43-table/759-row backup restored with full table/catalog/grant comparisons PASS; checksum f510dc61c4f6dc11a11ca90994868bf066f15232ecc3c450c4a54b506c0d1a3b.

Both services deployed3945f9c52cf76e1960569d53416361bcd42de175. Canonical committed-source fingerprint addbe059ddebc7794a8d6f510f964f0d1dee300e3a58dcdb44248fd088ecdd46 (sorted tracked paths NUL Git blob bytes NUL); Windows worktree-byte fingerprint da6bc256b2a082f4ff8a81724a84043af0cb04c4cc09927ae2fbb9b70116f2e3 is retained separately and is not the canonical checkout fingerprint.

Final quiesced43/759 full backup/restore SHA c36c8b2db86e79dcdb30653404c3bc1dd53baca57a98f0770c3e4a5c1e441ffc. All original financial tables and incident purchases/handoffs unchanged. Two append-only cap revisions applied. Actual Render read-only initializer3rails PASS, Node24.21.0, peak146300KiB. Normal command restored and operator list removed. OAuth/MCP16checks PASS; existing sources/console/historical receipt/proof PASS. Fixed gateway-to-payer diagnostic PASS (authenticated JSON status, canonical400 invalid_request, no payment authority/engine access).

Services/grants remain disabled pending actual cold ingress and activation. Final operator authority restoration is inspectable/default-deny in scripts/multiwallet/activate-repair-authority.mjs; its independent late-file extension found no blocker. Owner live purchases: all nine NOT RUN on repaired candidate.

Neon API21:44UTC reports free_v3,1542compute seconds (~0.4283CUh),21,717,126transfer bytes for October. Protected pre-repair database size12,836,864bytes. Storage/written counters report zero and are not evidence of zero usage. The [2October official Free-plan change](https://neon.com/blog/neon-free-plan-1-gb-per-project) confirms1GB,100CUh/project/month and6hrestore retention.

Free quota proof is a snapshot, not exact current accounting. Current API plans are free. Browser quota refresh failed before any change; owner no-card confirmation plus bounded30build-minute/2instance-hour budget preserves the recorded allowance. No billing/plan changes occur. Render documents suspension/build refusal rather than supplementary billing without a payment method: https://render.com/docs/free and https://render.com/docs/build-pipeline.
