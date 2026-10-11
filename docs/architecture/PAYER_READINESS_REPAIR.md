# Payment readiness and cap repair — 11 October 2026

**WAKE_INTEGRATION_IN_PROGRESS — genuine Cloudflare-origin cold PASS; repeated integrated acceptance pending. Payments/customer writes remain disabled.**

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

Actual idle test (978.981s without app requests) restarted the gateway, then received HTTP429 on payer GET/status after215ms; fixed diagnostic returned503 payer_not_ready before any payment attempt. Warm after payer startup returned canonical400. This is new deployed evidence, not a recovered historical status. Narrow follow-up retries429 only on preparation GET, respects Retry-After, and uses a90s bounded default. Payment POST remains single-attempt. Fresh independent diff review found no blocker. Replacement release changes gateway only; the already validated payer artifact stays3945f9c, with explicit per-service SHAs checked at activation. Cold retest remains required.

Replacement gateway966b5a486ff821bca0a7a280d59f15a8c77cdb74 deployed live at22:06:30UTC; payer3945 remains disabled under capsule_3945f9c52cf7. Gateway canonicalGitfingerprint d836493de1f102222f5e3a9381e8dcd91bcd1bd7e8c8800e22b6b301f066f7ed. Full44-table/776-row snapshot/restore SHA bc8efcc23d4ad4ee956615c107d2652eb138ba2809e83b5f664abaace57234d0.85affectedtests/typecheck/build PASS. OAuth/MCP16 PASS; every non-OAuth table unchanged. Payer cold retest pending after22:16:02UTC; no authority restored yet.

Second cold test976.568s idle failed safely after79.937s: all 12 read-only GETs returned429/non-JSON; payer had no startup logs. No payment claim/signing/provider execution occurred. Retry-only correction is insufficient. One narrowly identified Capsule/0.1 preparation request compatibility experiment is pending; it neither impersonates a browser nor changes custody/authority. If unresolved, report the precise runtime blocker without enabling payment.

## Final bounded runtime finding and owner support packet

Gateway fe8abb7a82eb6e610445b40459137b5735647f39 (canonicalGitfingerprint 5b3a6e5b14106b2f3094b68cfd881371eb9dcf46004a9d50541a8f60243068cc), payer 3945f9c52cf76e1960569d53416361bcd42de175, instance capsule_3945f9c52cf7. Gateway restored to ordinary Dockerfile command, deployment dep-db5bnajrjlhs73d40vng LIVE; temporary health probe removed. Owner scopes offers:read/purchases:read only; all three wallets and grants and payer signing disabled. OldSolana remains suspended. Final 16 OAuth/MCP checks PASS. Every non-OAuth table still matches the fresh44-table, 785-row source snapshot; full restore SHA332a542ac4b988e9207b5d21419252a3bf3fd29a238a7e5b66dc4573feaea78a. No agent chain broadcast, payment, new quote, purchase or provider write.

| Actual check | Result | Payment effect |
|---|---|---|
|3945,978.981s idle; gateway actual cold restart | Payer GET429, diagnostic503 | None; no payment claim |
|966b5a4,976.568s payer idle; bounded429 retries |12 non-JSON HTTP 429 responses,79.937s; no payer startup | None |
|fe8abb7,identified Capsule/0.1 request |12 non-JSON HTTP 429 responses,80.737s; no payer startup | None |
|One temporary unauthenticated GET/health from actual gateway runtime | HTTP429; x-render-routing: hibernate-rate-limited | None; no wallet engine |

