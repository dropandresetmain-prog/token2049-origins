# Payment readiness and cap repair — 11 October 2026

**COLD_WORKER_DIAGNOSTIC_PASS — INTEGRATED REPEATABILITY PENDING. Signing, grants and customer purchase writes remain disabled.**

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

Fresh backup initially stopped before deployment: Neon inventory now has cloud_admin default ACLs in public for relations/sequences granting neon_superuser, absent from the earlier snapshot. All non-OAuth table hashes and every other catalog match. Bounded disposable restore correction preserves those exact ACL records using NOLOGIN/non-superuser/non-replication/non-bypass placeholders. No source role, ACL, schema or data change; app-role properties and complete ACL comparison remain required.

First integrated gateway cold PASS at06:03:50.314UTC:993.28s idle; initial direct status429 at58ms; Worker health200 in32,761ms; direct authenticated ready at33,870ms; fixed invalid-IDPOST canonical400; outer200 in34,250ms. Independent Render payer startup and all non-OAuth hashes unchanged. Render log ingestion lagged the HTTP reply; a management-only follow-up recovered ready/400 events, without repeating the diagnostic or touching the payer. Protected original and supplemental proofs retained. Second integrated window starts06:04:24.564UTC.

Current Neon read-only management proof06:09:55UTC: owner subscription free_v3, project compute_time_seconds2713/data_transfer_bytes39,889,248,6hrestore, canonical unpooled endpoint fixed0.25CU. Free consumption-history exact remaining allowance is unavailable; zero legacy storage/written counters do not establish zero usage. No database configuration changed. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) updated8October2026:100,000requests/day,10msCPU; actual Free runtime cold responses pass. [Rate-limit binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) is eventually consistent per location, accepted only for health traffic.


## Final wake experiment result — 11 October14:23 Singapore

The Worker can wake this payer, but reliability acceptance failed. Preserve the deployed opt-in code and disabled authority; do not turn two successes into a claim of E2E readiness. The owner explicitly requires stopping when the Worker cannot start the cold payer. No further runtime experiment or activation follows this checkpoint.

| Controlled genuine cold check | Idle | Observed result | Independent payer startup | Financial effect |
|---|---|---|---|---|
| Standalone Worker05:43:50.508UTC |982.281s| Worker200/upstream200,32.441s | VERIFIED | None |
| Integrated gateway06:03:50.314UTC |993.280s| direct429, Worker200/32.761s, direct authenticated ready, invalid-ID400; outer200/34.250s | VERIFIED | None |
| Integrated gateway06:20:40.893UTC |974.361s| direct429/59ms, Worker-client timeout75.002s; outer503 payer_not_ready/75.351s | NOT OBSERVED through06:23:52UTC | None |

The third request reached Cloudflare: dashboard4invocations/3subrequests, one cancelled invocation. Zero exceeded CPU/memory/internal/uncaught-exception errors; P99CPU4.05ms and memory1.58MB remain within Free limits. Only the two successful health-result logs are retained. The final failed Worker upstream HTTP response is UNKNOWN, not a proved Cloudflare-origin429. Gateway and Worker both use75s deadlines, allowing gateway cancellation before the Worker emits its own timeout; this is a diagnosis/observability limitation, not evidence that a longer deadline fixes startup. Render app logs contain no new payer startup through final management verification.

At06:23:52UTC the exact gatewayb122186ceaadc36cb75abb4fb986cde7423a3046 and payer3945f9c52cf76e1960569d53416361bcd42de175 remain LIVE/Free; deployment IDsdep-db5ibrd9fdbs73d067p0/dep-db5b0o5ckfvc739j3l60. Signingfalse, three disabled registrations/instance grants, customer quotes/purchase writesfalse, old Solana suspended and both legacy payer clients revoked. All non-OAuth44-table hashes match the fresh44/805 protected baseline. Source listing authenticated200/unavailable, unauthenticated401; console and historical receipt/proof200. Private release phasewake-blocked-disabled prevents accidentally using the old activation gate. Backupcaf31fb7f1acbc05a4bff030a9020d81fa9a02eb142fdfdb40ae8627ea3020d8 fully restored all rows/catalogs/ACLs. No quote, purchase, payment claim, signing, broadcast, funding or provider operation was created by this experiment.

