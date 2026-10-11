# Capsule consolidated payer and database migration
Updated 11 October 2026 Singapore. Re-read before resuming work or taking irreversible action.

## Objective and current state
- WAKE_INTEGRATION_IN_PROGRESS: first genuine Cloudflare-origin cold PASS; opt-in gateway integration locally verified. Payment/customer authority remains disabled until repeated hosted gates.
- Existing Render Free gateway/MCP/OAuth, console, providers and Playwright are preserved. One reused Free payer contains three internal rails.
- Canonical database: owner-authorized Neon Free PG18.6 Singapore, direct/unpooled verified TLS. This explicit authorization supersedes the earlier Render-only database constraint.
- Former Render database remains read-only with its original loopback-only access restriction; expiry 2026-11-05T06:55:54.699333Z.
- Demo ownership: cus_HOSTEDMCPDEMO -> payer_HOSTEDMCPDEMO -> three original registered wallets.
- Listing reads registrations. A payment initializes only its selected chain and genuinely required sponsor; no alternative wallet after failure.

## Repository and checkpoint
- Remote: https://github.com/dropandresetmain-prog/token2049-origins.git.
- Main verified unchanged: 7c09b37eaaeda2bf3eec94fc1e3456118962f636.
- Branch: codex/capsule-neon-migration; worktree: C:/Dev/token2049-origins-neon-migration.
- Gateway deployed b122186ceaadc36cb75abb4fb986cde7423a3046; retained payer3945f9c52cf76e1960569d53416361bcd42de175; signing/grants/customer writes disabled pending second integrated cold check/activation.
- Canonical gateway Git fingerprint: ef0291f957939be981e7247b081263820b78c0bf7cac03ae33fb9b6be17fb942; payer fingerprint addbe059ddebc7794a8d6f510f964f0d1dee300e3a58dcdb44248fd088ecdd46.
- Worker checkpoint9ee0e7d pushed; gateway integration replacement resolve git rev-parse HEAD. Worker deployed versionf416f62f, canonical moduleSHAe40e3110bdf403c1e0acb60b5493894aa27a3c28d10167e33a17b53775ac1450.
- Normal gateway dep-db5ibrd9fdbs73d067p0 live; retained disabled payer dep-db5b0o5ckfvc739j3l60. Activation blocked.
- Shared codex/console-source-store checkout and unrelated changes untouched; no main promotion.
- Original on-demand7785c667 lane and gateway-onlyad3d675 lane preserved. Sui bae2f623 integrated asd7cd82c after overlap review.
- Previous ledgers: PUBLIC_JUDGE_CHECKPOINT.md and CONSOLIDATED_PAYER_PRE_NEON_CHECKPOINT.md retained.

## Constraints and authorization
- Only one narrow on-demand Cloudflare wake Worker is authorized (11 October attachment8577f52b). No replacement MCP/commerce/payer/OAuth/database/browser, queue, cron, keep-alive, paid plan or service per customer/wallet/rail.
- Keys only in payer. Original identities, caps, histories and sponsor roles preserved. Exact quote/digest/funding option/source bind approval.
- Reservations and signed candidates persist before irreversible calls. Unknown outcomes reconcile the same candidate; merchant attempts are not duplicated.
- Rail caps remain separate. Applied migrations immutable and additive; historical purchase owners are not reassigned.
- Conditional authorization968807b/source05c1ff09 permits verified narrow replacement candidates and cutover after mandatory gates.
- Subsequent explicit Neon authorization permits Free PG18 Singapore export/import and minimal idle-aware worker glue.
- Owner explicitly permitted the early source read-only fence; quota screenshot and No card confirmation passed the bounded no-paid gate.
- Conditional activation permission exercised only after history, ownership, fencing and hosted readiness passed.
- Latest owner authorization permits the narrow repair through deployment/readiness and aligning Solana/Sui token/commercial per-payment/daily/cumulative caps to Cardano (5,100,000 units / USD5,100 at1:1000). Chain gas/fee caps remain separate. No agent broadcast, funding, provider writes or merchant payment.
- Three owner incident rows failed before recorded signing; all expired with unsafe handoffs. Do not retry or mutate them. Remaining live rows NOT RUN.

## Current repair checklist
- [x] Authenticated selected-payer transport readiness before durable claim; useful bounded progress and expiry recheck.
- [x] Fixed-field HTTP diagnostics and sanitized payer receipt/result logs; no automatic POST retries.
- [x] Explicit additive audited cap amendment; original identities/history/blocked exposure retained.
- [x] Focused native PostgreSQL/fixture tests, builds and one independent narrow review.
- [x] Consistent backup/restore, quiescence/fencing, exact candidate deployment and cap configuration.
- [ ] Hosted non-spending checks including cold ingress and selected-rail initialization; owner E2E handoff.
- Current checkpoint: gatewayb122186/payer3945live normal/disabled; first integrated cold993.28s idle/34.250s total PASS; second window starts06:04:24.564UTC. Cold429 retries and identified UA fail; unauthenticatedhealth confirms x-render-routing hibernate-rate-limited.175integrated/85affected/8finaltests,6gateassertions,builds and OAuth16PASS;44table history unchanged.
- Incident report: C:/Dev/token2049-origins/output/cross-rail-investigation-20261011/REPORT.md.
- Protected primary addendum: ~/.capsule/neon-migration-20261011/incident-crossrail-20261011/ADDENDUM.md.
- VERIFIED: 1:1000 active on all3; financial hashes unchanged; chain reads no incident settlement; merchants not started.
- UNKNOWN: exact historical ingress HTTP status; inactive payer is leading hypothesis, not definitive cause.

