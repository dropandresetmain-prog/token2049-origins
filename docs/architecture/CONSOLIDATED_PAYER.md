# Consolidated payer candidate

Current status: **BLOCKED_TECHNICAL — Render cold hibernation admission.** Gateway `fe8abb7a82eb6e610445b40459137b5735647f39`; retained payer `3945f9c52cf76e1960569d53416361bcd42de175`; branch `codex/capsule-neon-migration`. Payment grants/signing and customer writes remain disabled. Token caps now match Cardano; all owner live acceptance rows remain NOT RUN. Exact runtime evidence, fingerprints and the owner support packet: [current repair record](PAYER_READINESS_REPAIR.md).

The retained implementation/cutover evidence below describes the earlier `cb7b96e9e43a09842c1e9ee031bd1d8e3ec73e78` checkpoint (fingerprint `f2d961ba32f725057312b47ba7557e7971f194a648417314a5a18b9d9abcd84a`), before the owner incident and repair. It is historical acceptance evidence rather than today’s activation state.

## Architecture and authority

Keep the existing Render Free gateway, hosted `/mcp` OAuth server, console, provider adapters and Playwright/Chromium checkout. Owner authorization superseded the original database-retention decision: Neon Free PG18 is now authoritative, using direct verified-TLS sessions. Render source `token2049-origins-db` is retained read-only with its original network restriction. See [verified database migration](NEON_DATABASE_MIGRATION.md). No Cloudflare replacement runtime/browser, extra OAuth provider, queue or wake orchestration.

Reuse the existing Cardano Render service as **one consolidated Free payer**. Cardano Preprod, Solana Devnet and Sui Testnet are internal signing modules. The separate Solana runtime is suspended only at approved cutover; it is not automatically deleted. No service per customer, wallet or chain.

```text
ChatGPT → existing gateway /mcp and OAuth → exact quote / approval / purchase
                                             │ purchaseId-only authenticated /pay
                                             ▼
                               one consolidated Render Free payer
                               ├─ Cardano Preprod
                               ├─ Solana Devnet + required gas sponsor
                               └─ Sui Testnet
                                             │
                         existing PostgreSQL: ownership, histories, accounting
```

The demo remains explicitly linked to `cus_HOSTEDMCPDEMO`. Passcode access does not make these shared demo wallets each visitor's personal wallets. Synthetic tests prove isolation; public wallet onboarding is outside this milestone.

Ownership is `authenticated customer → payer profile → registered wallets`. A source has a stable public ID, rail/network/asset/address, protected signer reference, immutable financial policy and ledger namespace. Public listings omit signer references and keys. Multiple wallets on the same rail are separate sources. Listing and quoting read registrations/configuration; they do not probe every chain wallet or claim current balances.

Approval binds customer, exact quote digest/total/expiry, funding option and `selectedSourceId`. The source snapshot is stored before signing. The payer fetches the canonical purchase and independently validates ownership, source, network/asset/recipient/amount, policy, expiry and prior attempt. It never accepts arbitrary bytes to sign or substitutes another wallet after failure. Only the selected chain and genuinely required sponsor are initialized.

## Persistence and recovery

Additive migrations `0011_registered_wallets.sql` and `0012_wallet_ledgers.sql` establish ownership, immutable purchase-source snapshots, explicit signing authority and chain-specific persistent histories. The Sui integration also adds `0010_sui_funding_recovery.sql`; apply exact checked-in filenames/checksums. Applied migrations remain immutable.

Existing Cardano identity/import guards and PostgreSQL history remain canonical. Existing Solana payer/sponsor identity, imported history and blocked-attempt guards remain intact; sponsor fee exposure is shared where the same sponsor is reused. New namespaces cannot be used to erase existing wallet history. Chain token base units are never summed as a common budget.

Sui reservations, exact signed payloads, digests, timestamps and gas exposure move to PostgreSQL only through a verified, owner-approved import. The import pins source-file and requirements hashes, verifies retained signatures against historical canonical requirements and preserves every status/exposure. Unknown or old signed/reserved entries keep counting. A rerun verifies immutable history and never replaces it. Historical local purchase ownership and receipt URLs are not reassigned to the hosted demo owner.