| Classification | Finding and action | Deferral risk / blocker |
|---|---|---|
| Act Now | Keep authority fenced and owner tests paused; preserve exact runtime/history evidence. Done. | Enabling after intermittent success would expose users to unresolved cold ingress. Blocks release. |
| Investigate Now | Establish failed upstream outcome/startup rule and distinguish deadline cancellation from Render admission. Owner may send the existing support request, adding this timestamp/service ID and successful-vs-failed wake evidence. No message sent. | Final upstream response and limiter reset remain unknown. Blocks release. |
| Investigate Now | If additional runtime work is authorized, use one bounded diagnostic with nested deadlines that permit observing the Worker's final result; payment authority stays off. Require two complete integrated cold successes before activation. | A larger timeout alone is not a demonstrated fix. No automatic retest/redeploy authorized after this stop. |
| Investigate Now | Owner's nine fresh live rows and real checkout/disconnect behavior. | All NOT RUN; fixtures do not prove merchant completion. |
| Ignore / Accept Risk | Preserve approximate health coalescing/rate limiting and expired unsafe incident liabilities. | Not a financial lock; never repeat payment or switch source after ambiguity. |
| Park for Later | Infrastructure replacement, paid plans, consumer onboarding and general orchestration. | Outside the narrowly authorized transport experiment. |

