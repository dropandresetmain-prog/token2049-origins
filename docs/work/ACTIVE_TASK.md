# Capsule consolidated payer and database migration
Updated 11 October 2026 Singapore. Re-read before major phases and completion.

## Objective and current architecture
- Existing Render Free gateway/MCP/OAuth, console, providers and Playwright unchanged except reviewed idle worker glue.
- Owner authorized existing Render PG18 -> Neon Free PG18; this supersedes the earlier database-provider prohibition.
- One consolidated Render Free payer candidate: Cardano Preprod, Solana Devnet, Sui Testnet modules.
- Authenticated customer -> logical payer profile -> multiple registered wallets; demo owner cus_HOSTEDMCPDEMO.
- Gateway consolidated candidate is live read-only; consolidated payer disabled runtime acceptance in progress; old Solana suspended.

## Repository/checkpoint
- Remote https://github.com/dropandresetmain-prog/token2049-origins.git; main verified7c09b37eaaeda2bf3eec94fc1e3456118962f636.
- Branch codex/capsule-neon-migration; worktree C:/Dev/token2049-origins-neon-migration.
- Parent candidate7785c6674b1dd0b1b0a81c8ee48cd794abbb7019, original lane preserved clean.
- Previous migration checkpoint cef5d17124216f5508e5317ca04c8d3e5be705ce; this checkpoint records verified hosted database cutover.
- Exact final SHA/source fingerprint: clean scripts/multiwallet/release-plan.mjs output after exact-file commit.
- Gateway-only compatibility branch codex/capsule-neon-idle-gateway, pushed/livead3d675cdeb1774c2f2a961823d6cb7107ee948e.
- Shared checkout codex/console-source-store and unrelated changes untouched; no main promotion.
- Prior ledgers preserved PUBLIC_JUDGE_CHECKPOINT.md and CONSOLIDATED_PAYER_PRE_NEON_CHECKPOINT.md.
- Sui feature bae2f623dccc47d7604a48919c969e2229bce340 integrated asd7cd82c after overlap review.

## Constraints and authorization
- One payer runtime, many profiles/wallets; no service per customer/rail/wallet; no new queue/framework/runtime.
- Keys remain outside gateway. Listing/quoting reads registration, only selected source probes its required chain/sponsor.
- Approval binds owner, quote/digest/amount/expiry, funding option and source; never fall back after failure.
- Preserve reservations, signed candidates, independent caps, histories, sponsor separation and unknown outcomes.
- Immutable applied migrations; additive changes only; no historical owner reassignment or namespace resets.
- Fixture signing/native disposable tests/exact-file commits and task-branch pushes authorized.
- Conditional consolidated authorization for968807b/source05c1ff09 retains quota/backup/Sui fencing gates.
- New attachment authorizes Neon Free creation/export/restore, coordinated DATABASE_URL-only cutover and minimal required polling compatibility.
- Owner reply11October explicitly authorizes temporary SOURCE read-only fence before resume/redeploy.
- No provider holds/prebooks/orders/bookings/payments/ticketing, chain broadcast, main promotion or paid plan.
- Existing keys were not moved/read during database migration; conditional custody/authority actions now authorized after passed gates.
- Owner performs all nine live tests after hosted consolidated readiness; every live matrix row NOT RUN.

## Implementation verified before migration
- [x] Inspect instructions/refs/code/legacy ledgers/Sui evidence; isolate lane and preserve submission.
- [x] Customer/profile/source ownership, exact approval/persisted source and selected-only dispatch.
- [x] Default-disabled single service three-rail payer; preserved legacy namespaces and immutable policies.
- [x] Native PostgreSQL history/import/idempotency/concurrency/recovery and synthetic nine-provider/rail matrix.
- [x] Sui durable hosted ledger/import tooling; permanent file retirement guards and old-binary lock denial.
- [x] Console/progress/payment plus merchant proof contracts; release manifest/manual matrix/runbook.
- [x] One fresh independent integrated review; legacy wallet namespace bypass fixed with DB/runtime guards.
- Integrated gate55files/732tests:729 passed; three changed expectations fixed, affected8files/150passed.
- Selected-source contracts3files/126passed; console9files/89passed; root/console typechecks/build passed.
- Final affected multiwallet/registration/hostedpayer35passed; walletledger5passed.
- Retirement affected4files/38distinct tests passed; typecheck/rebuilt image passed.
- Node24.21 Linux512MiB/0.1CPU, network disabled/read-only FS: three-rail fixture signing/serialization8PASS, peak137.2MiB.
- Permanent Sui retirement fixture4PASS, peak76,008KiB; actual retirement now passes: unchanged source hash, permanent marker/lock, modern read denied and older binary callback denied.
- Local payer artifact sha256:6b9d656776c66ea06c8f28c942561bae12f34052cd37e373cef83a5a809eeb05.

