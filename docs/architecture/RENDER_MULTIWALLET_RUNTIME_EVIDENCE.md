# Render multiwallet runtime evidence

Research retrieved **2026-10-10 (Asia/Singapore)** from official Render, OpenAI, and Model Context Protocol documentation. The opened Render and OpenAI documentation pages did not expose a publication or last-updated date. The Render changelog entry for WebSocket idleness is dated **2026-02-24**. Render's compute-plan documentation says plan IDs changed in **August 2026**.

## Current read-only account evidence (10 October 2026)

Read-only authenticated Render CLI/API inspection verified:

- Database `token2049-origins-db`, ID `dpg-db29mujncjis73dtvf70-a`: Free PostgreSQL 18, Singapore, available; created `2026-10-06T06:55:54.699333Z`, expires `2026-11-05T06:55:54.699333Z` (**5 November 14:55:54 Singapore**). No HA, replica, managed pool or disk autoscaling. External-access allowlist is loopback-only; no network permission changed.
- Gateway `srv-db2jgqnavr4c73e9blrg`, `https://token2049-origins.onrender.com`: Free; live deployment `dep-db36quvlk1mc739kfp20` at known-good main `7c09b37eaaeda2bf3eec94fc1e3456118962f636`.
- Cardano payer `srv-db2mnk1srm7s73c1f5c0`, `https://t2o-cardano-payer.onrender.com`: Free. Reuse this service for the consolidated candidate only after approval.
- Solana payer `srv-db35psid0e5s73f7ltng`, `https://t2o-solana-payer.onrender.com`: Free. Preserve current authority until approved fencing.
- Workspace `tea-db1tjj1srm7s73d6vra0` shares its Free quota with other projects. No unrelated resource allocation was consumed or changed.

A protected read-only Cardano status request returned five accepted entries, no signing/signed entries, 94,820 committed units and 5,005,180 headroom. Its permanent import marker retains four entries / 66,830 units and source hash `0909a33e5de6296ebccb5df2a5f700c67e16a800cc3d195d8465fb25d46b9381`. This is history/cap evidence, not current chain-balance or candidate acceptance.

Protected historical Sui snapshot hash `3db74885426ee2e7e42226d3a4ebb64b0ab8834babc09ea35049fdcfee7817f0` retains two signed entries: 35,900 token units and 20,000,000 MIST gas budget. Both exact signatures/transaction facts verified offline against read-only canonical historical purchases. One rejected timestamp candidate and one historically successful checkout remain signed in the source ledger; neither was dropped or reclassified. No existing key was read or moved and no history was imported into Render.

**UNVERIFIED:** remaining workspace instance-hours/build minutes/bandwidth, payment-method/spend-limit configuration, latest owner-managed database export/restore, final quiesced Solana history snapshot and actual consolidated Render initialization/memory/cold-start behavior. CLI metadata is not a quota balance. No candidate deploy occurred.

## Owner dashboard evidence — 11 October 2026

The owner supplied a Billing / Monthly Included Usage screenshot for the same workspace `tea-db1tjj1srm7s73d6vra0`. Record only sanitized quota numbers; the image contains unrelated browser details and is not committed.

| Shared workspace allowance | Used / included | Remaining |
|---|---|---|
| Free instance hours | 81.85 / 750 hours | 668.15 hours |
| Outbound bandwidth | 105 MB / 5 GB | Approximately 4.895 GB |
| Pipeline minutes | 53 / 500 minutes | 447 minutes |
| Included services | 6 / 25 | 19 slots; no new service is planned |

Capacity is sufficient for the bounded existing-service deployment/verification scope, subject to other workspace usage. It does not prove an always-active monthly service budget. **Investigate Now / release gate:** pipeline spend limit and whether a payment method is attached are not visible; inspect the screenshot's “Manage spend on pipeline minutes” link and report payment-method presence without card details. No billing change is authorized. Earlier account observations below are historical; see the Neon migration record for current database/deployment state.

## Official Free-plan limits