- [x] Wake boundary19tests/local workerd/independent review; gateway135affected unit tests and68native PostgreSQL/MCP integration tests/typecheck/build PASS; independent extension no code blocker, including9fixture combinations and unclaimed wake failure/ambiguousPOST protection.

## Implementation and local verification
- [x] Instructions, refs, implementations and histories inspected; isolated lane and known-good checkpoint preserved.
- [x] Customer/profile/source contracts; synthetic two-customer, multiple-wallet and same-rail isolation.
- [x] Exact approval and source persistence; selected-only three-rail dispatch; canonical purchase API with no signing oracle.
- [x] Persistent rail histories, independent caps, concurrency/idempotency and conservative reservation/candidate recovery.
- [x] Nine provider/rail combinations through shared contracts with labeled fixtures.
- [x] Sui PostgreSQL history/import and permanent retirement; actual older-binary lock denial.
- [x] Console source/progress/provider receipt/independent proof and visibility-aware polling.
- [x] Independent integrated review: legacy namespace bypass fixed with native tests and cross-table identity guards.
- Integrated gate:55files/732tests,729PASS; three changed expectations fixed, affected8files/150PASS.
- Selected-source126PASS; console89PASS; final affected35PASS; wallet ledger5PASS; retirement38distinctPASS.
- Root/console typechecks and builds PASS. Local Node24Linux512MiB/0.1CPU/network-none signing fixtures8PASS.
- Narrow Render mount correction:10affected tests, root typecheck and payer compile PASS.
- Fresh narrow independent review found no blocker; bounded opened-file read improvement applied.

## Database migration and protected backups
- [x] Neon org free_v3; project cool-paper-95079645, AWS aws-ap-southeast-1, actual PG18.6, fixed0.25CU and112connections.
- [x] Native session locks/transactions/savepoints/interruption/postcommit/row locks/idempotency:7PASS; migration checksums retained.
- [x] Initial Render31tables/705rows full restore; SHA b7064e44c69fec67333479bebdac998be5a11b0dc36e63346c1a9eb8ecc170ee.
- [x] Final source31/707 full restore; SHA 1a5a444c7084d82e04c713bc00a9744c0c503d4295051633457de29366606622.
- [x] Database-only cutover initially changed only DATABASE_URL across three services; exact old identities retained.
- [x] Source new-session write denied SQLSTATE25006; original access restriction restored and final GET verified.
- [x] Idle-aware worker preserves committed wake, durable queue/lease/reconciliation; empty queue checks every30min.
- [x] Actual automatic idle17:43:17UTC and hosted read reconnect0.965s; post-idle OAuth/MCP16PASS.
- [x] Fresh quiesced Neon31/560 full restore; SHA 9d7947be883f58b80bec9fff9ed683c309ee6e62f50acaffb8575dc920409477.
- [x] Post-cutover43tables/602rows full restore; SHA f1fe714b075f1d294d1927dbf3b4a4561462d2f16cdcbad47c262068d579ffa7.
- Complete table hashes, schemas/functions/triggers/indexes/constraints/policies/sequences/default ACL grant sets/app role PASS.
- Canonical branch br-royal-leaf-b32j7xx6 / endpoint ep-young-recipe-b3jx46ll; validation br-floral-glade-b30iu8nk.
- Protected archives, credentials, raw history, runtime proof and journal: ~/.capsule/neon-migration-20261011, outside Git.

## Consolidated cutover and actual hosted verification
- [x] Quiescence and final snapshot; active jobs/purchases/funding/merchant/handoffs all zero before activation.
- [x] Old payer clients revoked; actual old tokens HTTP401; original cloud signing-key paths404.
- [x] Cardano/Solana permanent local retirement/import guards. Sui .retired/.lock, old binary callback denied, source hash unchanged.
- [x] Additive0010-0012 applied; verified Sui import; original three wallets registered disabled before key provisioning.
- [x] Existing protected keys and restricted new tokens only in payer; gateway has no signing keys or legacy bridges.
- [x] Both existing Free services live at exactcb7b96e; old Solana srv-db35psid0e5s73f7ltng suspended and retained.
- [x] Actual Render Node24.21.0 three-rail identity/history/read-only chain checks PASS; peak145,856KiB (~142.4MiB).
- Sui initially rejected a Render0777symlink ->0640file. Selected-only private0700/0600 staging preserves identity/permission guards.
- [x] Operator source list removed. Normal disabled and activated restarts have no operator RPC fan-out; payer auth/routes PASS.
- [x] Owners/policies match.25original financial table hashes unchanged, normalizing the additive nullable recovery column.
- [x] Three enabled grants match exact instance capsule_cb7b96e9e43a. Signing enabled after gates; demo scopes restored last.
- [x] Post-activation OAuth/MCP16PASS; unauthenticated source listing401; owned listing shows three configured sources.
- [x] Console/historical receipt/proof GET200; deployed frontend known-token/private-material checks PASS.
- [x] Owning docs, manifest, ledger and manual sheet updated; no unresolved implementation blocker.
- New purchases0, payments0, provider writes0. One original hosted purchase retained. All nine owner rows NOT RUN.