## Database migration and deployed checkpoint
- [x] Neon orgfree_v3 verified; projectcool-paper-95079645, AWSaws-ap-southeast-1, actualPG18.6.
- [x] Direct/unpooled verified TLS,0.25CU min/max,112connections,1GiB/project,100CUh/month documented.
- [x] Protected initial completePG18 archive31tables/705rows; full hash/schema/role/ACL restore verified.
- Initial SHA b7064e44c69fec67333479bebdac998be5a11b0dc36e63346c1a9eb8ecc170ee.
- [x] Seven native Neon session/lock/interruption/tx/savepoint/postcommit/row-lock/idempotency checks PASS.
- [x] Validation automatic suspension/resume PASS1.8s; nine applied migration checksums match7c09b37.
- [x] Quiesce all three source writers; fresh final full snapshot31tables/707rows; complete clean authoritative restore PASS.
- Final SHA1a5a444c7084d82e04c713bc00a9744c0c503d4295051633457de29366606622.
- Final archive: one succeeded purchase/merchant/funding handoff; two done jobs; consumed reservation; no active/unknown work.
- Source snapshot session inventory only migration client; full archive retains all histories/signed headers/import/blocked records.
- [x] Source/target full table hashes still matched after re-quiescence; owner-approved source role read-only fence applied.
- [x] New source session UPDATE denied SQLSTATE25006; original Render allowlist restored and independently GET-verified.
- Render rejects deploy while suspended; resume alone retained old environment. Explicit unchanged-artifact deployment required.
- [x] Only DATABASE_URL changed across existingthree services; all other env hashes unchanged; all known-good7c artifacts verified live on Neon.
- [x] OAuth/PKCE/resource metadata/foreign Origin/code replay/MCP initialize/discovery/historical get_purchase16checks PASS.
- [x] Cardano and Solana hosted health/authenticated status PASS; original identities, histories and caps retained.
- [x] Console/treasury/historical purchase/receipt/proof GETs200; no merchant or chain write.
- Only four OAuth bookkeeping tables differ from final source; all other financial/history hashes unchanged.
- Target authoritative branchbr-royal-leaf-b32j7xx6; endpoint ep-young-recipe-b3jx46ll; validationbr-floral-glade-b30iu8nk.
- Source retaineddpg-db29mujncjis73dtvf70-a; expiry2026-11-05T06:55:54.699333Z (Nov5 14:55:54SG).
- Protected owner-only backups/journal/credentials outsideGit at ~/.capsule/neon-migration-20261011.
- Four future-object default ACL creator/owner/grantor labels mapped Renderpostgres->Neonadmin; original archive immutable.
- Explicit schema bootstrap privileges preserved; allowners/app role flags/table hashes/catalog comparisons PASS.
- [x] Minimal idle-aware worker: immediate local committed wake, persisted deadlines/lease/reconciliation, empty queue every 30 minutes.
- Migration focused44PASS then19affectedPASS; gateway-only45PASS/typecheck/build; access failure-recovery5PASS/typecheck.
- Fresh bounded independent migration review completed: reservation wake, env example, recovery journal issues fixed.
- [x] Deployed automatic idle at17:43:17UTC; hosted purchase read resumed in0.965s; post-idle OAuth/MCP16checks PASS.
- Compute usage fields currently0 are delayed/ambiguous, not exact billed evidence; conservative bounds required.