This verifies a Render hibernation/ingress admission failure, rather than a payer application policy rejection. It does not establish the limiter scope, window, reset time, account rule or the exact historical three incident responses. Published [Render Free documentation](https://render.com/docs/free) describes automatic HTTP spin-up, but does not document this observed routing reason. Current source/target plans remainFree; no-card/no-paid constraints unchanged. Repeated retries or manual warming are not accepted fixes.

**Owner support request (reviewable; not sent):**

> Existing Free services in Singapore: gateway srv-db2jgqnavr4c73e9blrg (token2049-origins.onrender.com), payer srv-db2mnk1srm7s73c1f5c0 (t2o-cardano-payer.onrender.com), workspace tea-db1tjj1srm7s73d6vra0. Between 22:16 and 22:26 UTC on 10 October 2026, gateway-origin read-only GET/status and one unauthenticated GET/health received HTTP429/non-JSON without starting the payer. The health response explicitly carried x-render-routing: hibernate-rate-limited. Warm gateway-to-payer authenticated transport succeeds. Please identify the hibernation admission rule, its scope/reset period and a supported zero-cost correction for these existing services. We require on-demand Free operation, no keep-alive, paid plan/card enrollment or manual warming. Tokens/keys/transaction data are omitted.

Available service-management APIs do not expose a documented hibernation-admission/reset setting; do not guess an override. Owner sends this packet via their Render support channel or explicitly authorizes a support message. No message was sent. If Render cannot support this Free service-to-service path, any infrastructure exception requires a material owner decision before implementation.

**Exact resume:** remain in this chat; read ledger/protected repair-release-state.json (phase blocked-render-hibernation), verify deployed SHAs/fences/history. Once the platform issue is resolved, run one fixed non-spending cold transport check. Only after PASS, create new exact-artifact disabled/cold proofs, use the reviewed activation/authority gates, verify preserved history and hosted reads, then stop for the owner’s nine E2E tests. Never retry the3expired incident IDs or enable authority from a warm-only result. All nine live rows remain NOT RUN.

## Authorized narrow Cloudflare wake experiment — 11 October 2026

Owner attachment8577f52b explicitly overrides only the earlier wake prohibition. Existing Render gateway/payer, MCP/OAuth, Neon database, browser and all payment contracts stay in place. No production gateway integration or activation is allowed until a genuine cold-origin PASS.

Existing Wrangler OAuth access verified with pinned4.149.0. The authenticated account Workers plans dashboard explicitly shows Free / $0 / Current plan. The API default_usage_model=standard is not billing proof; subscriptions API403. Existing t2o-payer-waker has no schedules and is untouched. New isolated script capsule-payer-wake-experiment exposes only authenticated POST /wake, with a fresh dedicated CAPSULE_WAKE_SECRET (not any payment token). Destination is compiled fixed GET https://t2o-cardano-payer.onrender.com/health; no redirects, caller data forwarding, payment routes, cron, storage or background work. Built-in rate-limit binding2/60s per location plus isolate-local coalescing bounds duplicate traffic; neither is a global exactly-once guarantee. Replayed authentication can only cause read-only health requests within those best-effort bounds.

Local boundary19tests/typecheckPASS. Independent Act Now workerd empty-POST finding fixed: authenticate first, accept a bounded empty stream, reject nonempty/stalled bodies. Real local workerd HTTP Content-Length:0 proves stream acceptance; missingauth401/body400; mocked outbound only, zeroRenderrequests. Review blocker resolved. Wrangler bundle fingerprint recorded at deployment. Budget20Worker requests and at most2payer health requests, zero signing/provider writes. At05:27UTC, exact Render revisions/fences and44-table non-OAuth hashes reverified unchanged. Payer app logs04:31–05:31UTC contain no requests/startup; management API reads do not wake it. At this local checkpoint, real Cloudflare-origin cold experiment was NOT RUN; actual result follows. Fresh narrow independent review passed after the targeted body fix; approximate rate limiting accepted for non-financial health traffic. If Cloudflare returns the same429 or does not start the payer, stop, preserve the disabled gateway and record failure.


Phase1 actual proof: 11October05:43:50.508UTC,982.281s without payer application activity, Worker200/upstream200JSON in32,441ms (caller32,676ms), routing:none. Independent Render app logs show new payer startup. Dedicated secret deployment versionf416f62f-6fb2-4026-851a-caafca88c33b; canonical deployed worker module fingerprint e40e3110bdf403c1e0acb60b5493894aa27a3c28d10167e33a17b53775ac1450. Authenticated gateway readiness at05:47:14UTC returned200 and canonical invalid-ID400; all44-table non-OAuth hashes unchanged. Existing16OAuth/MCP read-only checks PASS.

Opt-in gateway integration accepts only MCP_PAYER_WAKE_URL=https://capsule-payer-wake-experiment.dropandreset-main.workers.dev/wake and MCP_PAYER_WAKE_TOKEN_FILE containing a distinct64hex secret. It requires the fixed existing consolidated payer. Only429 with x-render-routing:hibernate-rate-limited triggers one wake within the90s readiness budget; direct authenticated status must then pass before claim. No payment payloads/credentials go to Cloudflare. Payment POST remains single-attempt.135affected unit tests and68native PostgreSQL/MCP tests PASS, including all9labeled fixture combinations and failed-wake unclaimed/same-approval recovery/lost-payment-response protection.

Current authenticated Render billing dashboard13:55SG shows Hobby, no card,77.23/750Free hours used,66/500pipeline minutes used,115MB/5GBbandwidth used,6/25services, current/projectedUSD0. Shared rounded counters; remaining672.77hours/434minutes/~4.885GB. Conservative experiment budget amended to20Worker requests and3health wakes to cover one diagnostic plus two integrated genuine cold checks. No new application service.

Narrow independent review extension: no Act Now code blocker. Fixed dedicated authority/destination, one bounded wake, direct readiness and payment ordering accepted; client/isolate-local coalescing remains an accepted availability limitation. Investigate Now: deployed gateway cold-path acceptance before activation. Root typecheck and gateway/console build PASS.