Purchase and wallet locks are authoritative PostgreSQL session locks; database triggers preserve facts and monotonic states. Durable reservations precede signing and signed persistence precedes submission. An ambiguous reservation cannot authorize a rebuilt candidate. Response loss or restart requires readback/reconciliation of the same purchase/candidate. `get_purchase` is read-only and cannot create another payment or merchant attempt.

Merchant execution retains the existing durable jobs, journal, reconciliation and independent readback. Shopify still executes real sandbox checkout through Playwright; an Admin-created paid order is not a replacement. Discovery from real Shopify stores remains distinct from execution in Capsule's controlled test store.

Only verified payment plus independently confirmed provider completion and issued receipt permit `ORDER CONFIRMED`, `BOOKING CONFIRMED` or `TICKET ISSUED`. Pending/unknown states remain visible. Console polling stops when hidden or complete. Cold starts are accepted; no owner startup/warm-up command belongs in the purchase experience.

## Default-deny release

The payer image starts with `MULTIWALLET_SIGNING_ENABLED=false`. Startup checks installed schema but does not migrate, import histories or create identities. Registrations are inserted disabled; per-wallet signing grants must match `MULTIWALLET_INSTANCE_ID`. None of these gates independently proves authorization.

Use a dedicated funding client `cli_HOSTEDMULTIWALLETPAYER` with gateway hash `MCP_MULTIWALLET_GATEWAY_TOKEN_SHA256`. Its token is a protected payer file, never a gateway key or assistant value. Do not reuse revoked legacy payer identities. Existing OAuth issuer, endpoint, owner passcode and customer scope remain unchanged.

Gateway uses `MULTIWALLET_PAYER_URL` and `MULTIWALLET_PAYER_TOKEN_FILE`; remove legacy Cardano/Solana bridge configuration in consolidated mode. Payer uses `DATABASE_URL`, `MULTIWALLET_INSTANCE_ID`, `MULTIWALLET_ALLOWED_HOSTS`, `MULTIWALLET_PAYER_TOKEN_FILE` and prefixed signer configuration. Protected signer references select approved configuration, not caller URLs.

The local candidate alone authorizes no deployment, authoritative migration, key upload, grant activation, provider write or broadcast. Subsequent explicit owner authorization and passed gates permit the recorded cutover; provider writes/broadcasts remain excluded from agent execution. Exact resource IDs, secret **names**, migrations, fingerprints and approved actions belong in the release manifest; never include secret values or raw signed payloads.

The checked-in [release manifest](../../deploy/consolidated-payer-release.json) names existing resources and secret names. After a clean checkpoint, run `node scripts/multiwallet/release-plan.mjs` to produce the exact SHA and source fingerprint; it has no apply mode. Protected registration/import tools default to validation. During approved disabled deployment, `node dist/scripts/multiwallet/preflight.js SOURCE_ID` initializes only that registered demo source and verifies key identity/pinned policy/preserved history without signing or checking balances. This operator step is outside the customer demo path.

## Owner-approved cutover order