## Next action / boundaries
- Post-cutover source remains read-only and all31tables match final snapshot; target differs only in OAuth bookkeeping.
- Original network restriction independently reverified; target11,796,480bytes; pending jobs/purchases/funding allzero.
- Conservative empty-queue estimate43.4CUh/month using7minute active windows;20CUh reserved for owner tests.
- Verification compute upper bound under0.6CUh across both0.25CU endpoints; exact billed meter unavailable.
- Resolve current clean HEAD/source fingerprint from release-plan; final completion output records verified push.
- Owner screenshot11Oct verifies668.15/750Free hours remaining, ~4.895GB/5GB bandwidth remaining,447/500build minutes remaining.
- Matching workspace tea-db1tjj1srm7s73d6vra0;6/25included services. Shared capacity is not a permanent allocation to Capsule.
- Owner confirms no payment method ("No card"); Render stops builds/suspends Free apps at overages instead of billing. Gate passes for bounded consolidation.
- Fresh Neon backup bedebf56b9dc1b5f2bcc6195aea4fc9afe13c2d53efd84fb8b979ff53c68006f:31tables/560rows, all restore/catalog/ACL grant-set comparisons PASS. Financial hashes unchanged.
- Original Sui source permanently retired; offline signatures/hash PASS, old binary callback denied. Readback: one successful digest, one absent; both validity windows expired at current epoch1248. Counts/exposure remain unchanged.
- Quiescence/final snapshot/restore, actual old-signer fencing, additive0010-0012/import/disabled registration completed; retain proof in protected journal.
- Only previously approved custody/deployment/activation steps after every retained gate passes; no live purchases.
- Source has become stale after target OAuth writes; no blind complete-service rollback. Prefer target roll-forward/reconciliation.
- Gateway compatibility rollback must retain idle-aware behavior or suspend gateway; no permanent1secondhotpoll.

## Risks and evidence limits
- Act Now: complete disabled three-rail hosted acceptance before exact-instance activation; old authority fencing and fresh snapshot/restore PASS.
- Ignore / Accept Risk: owner confirms no card; published overage behavior denies excess use. Shared quotas remain finite.
- Investigate Now: rerun disabled hosted acceptance after bounded secret-mount correction; Cardano/Solana passed, Sui permission failure isolated.
- Investigate Now: exact Neon billed usage unavailable through Free consumption-history connector; observe idle/bound usage.
- Park for Later: public onboarding/advanced orchestration; no new work introduced.
- Ignore / Accept Risk: Free sleep/cold starts with durable idempotency/readback; sandbox/testnet/notional disclosures retained.
- Existing Cardano:5accepted/94,820; Solana payer7/2blocked/94,220, sponsor6/25,002lamports.
- Sui file retained hash3db74885426ee2e7e42226d3a4ebb64b0ab8834babc09ea35049fdcfee7817f0,2signed/35,900/gas20,000,000.
- All apps quiesced; original cloud payer clients revoked, original cloud key files removed, local retirement/hash/import guards verified. Consolidated authority not enabled.
- Current checkpoint: additive0010-0012 applied, original Sui history imported, three sources registered disabled. Gateway candidate3a88 live, read-only OAuth/MCP16PASS; payer Node operator startup verified Cardano/Solana, Sui mount compatibility correction pending.
- Final quiesced Neon backup/PG18 restore SHA9d7947be883f58b80bec9fff9ed683c309ee6e62f50acaffb8575dc920409477 PASS31tables/560rows. Original histories unchanged after import; only reviewed additive/auth changes.
- Node operator candidatec7e36 passed actual Render Cardano/Solana initialization and read-only chain checks, peak141596KiB. Sui refused mounted secret permissions (lstat0777). Payer suspended to stop retries; gateway read-only OAuth/MCP16PASS.
- Next: deploy verified bounded selected-secret staging correction (affected10PASS, typecheck/payer compile PASS); operator checks signing false, then remove operator startup before activation. Independent narrow review reports no blocker; controlled platform symlinks accepted with opened-file bound and downstream identity guard.

## Evidence links
- docs/architecture/NEON_DATABASE_MIGRATION.md: runtime/restore/cutover/Free-budget record.
- docs/architecture/CONSOLIDATED_PAYER.md and deploy/consolidated-payer-release.json: approved release/gates/rollback.
- docs/architecture/RENDER_MULTIWALLET_RUNTIME_EVIDENCE.md: actual local image and account proof boundaries.
- docs/demo/MULTIWALLET_MANUAL_ACCEPTANCE.md: nine owner rows, all NOT RUN.
- docs/work/CONSOLIDATED_PAYER_PRE_NEON_CHECKPOINT.md: preserved detailed previous candidate evidence.
- docs/work/SUI_FUNDING.md and docs/demo/: historical local/live Sui evidence, not candidate hosted acceptance.