| Area | Official documented limit / behavior | Evidence boundary |
|---|---|---|
| Free web service compute | `free` web plan: 0.1 CPU, 512 MB RAM. | Plan specification only; does not prove current service plan or runtime RSS. [Render compute plans](https://render.com/docs/compute-plans#web-service-plans) |
| Idle behavior | Spin down after 15 minutes without inbound HTTP requests or messages on an existing WebSocket; next HTTP request/new WebSocket connection triggers wake, which takes about one minute. Render may restart Free web services at any time. | Documented platform behavior; no true idle cold-start rehearsal is recorded for this candidate. [Render Free plan](https://render.com/docs/free#free-web-services), [WebSocket change, 2026-02-24](https://render.com/changelog/free-web-services-now-remain-active-while-receiving-websocket-messages) |
| Monthly runtime pool | 750 Free instance-hours per workspace per calendar month; spun-down services do not consume hours; the pool resets monthly and services suspend if exhausted. | Workspace-shared allowance; current remaining hours and total competing Free services are unknown. [Render Free plan](https://render.com/docs/free#monthly-usage-limits) |
| Bandwidth/build | Free web services use the workspace's included outbound-bandwidth and build-pipeline allowances. Depending on payment method and spend limit, excess usage may incur charges or disable services/builds. | Exact workspace allowance, remaining usage, billing setup, and build minutes are not proven here. [Render Free plan](https://render.com/docs/free#monthly-usage-limits) |
| Local filesystem / networking | Free web services use an ephemeral filesystem, have one instance, no persistent disks, and cannot receive private-network traffic; they may send private-network requests to same-region Render data stores and paid services. | Design implications only. Keep payer history in the existing database, never rely on local files for durable state. [Render Free plan](https://render.com/docs/free#other-limitations) |
| Free Postgres | 1 GB storage; expires 30 days after creation, followed by a 14-day grace period before deletion; Render may restart or maintain it; no managed connection pooling. Compute-plan page lists Free Postgres at 0.1 CPU, 256 MB, maximum 100 connections. | Current read-only metadata establishes the exact instance expiry above; account quota balances remain unknown. [Render Free plan](https://render.com/docs/free#free-postgres), [Postgres compute plans](https://render.com/docs/compute-plans#render-postgres-plans) |
| Backups/recovery | Render provides no Free Postgres backup or PITR. Manual `pg_dump` from a client is documented. | **Owner-managed export/backup status is unknown.** No export file/cadence was inspected. [Render recovery and backups](https://render.com/docs/postgresql-backups#logical-backups) |

## Conservative no-spend acceptance budget

These are recommended guardrails for accepting work on the published Free plan; they are not Render guarantees or limits.

- Keep aggregate Free web-service runtime at or below **600 instance-hours/month** across the workspace, reserving 150 hours below the 750-hour ceiling. Count gateway and consolidated payer together and include other Free services in the same workspace. Verify current usage in the owner dashboard before relying on this budget.
- Keep measured peak RSS at or below **350 MB per 512 MB Free web instance**, including the retained Playwright/Chromium workload, leaving about 160 MB for runtime/platform overhead and short spikes. Measure during the actual browser checkout path; a build-time Chromium smoke alone does not establish runtime memory.
- Keep outbound bandwidth and build-pipeline usage within the owner's actual included allowances. Since those allowances and remaining balances are UNVERIFIED here, this document cannot certify a no-spend month from published limits alone. Capture dashboard balances and spend-limit/payment configuration before acceptance.
- Use the official cold-start expectation (about one minute) as a user-facing latency budget for an idle Free service; do not use a wake-preparation request to disguise that delay. No candidate cold-start measurement is claimed.

## MCP, OAuth, progress, and OpenAI host constraints

The current MCP core spec is version **2026-07-28**. For HTTP authorization it uses OAuth 2.1-based authorization, protected-resource metadata, resource-bound tokens and bearer authorization on each request; the resource server must validate that tokens are intended for it. The current spec deprecates Dynamic Client Registration in favor of Client ID Metadata Documents, while retaining DCR for compatibility. Sources: [MCP 2026-07-28 authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [MCP core overview](https://modelcontextprotocol.io/specification/2026-07-28/basic).

OpenAI's ChatGPT/Codex plugin guide expects OAuth 2.1 conforming to MCP, including protected-resource metadata and PKCE, and requires the server to validate issuer, audience, expiry, and scopes. Tool-level OAuth linking requires auth metadata and a runtime `_meta["mcp/www_authenticate"]` challenge. For the Responses API, OpenAI documents a caller-supplied access token in the MCP tool's `authorization` field and explicit per-tool-call approval controls. Sources: [OpenAI MCP plugin authentication](https://developers.openai.com/plugins/build/auth), [OpenAI API MCP tools](https://developers.openai.com/api/docs/guides/tools-connectors-mcp).

MCP progress is optional. A client includes a unique `progressToken`; a server may send `notifications/progress` with increasing values or may send none. The Responses API reference documents `response.mcp_call.in_progress`, `.completed`, and `.failed`, but public docs do not confirm that arbitrary MCP progress notifications are surfaced to the model/client or that the current MCP Tasks extension is supported. Keep long-running browser/provider work resumable and validate visible progress behavior against the actual host before relying on it. This documentation lane did not initiate a provider call or test OAuth/progress behavior. Sources: [MCP progress](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress), [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events), [MCP Tasks extension](https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks).

## Local production-image check

The actual Node24 Linux production payer image passed eight disposable-key signing/serialization checks: Cardano Evolution/x402 signatures and metadata, Solana transfer/memo/signatures, Sui transaction/candidate/replay-bound nonce. Docker used `--network none --memory 512m --cpus 0.1 --read-only` and a16MiB temporary filesystem; no chain broadcast/provider write or existing-key access. Node24.21.0, Evolution0.5.14, x402Cardano2.26.0, SolanaKit5.1.0, MystenSui2.35.0. Measured peak RSS137.2MiB. This establishes local Linux cryptography compatibility, not hosted network, cold-start or merchant-checkout memory acceptance. Fixture provider data does not establish live chain readiness.

## Verification boundary

| Gate | Status | Evidence / remaining check |
|---|---|---|
| Existing infrastructure plans, PG18/network/expiry | PASS — read-only | Current authenticated metadata above; no resource mutation. |
| Ownership, nine provider/rail compositions, durable ledgers | Local fixture/native-PG verification | See task ledger for exact final commands/results; no external merchant/chain writes. |
| Historical Sui signatures/history | PASS — offline/read-only | Both retained signatures verified against historical canonical requirements; no hosted import. |
| Existing MCP OAuth/proof/console regression | Local verification | Final recorded gate lives in task ledger; actual host checks pending deployment. |
| Candidate Render signer initialization/memory/restart | UNVERIFIED | Existing-service deployment requires owner approval; local Linux checks do not substitute. |
| Retained Playwright actual merchant timing/memory | UNVERIFIED for candidate | No provider-side checkout preflight performed; owner live tests required. |
| Workspace remaining quota/no-spend capacity | UNVERIFIED | Owner account dashboard/access needed; preserve unrelated project allocation. |
| Database backup/restore | UNVERIFIED | Free has no managed backup; approved internal export method needed. |
| Nine new hosted live purchases | NOT RUN | Owner executes manual matrix after readiness. |

**Act Now:** approved protected backup/export before expiry and process/credential fencing before signer activation. **Investigate Now:** account quota/spend settings and actual Render candidate runtime. **Ignore / Accept Risk:** documented Free cold starts, subject to durable recovery. No candidate deployment, existing-wallet signing, chain broadcast, provider write, authoritative database mutation or secret relocation occurred. Local signing tests use disposable keys and fixtures only.

## Conditional authorization access checks

Authenticated read-only API checks on 10 October reverified Free PG18, unchanged loopback-only external allowlist and expiry 2026-11-05T06:55:54.699333Z. GET /postgres/dpg-db29mujncjis73dtvf70-a/export returned an empty list; no download URL or credentials were printed. A bounded CLI BEGIN READ ONLY / SELECT 1 / ROLLBACK attempt was refused by the IP allowlist before access. The [official CLI connection implementation](https://github.com/render-oss/cli/blob/main/pkg/tui/views/psql.go) uses ExternalConnectionString; it supplies no internal tunnel. [Render Free limitations](https://render.com/docs/free#other-limitations) prohibit shell/SSH/one-off jobs. These checks demonstrate why an internal export executor is still required; they do not demonstrate an authoritative backup.

GET /owners/tea-db1tjj1srm7s73d6vra0 returned only email/id/name/type (values other than workspace name were not printed). The [documented API index](https://api-docs.render.com/llms.txt) and installed CLI do not expose remaining workspace hours, build allowance or payment/spend settings. Metrics are not authoritative billing balances. Browser dashboard inventory/open attempts failed because the Windows browser helper could not initialize (setup refresh error); no dashboard page was inspected. [Render directs quota inspection to Billing / Monthly Included Usage](https://render.com/docs/free#tracking-usage). Actual quota/spend settings remain UNVERIFIED, no paid resource was enabled, and no cloud build/deployment was started.

Backup/export and isolated restore: BLOCKED; no authoritative snapshot exists from this work. Sui permanent guard: local fixture verification only; actual history/authority unchanged. Cutover, key relocation, signing activation and hosted non-spending acceptance: NOT RUN. The current checkpoint is BLOCKED_REQUIRES_OWNER_INPUT for account evidence and a permitted internal export mechanism, not hosted test readiness.

The replacement payer image with the authorized Sui retirement fix built successfully: local image ID sha256:6b9d656776c66ea06c8f28c942561bae12f34052cd37e373cef83a5a809eeb05 (platform manifest979e91708cf4b7b9fb69db6838ba0152101b8a7ae3580ecf0f76aa0942221ca2). Its retirement/retained-fence/read-only-import/exact-byte checks passed as non-root Node24.21.0 with network disabled, read-only root, 16MiB tmpfs, 512MiB memory and 0.1CPU. Retirement-only peak RSS76,008KiB; this is not a three-rail/checkout memory measurement. Affected ledger/tool/payment/native-PG checks cover38 distinct tests, all passing; root typecheck passed. Current read-only service metadata still shows gateway/Cardano/Solana live, Free, not suspended at7c09b37; protected Sui source hash remains unchanged. No Render build/replacement or authority change occurred.

The existing Solana /status was subsequently inspected read-only using only its named bridge token retrieved in memory from the authenticated API (no signing-key retrieval or /pay). At2026-10-10T14:33:19.556Z: payer7entries,2historicalBlocked,0incomplete,94,220committed USDC base units; sponsor6entries,0incomplete,25,002committed fee lamports. Payer import SHA25619483c72bfed83abb04fd3bedaf569e0eb33d1806424ac14cb83066122808664; sponsor import SHA2561966603b4d08fdfc7f8776f3040346b928c2e94694c5259ab394ac129356f9d4. Remaining cumulative token cap405,780 and sponsor fee cap74,998; existing per-payment cap250,000 and commercial cap25,000USD-minor unchanged. Selected Solana read-only finalized balances verified and status configured; this is existing-runtime evidence, not consolidated hosted acceptance. Final quiesced snapshots must still be captured before cutover.

## Current authorized cutover checkpoint — 11 October 2026

The earlier BLOCKED/account observations above are historical. Owner screenshot and no-card confirmation pass the bounded Free budget gate:668.15hours, ~4.895GB bandwidth,447build minutes remaining at capture. Fresh final canonical Neon archive SHA9d7947be883f58b80bec9fff9ed683c309ee6e62f50acaffb8575dc920409477 restored all31tables/560rows and catalogs/ACL grant sets in disposable PG18. Actual original Sui permanent retirement and older-binary lock denial pass; original Cardano/Solana clients/keys are fenced and old Solana suspended. Additive0010-0012 applied, unchanged Sui signed history imported, three original sources disabled and zero authority grants. Gateway candidate3a88 passed16 hosted read-only OAuth/MCP checks.

Actual Render operator candidatec7e36 initialized Cardano/Solana and passed read-only chain checks, peak141,596KiB. Sui mounted-key permissions failed the existing guard; service suspended. Narrow selected-only protected staging correction passes10affected tests/typecheck/payer compile and independent code review. Exact replacement candidate will be recorded after commit; hosted Sui/restart acceptance still pending. All9 new live purchases NOT RUN. No payment/provider writes performed.


## Final hosted acceptance — 11 October 2026

Candidate `cb7b96e9e43a09842c1e9ee031bd1d8e3ec73e78`, source fingerprint `f2d961ba32f725057312b47ba7557e7971f194a648417314a5a18b9d9abcd84a`, is live on both existing Free512MB/0.1CPU services. Three original signer modules initialize on Render Node24.21.0; bounded read-only chain network/asset checks PASS. Peak process RSS145,856KiB (~142.4MiB), measured during all-three operator acceptance. No fixture/mock substituted for this runtime check; no transaction was signed or broadcast. Normal restart removes the operator source list and initializes no chain module; actual disabled/activated startup logs confirm no operator fan-out. Selected-only behavior and failures are covered by retained fixture/native-PG tests.

| Gate | Current status | Boundary |
|---|---|---|
| Three-rail Render SDK/key identity/PG history initialization | PASS | Actual original identities; signing disabled during operator checks |
| Read-only network/asset readiness | PASS | Cardano network/tip; Solana finalized balances; Sui network/asset/balances; spendability checked on selected purchase |
| Normal restart, ownership/source listing and payer auth | PASS | No operator checks, owned3sources, unauth listing401, no generic sign route |
| Existing hosted MCP/OAuth | PASS |16checks after exact deployment and restored scopes, no buy/quote/search |
| Console/historical receipt/proof | PASS | Existing public demo GET200; private source GET200; no secret signer references |
| Full authoritative backup/isolatedPG18restore | PASS | Post-cutover43tables/602rows, hashes/catalogs/ACLs/app role; SHA`f1fe714b075f1d294d1927dbf3b4a4561462d2f16cdcbad47c262068d579ffa7` |
| Free account capacity/billing | PASS for bounded verification | Owner capture668.15h/~4.895GB/447build-min remaining; no card; not current exact meters or dedicated allocation |
| Free cold start / host disconnect during real purchase | Owner test pending | Platform sleep accepted; durable/idempotent recovery tested locally; no keep-alive/wake/manualstartup |
| Playwright merchant checkout memory/timing | Owner test pending | Existing browser path unchanged; operator payer RSS is not Chromium proof |
| Nine new live purchases | NOT RUN | Owner manual sheet only |

No paid resource, new service, billing enrollment or browser provider introduced. Independent integrated review and narrow mount review completed; blockers fixed. Source Render database expiry/restriction still GET-verified; no stale-history rollback after target writes.

Actual deployed console artifact `/console/assets/index-BBTWYUDe.js`, SHA256 `1a97be6dcc76bfd921c54ca4744c2caf44167b2496c1b9fd084db75d9339588e`, passed known consent/service-token absence and private signer-material pattern checks. This is a bounded artifact check, not a universal secret-detection claim.

## Narrow wake runtime acceptance — 11 October2026

Gatewayb122186ceaadc36cb75abb4fb986cde7423a3046 retains payer3945f9c52cf76e1960569d53416361bcd42de175. Actual Workers Free fixed-health versionf416f62f first cold diagnostic:982.281s idle,200JSON in32.441s, independent payer startup. First deployed gateway cold check:993.28s idle, initial direct429, Worker200 in32.761s, direct authenticated readiness and fixed invalid-ID400, outer200 in34.250s. No payment attempt; all non-OAuth financial/history hashes unchanged. Second integrated acceptance FAILED at06:20:40.893UTC after974.361s idle: direct429, Worker-client timeout75.002s, outer503 after75.351s; no payer startup observed through06:23:52UTC. All non-OAuth tables unchanged; grants/signing/customer writes disabled. Cloudflare shows4invocations/3subrequests, one client cancellation, zero runtime errors, P99CPU4.05ms/memory1.58MB. Its final upstream status was not received. Activation is stopped, not pending routine completion. Fixture203affected tests and actual cold transport evidence are distinct; all9new live rows remain NOT RUN.


Final independent diagnostic08:04UTC: owner-authorized1direct request, Worker90s/caller110s,5506.843s idle. Worker200/upstream200JSON/routing none in32.408s; caller33.135s; independent Render startup08:04:27.933UTC. Version00ee6d4a-afdd-4807-ad05-f46d33fa1986 /moduledc652cc9fc9f22de757e0d35387e15726f985ba3929f162180313dab515cbf15 /sourceeeef8952a218b811f193c580d0a2b12bcdb155cd. Actual uploaded module equals verified dry bundle.21Worker tests/typecheck/default-denyPASS. Same gatewayb122186/payer3945,40non-OAuth table hashes unchanged, authority disabled. Prior06:32:15startup newly observed after earlier cutoff; trigger unknown. VerdictCOLD_WORKER_DIAGNOSTIC_PASS, integrated repeatability pending. No gateway deployment or live purchase. [Full proof boundary and next gate](PAYER_READINESS_REPAIR.md).