1. Reverify branch/SHA, manifest fingerprints, installed schemas, actual Free plans, remaining workspace hours/build/bandwidth and billing/spend settings. **Before any authoritative mutation or existing-service replacement**, complete a protected consistent database export and verify integrity plus isolated PostgreSQL 18 restore. Free services have no shell/SSH or one-off jobs; an actual eligible export executor is required. Obtain explicit scope for credential relocation, authoritative mutations, fencing and replacement of existing deployments. Separate testnet transaction permission from hosting permission.
2. Inspect in-flight purchases, durable jobs, merchant attempts and all payer reservations/signed candidates. Resolve or retain every unknown obligation. Stop gateway commerce writes and stop the legacy Cardano/Solana runtimes plus any local file signer before snapshot/import. Preserve readback access through a controlled operator path.
3. Revoke legacy payer gateway clients and bridge credentials. Verify stopped processes cannot restart with old authority. **Legacy images do not obey `wallet_signing_authority`: changing a database grant alone cannot fence them.** Preserve permanent Cardano/Solana local retirement markers and lock files. The Sui file signer now refuses ordinary ledger access when any `.retired` marker exists. After stopping every identified old signer, use the approved retirement tool below to retain a permanent hash-bound `.lock` as well; the retained older binary ignores the marker but cannot acquire that lock. Verify all original ledger paths are fenced and old credentials/configuration cannot create an independent signer. Never remove a stale lock just to make a test pass.
4. Capture a final consistent PostgreSQL 18 snapshot and protected history/export manifests, including identities, counts, hashes, caps, blocked attempts and gas exposure. Use a direct verified-TLS Neon client and protected PG18 tools. The database-only migration final backup/isolated restore passed; take another fresh Neon snapshot after consolidated-service quiescence because target OAuth state has advanced. No Render network change is needed.
5. Apply additive migrations to the existing authoritative database, import verified Sui history atomically, and register the existing owned wallet sources disabled with pinned policies. Retain the protected historical Sui database volume/manifests for old receipts; do not remap old purchase owners or manufacture hosted receipt URLs.
6. Provision only approved existing keys and dedicated tokens into the consolidated payer boundary. Deploy the exact candidate to the existing Cardano service and gateway with signing disabled; suspend the old Solana service only within the approved scope. Leave old services recoverable.
7. Verify identity derivation, imported counts/hashes/exposure, policies, blocked attempts, customer/source mapping, migrations and private history integrity. Run bounded **non-spending** MCP initialize/discovery, OAuth, source listing, selected-rail read-only readiness, console and proof-access checks. No quote/prebook/hold/order is needed merely for preflight.
8. Only after the named approved activation conditions pass, enable source records and grants for the exact instance, enable payer signing and restore commerce authority. Recheck that old signers and old commerce authority remain fenced. Do not create a purchase. Hand off with `READY_FOR_OWNER_MCP_TEST — LIVE E2E NOT YET VERIFIED`.

Existing hosted receipts/resource URLs stay on the same origin and authoritative database. Historical local Sui proofs remain historical with their protected old store. Unknown obligations remain inspectable even when an operator must keep signing disabled.

## Rollback boundary

Before any new signing/reservation with uncertain outcome, a rollback may restore the old build only after revoking/stopping the new authority, inspecting in-flight state and verifying the same complete authoritative history. Preserve all additive records and local retirement guards.

After new signing, submission or uncertainty, **never restore a stale snapshot or re-enable an old signer against divergent history**. Reconcile the canonical database and exact retained candidates, then roll forward or perform a separately reviewed rollback that understands those histories. No automatic wallet switch, new booking/order or repeat payment is a recovery strategy.

## Separate database retention recommendation

The retained former source Render metadata confirms expiry **5 November 2026, 14:55:54 Singapore** (`2026-11-05T06:55:54.699333Z`). Free PostgreSQL has no managed backup/PITR; complete owner-protected initial/final backups and isolated Neon PG18 restores now pass full hash/schema checks.

**Investigate Now:** retain protected final archive/checksums and account access; arrange owner-controlled periodic backups within Free limits. Neon short history retention is not a long-term backup. Do not delete or restore either database automatically, and do not buy retention without approval.

See [runtime evidence](RENDER_MULTIWALLET_RUNTIME_EVIDENCE.md), [manual matrix](../demo/MULTIWALLET_MANUAL_ACCEPTANCE.md) and [task ledger](../work/ACTIVE_TASK.md) for current verification boundaries.

## Independent review and verification

A fresh independent agent reviewed the integrated candidate read-only for authorization, custody, source binding, idempotency, persistent history, concurrency, runtime/quotas and cutover. One Act Now code issue was fixed: a legacy Cardano/Solana wallet could select a fresh namespace. Registration and ledger opening/readiness now reject it, and cross-table identity triggers serialize/reject clone insertion. Native PostgreSQL regression passes; legacy histories remain accessible.

No unresolved code blocker was reported. Remaining Act Now activation blockers are verified old-process/credential fencing; backup/isolated restore is verified but a new final Neon snapshot is required at consolidated cutover. Investigate Now: current workspace quota/spend settings and actual Render runtime/selected-rail/Playwright acceptance. Ignore / Accept Risk: documented Free sleep/restarts with durable candidate recovery; deferral risks latency/interrupted requests. Public onboarding and richer background orchestration are Park for Later: they are outside scope and do not weaken demo ownership or recovery. See task ledger for final targeted results; no new live purchase is claimed.