- Repair final quiesced43/759 snapshot/restore SHA c36c8b2db86e79dcdb30653404c3bc1dd53baca57a98f0770c3e4a5c1e441ffc; all financial/history hashes retained.
- Actual repaired Render3rail checks PASS, Node24.21.0/146300KiB peak; operator list removed; all caps pinned5.1m.
- Fresh review: two runner gates corrected/six assertions PASS; final authority runner no blocker. No live purchases performed.

## Preserved histories
- Cardano:5accepted/94,820; importSHA0909a33e5de6296ebccb5df2a5f700c67e16a800cc3d195d8465fb25d46b9381.
- Solana payer:7entries/2blocked/94,220; importSHA19483c72bfed83abb04fd3bedaf569e0eb33d1806424ac14cb83066122808664.
- Solana sponsor:6entries/25,002lamports; importSHA1966603b4d08fdfc7f8776f3040346b928c2e94694c5259ab394ac129356f9d4.
- Sui:2signed/35,900token units/20,000,000MIST; sourceSHA3db74885426ee2e7e42226d3a4ebb64b0ab8834babc09ea35049fdcfee7817f0.
- Sui readback: one expired candidate absent, one confirmed. Both signed payloads/digests/exposure retained, no replay or reset.
- Exact source IDs, public identities, caps and approval requirements in manifest/manual sheet. Old local proof stores retained.

## Risks, quotas and next action
- Current authenticated Render dashboard13:55SG:77.23/750hours used (672.77remaining),66/500build minutes used (434remaining),115MB/5GBused (~4.885GBremaining);6/25services; Hobby/no card, current/projected chargesUSD0. Rounded shared counters.
- No card on file verified: excess use stops builds/suspends Free apps. Worker Free/$0 verified; budget20Worker requests/3health wakes,30build minutes/2instance hours. No exact account-wide Worker request meter.
- Neon Free confirmed free_v3:1GiB/project,100CUh/month,6hrestore; API06:09:55UTC reportscompute_time_seconds2713,39,889,248transfer bytes; exact remaining Free compute allowance unverified. Zero storage/writes counters are not zero-usage proof.
- Conservative empty-queue estimate43.4CUh/month using7min active windows; reserve20CUh for owner. Actual idle/reconnect PASS.
- Investigate Now: repeated integrated cold acceptance and activation gates pending. First cold PASS at05:43UTC after982.281s idle: Worker200/upstream200 in32.441s, independent payer startup; authenticated gateway readiness subsequently PASS. Histories unchanged.
- Investigate Now: owner9live rows/browser timing/disconnects and undocumented limiter scope/reset.
- Investigate Now: periodic protected backups and shared quotas; no paid/provider retention change without approval.
- Investigate Now: local console-access-key differs from unchanged deployed hash; public demo view works without it. No rotation.
- Ignore / Accept Risk: Free cold starts, controlled Render secret symlinks and retained conservative Sui exposure. No warm-up required.
- Park for Later: consumer onboarding, advanced orchestration and infrastructure replacement.
- Next action PRIMARY: second integrated cold check no earlier06:20:24.564UTC, refresh read-only OAuth first (no payer traffic); if PASS save exact candidate/history/ownership/backup proofs and resume conditional activation. Never buy. Fresh44table/805row PG18restore PASS SHAcaf31fb7; all ACLs preserved with inert local platform roles.
- Same chat for narrow owner failure fixes. Never autonomously start a purchase or provider preflight after handoff.
- Rollback: fence authority and inspect canonical history first; no stale restore or old signer reactivation after spending/uncertainty.

## Evidence links
- docs/architecture/CONSOLIDATED_PAYER.md — implementation, cutover, rollback and complete hosted record.
- docs/architecture/RENDER_MULTIWALLET_RUNTIME_EVIDENCE.md — fixtures vs hosted checks vs owner live boundary.
- docs/architecture/NEON_DATABASE_MIGRATION.md — native PostgreSQL, full restores, idle and retention record.
- deploy/consolidated-payer-release.json — deployed SHA/fingerprint/resources/secret NAMES and authorization boundaries.
- docs/demo/MULTIWALLET_MANUAL_ACCEPTANCE.md — official setup, protected code retrieval, IDs/caps/nine NOT RUN rows/recovery.
- docs/HANDOFF.md — completed state and exact owner next action; historical handoff retained.