The minimum next action is to resolve this specific availability behavior, then verify the existing candidate; no database/chain/provider rewrite is justified. Published [Render Free documentation](https://render.com/docs/free), re-read11October, says HTTP traffic spins up an idle service in about one minute, but does not describe the observed hibernate-rate-limited reason. Its management-API limits are a separate contract and do not explain application ingress. Do not invent a supported bypass. A support message needs owner sending/explicit messaging authorization; a further deployed experiment after the instructed stop needs explicit scope/budget. Keep this chat for that narrow continuation. Do not restore stale history or reactivate old signers.


## One final independent cold-ingress diagnostic — 11 October16:04 Singapore

Owner explicitly authorized one additional non-spending diagnostic with nested deadlines. Before edits, Render gatewayb122186ceaadc36cb75abb4fb986cde7423a3046/payer3945f9c52cf76e1960569d53416361bcd42de175, old Workerf416f62f and its exact deployed module fingerprint matched. All40non-OAuth tables matched the protected canonical44-table baseline; signing/three grants/customer purchase writes remained disabled. Wrangler's existing OAuth access was refreshed without new consent or permissions. No infrastructure, database, payment module/policy or merchant changes occurred.

Later evidence: payer startup2026-10-11T06:32:15.190131467Z appeared after the previous report's06:23:52UTC cutoff. Its trigger is UNKNOWN. This does not alter the earlier observed75s cancellation; it makes any claim that the payer never eventually started invalid. No later payer app activity appeared after06:32:16UTC in complete management log pages. Agent made no intervening payer request.

Only the Worker's upstream deadline changed75s→90s. The independent diagnostic caller waits110s; production gateway bridge.ts was inspected and left unchanged at its verified deployed SHA. Existing fixed destination, dedicated authentication, rate limiter, redirect refusal and sanitized terminal logs remain. The default-deny single-use operator script scripts/multiwallet/cold-ingress-diagnostic.mjs verifies pinned versions/content/history/authority, records an exclusive durable attempt marker before its only request, and persists terminal result before log/database follow-up. Unexpected bodies and sensitive headers are never retained. No automatic retry is possible under this authorization.

| Actual evidence | Verified value |
|---|---|
| Source commit | eeef8952a218b811f193c580d0a2b12bcdb155cd |
| Worker version / deployment |00ee6d4a-afdd-4807-ad05-f46d33fa1986 /22ac89a7-f73b-4387-bcab-472e4394687a |
| Canonical deployed module SHA256 |dc652cc9fc9f22de757e0d35387e15726f985ba3929f162180313dab515cbf15; exactly matches verified dry-run bundle |
| Request / response timestamps |08:04:03.216UTC /08:04:36.351UTC |
| Pre-request inactivity |5506.843seconds (>91minutes); no app activity since06:32:16UTC |
| Worker / upstream result |HTTP200 /HTTP200, JSON, category upstream_2xx, recognized Render routing none |
| Elapsed |32,408ms Worker upstream;33,135ms independent caller |
| Independent Render startup |08:04:27.933858715UTC, Consolidated payer listening |
| After-result verification |08:04:42.017UTC: same gateway/payer SHAs,40non-OAuth table hashes unchanged, authority still disabled, old signers fenced |
| Budget / writes |Exactly1Worker request/1fixed health GET; no warm readback, payment claim, signing, chain broadcast or provider operation |
| Narrow checks |21Worker tests PASS; root typecheck PASS; runner syntax/default-deny PASS; Wrangler4.149.0 dry bundle and actual upload PASS,5.00KiB/startup2ms |

Verdict: **COLD_WORKER_DIAGNOSTIC_PASS — INTEGRATED REPEATABILITY PENDING**. This proves a genuine cold Cloudflare-to-Render success and a terminal response received by the independent caller. Its33s duration was already below the former75s deadline; it does not prove that extending the deadline fixes the earlier intermittent failure or identify a Render limiter rule. No additional retry or runtime experiment follows this single-request scope.

Minimum next gate: separately budget two genuine≥960s integrated idle-to-active cycles on exact pinned artifacts, with all authority still off. First review the deployed gateway's75s wake caller and90s overall preparation against the now90s Worker: the caller/whole-preparation deadlines must leave room for the Worker terminal response and subsequent direct authenticated status. Any change stays in bounded preparation, never payment POST retries. Verify direct authenticated status, independent startup, unchanged histories, preserved ownership/fences and safe failed-preclaim behavior. Only after both cycles and existing backup/history/signing gates pass may prior conditional activation be reconsidered. All9owner live rows remain NOT RUN.

Triage: **Act Now** retain disabled authority and the exact single-attempt evidence (done); **Investigate Now** integrated budget/repeatability and original ambiguous ingress cause (blocks activation); **Ignore / Accept Risk** preserve prior unsafe incident liabilities and conservative gas/sponsor exposure; **Park for Later** infrastructure replacement/general orchestration. Same chat for this narrow next gate. Do not retry incident purchases or restore stale canonical history.


## Final integrated acceptance scope — 11 October2026

Owner authorized two new cold cycles after gateway-only timeout repair. Worker remains version00ee6d4a-afdd-4807-ad05-f46d33fa1986, payer3945f9c unchanged. Fixed budgets:90s upstream,110s wake caller,130s overall readiness; independent operator caller160s covers readiness plus10s safe invalid-ID transport. Hosted MCP retains45s response and identical-argument background joining. Only authenticated GET readiness retries; payment POSTs never retry. Known Worker HTTP status, upstream status, recognized routing and terminal timeout/transport category survive as fixed fields in logs and preclaim failures. Untrusted Worker responses are limited to4096bytes and never echoed.

Limits inspected11October: [Render web-service response limit](https://render.com/docs/render-vs-vercel-comparison) is100minutes; [Node24 HTTP](https://nodejs.org/docs/latest-v24.x/api/http.html) requestTimeout300s governs incoming request receipt, server socket timeout defaults0, and main.ts introduces no shorter request-execution timer. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) permits HTTP wall time while the caller remains connected; Free CPU remains10ms. These support bounded nesting; they do not establish cold reliability or one universal host timeout. Existing45s MCP pending behavior is preserved.

Local checks:65focused unit PASS;68native integration PASS plus new pending/one-claim fixture PASS after replacing its premature timing assumption. Root typecheck and gateway/console build PASS. Synthetic payment/provider fixtures only. Fresh read-only canonical44table/825row backup full restore PASS including default ACLs; SHA c635b74c45cf36d28203725edc9f19c83f9b1885c151a932584bf3464c065ae1. No authoritative mutation.

Current authenticated Render billing16:54SG: Hobby/no card;81.37/750hours,69/500build minutes,119MB/5GB,6/25services; accrued/projectedUSD0. Budget:2fixed health wakes, one gateway deployment, and only covered activation redeployment if both cycles pass. No extra application resource or keep-alive. Prior direct diagnostic and prior integrated successes do not count toward these two cycles.

scripts/multiwallet/integrated-cold-acceptance.mjs is default-deny and consumes a protected exclusive marker per cycle before network I/O. It enforces exact gateway/payer/free/disabled authority,>=960s idle, unchanged non-OAuth tables, independent startup and safe400 transport. Terminal response persists before management/database follow-up. Second cycle requires first PASS and a new independent idle window. Never repeat a consumed or failed cycle.


Gateway-only correction deployed as86f519450b1d61d5c42f8bbadb685b49f01ea798, canonicalGitSHA25650029d5666088b1fc848b650a125cd637bbcd1c6b15812cdd0ebb4110a876fe3, Renderdep-db5kvf142hec739b8940 LIVE. Payer/Worker unchanged.16hosted read-only OAuth/MCP checks PASS. Worker management access expired during preflight; Wrangler refreshed the existing session. No payer request or cycle marker existed at that preflight stop; it did not consume a cold cycle.

Integrated cycle1:09:01:41.427–09:02:17.481UTC,3418.142s idle; initial429/hibernate-rate-limited122ms; WorkerHTTP200/upstream200/routingnone33,271ms (gatewaycall33,554ms); direct authenticated readiness35,365ms; canonical invalid-ID400425ms; outer20036,054ms. Independent startup VERIFIED. All40non-OAuth table hashes and disabled grants/customer scopes unchanged. Protected wake-final-integrated-cycle-1.json retains exact events. Cycle2 deliberately waits for a fresh idle window beginning09:02:30UTC. No activation or financial write yet.


## Final integrated acceptance and covered activation

READY_FOR_OWNER_MCP_TEST — LIVE E2E NOT YET VERIFIED

Gateway 86f519450b1d61d5c42f8bbadb685b49f01ea798 / Git fingerprint 50029d5666088b1fc848b650a125cd637bbcd1c6b15812cdd0ebb4110a876fe3 / dep-db5kvf142hec739b8940; payer 3945f9c52cf76e1960569d53416361bcd42de175 / retained fingerprint addbe059ddebc7794a8d6f510f964f0d1dee300e3a58dcdb44248fd088ecdd46 / activation deploy dep-db5la02jnfac73ast890. Worker00ee6d4a-afdd-4807-ad05-f46d33fa1986/moduleSHA dc652cc9fc9f22de757e0d35387e15726f985ba3929f162180313dab515cbf15 unchanged.

| Cycle | Started UTC | Idle seconds | Elapsed ms | Verified result |
|---|---|---:|---:|---|
| 1 | 2026-10-11T09:01:41.427Z | 3418.142 | 36054 | initial429; Worker upstream200; authenticated ready; canonical invalid-ID400; independent startup; unchanged histories |
| 2 | 2026-10-11T09:19:00.446Z | 983.989 | 34449 | initial429; Worker upstream200; authenticated ready; canonical invalid-ID400; independent startup; unchanged histories |

Two independently cold integrated cycles PASS before covered activation. Fixed nesting90s Worker/110s gateway caller/130s preparation, unchanged45s MCP pending/repeat joining. Known sanitized upstream classification survives failure; payment POSTs never automatically retry. Controlled repeatability does not guarantee future ingress or explain the prior intermittent failure.

Existing conditional authorization covers exact narrow replacements and activation after gates. Fresh full PG18 restore, canonical histories, original ownership/identities/policies, retained three-rail initializer and old local/cloud fences PASS. Same payer signing enabled only after both cycles; non-spending transport/ownership/proof checks PASS while grants stayed off; exact three source/instance grants and saved customer commerce scope restored last. No key relocation, policy change, history reset, purchase, broadcast or provider write in this continuation.

Final16OAuth/MCP read-only checks PASS; owned source list configured3, unauthenticated401, console/historical receipt/proof200. Histories unchanged except explicitly approved authority/customer configuration and OAuth records. All9live rows NOT RUN. Do not retry the three expired incident purchases.

MCP https://token2049-origins.onrender.com/mcp; existing OAuth issuer https://token2049-origins.onrender.com/ supports dynamic registration. Console https://token2049-origins.onrender.com/console/. Owner refresh/reconnect if cached scope is read-only; use protected clipboard retrieval in docs/demo/MULTIWALLET_MANUAL_ACCEPTANCE.md. [Current OpenAI guide](https://developers.openai.com/plugins/deploy/connect-chatgpt), checked11October. No manual payer preparation.

Final authenticated Render17:25SG: Hobby/no card,82.75/750hours used (667.25remaining),69/500build minutes (431remaining),119MB/5GB,6/25services, accrued/projectedUSD0. Rounded shared counters can lag. Workers Free remains Active; exact account-wide Worker/Neon remaining compute allowance is not measured. No paid change.

Rollback: fence customer writes/signing/grants and inspect current canonical histories first. Never restore stale history or reactivate old signers after spending/uncertainty. Preserve old receipts/proofs and snapshots. STOP for owner tests; same chat for narrow owner-reported failures only.

Cold startup timestamps: cycle1 2026-10-11T09:02:08.995625573Z; cycle2 2026-10-11T09:19:23.592959176Z. Worker terminal classifications were upstream_2xx/HTTP200/routingnone in both; caller received them before authenticated readiness and safe400.