## Conditional authorization checkpoint

The owner approved candidate 968807b04952a0c7d881b8f01a681daa8e7cb0de / source fingerprint 05c1ff091c82eec0d9dbabcfedfdcbe44f3bb2b993aa9484ae4f9365a758cb30 with mandatory backup/quota and Sui retirement gates. That exact checkpoint was reverified; further narrow fixes receive an exact replacement SHA/fingerprint from the clean release-plan script. No additional broad implementation cycle is required.

**Gate1 backup requirement passes:** protected PG18 initial and final exports, complete restore/hash/schema verification and native session tests. Owner subsequently authorized exact-IP export and Neon cutover, plus a temporary source read-only fence before explicit redeployment. All existing apps migrated; only reviewed gateway idle compatibility was deployed. **Gate1 capacity evidence now passes:** owner Billing screenshot11October for the matching workspace shows668.15hours, approximately4.895GBbandwidth and447pipeline minutes remaining. **Spending-control evidence passes:** owner confirms "No card" on 11 October. [Render Free overage rules](https://render.com/docs/free) and [pipeline rules](https://render.com/docs/build-pipeline) stop builds or suspend Free services without a payment method instead of purchasing overage. No billing enrollment or plan change is needed. Shared quota availability remains bounded.

**Gate 2 implementation passes local checks; existing signer retirement is pending Gate 1.** The ordinary file ledger now rejects every marker, including malformed markers. Only readForImport permits read-only identity/permission validation. Run scripts/sui/retire-history.ts with --manifest PATH for offline signature/hash verification. Permanent retirement additionally requires --retire, CAPSULE_APPROVED_SUI_RETIREMENT=true and CAPSULE_BACKUP_RESTORE_VERIFIED=true after actual backup/restore and quiescence; flags are assertions, not permission. The compiled tool is included in the payer build. Import --apply requires matching protected .retired and .lock fences before opening PostgreSQL.

Retirement never modifies the history file or deletes a lock. It pins owner and exact source SHA256, fsyncs the permanent lock before the marker, and is idempotent for matching complete fences. Interruption after a complete matching lock can resume; an empty/truncated/conflicting lock remains blocked for manual reconciliation, never automatic repair. Do not import or activate after such a failure. Older local binaries were exercised against disposable history from retained Sui ref bae2f623dccc47d7604a48919c969e2229bce340 (ledger source SHA256 3e557f5b31a0748ee351107eae80ccc47fdc8a191813ad565d1aa05f2d1302f9); their signing callback was denied by the permanent lock despite their read ignoring the marker. This proves that retained implementation against the same path, not actual current process/key fencing.

A fresh bounded independent review found no completed-retirement authority/history blocker. Investigate Now: partial fence writes deliberately require manual reconciliation; regression coverage and this blocker rule retain that conservative behavior. The argument-parsing ambiguity noted by review was fixed. This review inspected source only; it did not execute tests or inspect deployments. No consolidated hosted acceptance, Sui history import or consolidated activation has occurred. Database-only hosted acceptance is recorded separately. All nine live rows remain NOT RUN.

11 October resumed authorization: fresh authoritative Neon backup SHA256 bedebf56b9dc1b5f2bcc6195aea4fc9afe13c2d53efd84fb8b979ff53c68006f restored into a separately named disposable PostgreSQL18 database. All31 tables/560 rows, schema, constraints, triggers, indexes, ownership and ACL grant sets match. ACL order can differ after pg_restore; grantor/grantee/privilege sets are identical. All financial table hashes match the database-cutover snapshot; only OAuth bookkeeping differs. scripts/multiwallet/backup-authoritative.mjs defaults to a plan and uses --snapshot-and-rehearse for a read-only Neon export plus local disposable restore. It changes no Render network permission.

The original Sui file is now permanently retired: source hash unchanged, modern ordinary read refused, actual retained older binary signing callback refused by the permanent lock, and offline import verification still passes. Both signed windows expired by read-only chain epoch1248; one digest is successful, one absent. Import retains both signed records and their full35900/20000000 exposure. Legacy cloud signers remain active pending the controlled step. scripts/multiwallet/cutover-render.mjs --quiesce enforces retained evidence gates, suspends only named apps and checks canonical outstanding obligations; no default apply. During disabled deployment, explicit preflight SOURCE_ID --readiness initializes only that source and performs bounded read-only chain checks. It never signs, submits or calls a merchant.

## Render mounted-secret compatibility correction — 11 October 2026

Actual disabled Render acceptance initialized Cardano and Solana and passed their read-only chain checks (peak141,596KiB). Sui rejected its mounted key path permission guard. The payer was suspended immediately to prevent repeated checks. Render's platform-controlled consolidated secret mount now opts into `MULTIWALLET_RENDER_SECRET_FILES=true`: only the selected module's key files are read from `/etc/secrets/consolidated-*`, with an opened-file8192-byte bound/change check, and staged in process-private0700 directories/0600 files. Existing rail identity and protected-file checks remain enforced; histories stay in PostgreSQL. Mounted symlinks are accepted as part of Render's trusted secret delivery, not caller-controlled paths. Copies are cleaned on close/failure. No new signing or history migration occurs in this glue.

Affected tests10PASS, root typecheck and payer compile PASS. Fresh narrow independent review found no blocker; its bounded-read suggestion was applied. Actual Sui hosted initialization and read-only readiness now pass at the replacement build. The operator-only entrypoint is removed after acceptance so normal startup and source listing never probe every wallet.


## Completed owner-approved hosted release — 11 October 2026

Both existing Free services run `cb7b96e9e43a09842c1e9ee031bd1d8e3ec73e78`; payer instance `capsule_cb7b96e9e43a`. Cardano, Solana and Sui original identities/policies initialize on actual Render Node24.21.0 with peak145,856KiB; read-only chain network/asset checks pass. Cardano spendability is deferred to a selected purchase, not invented from network readiness. Sui mount is a platform symlink0777 to0640 file, now privately staged with original identity guard. Normal payer entrypoint is `node dist/clients/multiwallet/hosted.js`; operator source IDs are removed. Disabled and activated restarts pass with no operator fan-out.

Canonical ownership/policy/history checks passed before activation. All25 original financial tables match final snapshot (nullable recovery column normalized); pending jobs/purchases/funding/merchant/handoffs zero. Original Cardano5accepted/94,820, Solana payer7entries/2blocked/94,220 and sponsor6entries/25,002lamports retained. Sui source hash3db74885426ee2e7e42226d3a4ebb64b0ab8834babc09ea35049fdcfee7817f0 retains2signed candidates/35,900token units/20,000,000MIST. Their expired validity windows/readback do not erase blocked exposure or signed bytes. Old local histories/proof schemas remain protected and recoverable.

Old cloud clients return401 with their actual retained tokens; original cloud key paths return404, old Solana service remains suspended. Original local Cardano/Solana/Sui fences are permanent, with actual old Sui binary lock denial. Three canonical source grants match the exact new instance. Signing was enabled only after all gates passed; demo commerce scopes restored last. No new purchase/payment/provider action was performed. Hosted OAuth/MCP16checks and console/historical receipt/proof/owned-source GETs pass after activation.

Final pre-consolidation archive `9d7947be883f58b80bec9fff9ed683c309ee6e62f50acaffb8575dc920409477` restored31tables/560rows. Post-cutover archive `f1fe714b075f1d294d1927dbf3b4a4561462d2f16cdcbad47c262068d579ffa7` restored43tables/602rows, complete hashes/catalogs/ACL grant sets/app role, into a newly named disposable PG18 database. Protected directory `~/.capsule/neon-migration-20261011` contains consistent archives/journal/retirement/import/runtime proofs; no values or raw candidates are committed.

Fresh integrated independent review found one namespace bypass, fixed and covered natively; narrow runtime review found no blocker, bounded-read improvement applied. Final correction10affected tests/typecheck/payer compile PASS. **READY_FOR_OWNER_MCP_TEST — LIVE E2E NOT YET VERIFIED**. Owner setup/manual rows live in the linked sheet. No additional autonomous test follows this checkpoint.

## Narrow owner payment repair

The11October owner-authorized readiness/diagnostic and cap correction is recorded in [PAYER_READINESS_REPAIR.md](PAYER_READINESS_REPAIR.md). Its later deployment record supersedes prior cap/revision observations below; original evidence remains historical.
