# Consolidated payer candidate

Updated 10 October 2026. Candidate branch: `codex/capsule-on-demand-multiwallet`; exact release SHA comes from `git rev-parse HEAD` and the release manifest. This is an implementation and cutover record, not hosted acceptance.

## Architecture and authority

Keep the existing Render Free gateway, hosted `/mcp` OAuth server, console, provider adapters and Playwright/Chromium checkout. Keep `token2049-origins-db` (Render PostgreSQL 18) authoritative and internally reachable only. No Neon, Cloudflare replacement runtime/browser, extra OAuth provider, queue or wake orchestration.

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

No deployment, authoritative migration, key upload, grant activation, provider write or broadcast is authorized by the local candidate. Exact resource IDs, secret **names**, migrations, fingerprints and approved actions belong in the release manifest; never include secret values or raw signed payloads.

The checked-in [release manifest](../../deploy/consolidated-payer-release.json) names existing resources and secret names. After a clean checkpoint, run `node scripts/multiwallet/release-plan.mjs` to produce the exact SHA and source fingerprint; it has no apply mode. Protected registration/import tools default to validation. During approved disabled deployment, `node dist/scripts/multiwallet/preflight.js SOURCE_ID` initializes only that registered demo source and verifies key identity/pinned policy/preserved history without signing or checking balances. This operator step is outside the customer demo path.

## Owner-approved cutover order

1. Reverify branch/SHA, manifest fingerprints, installed schemas, actual Free plans, remaining workspace hours/build/bandwidth and billing/spend settings. **Before any authoritative mutation or existing-service replacement**, complete a protected consistent database export and verify integrity plus isolated PostgreSQL 18 restore. Free services have no shell/SSH or one-off jobs; an actual eligible export executor is required. Obtain explicit scope for credential relocation, authoritative mutations, fencing and replacement of existing deployments. Separate testnet transaction permission from hosting permission.
2. Inspect in-flight purchases, durable jobs, merchant attempts and all payer reservations/signed candidates. Resolve or retain every unknown obligation. Stop gateway commerce writes and stop the legacy Cardano/Solana runtimes plus any local file signer before snapshot/import. Preserve readback access through a controlled operator path.
3. Revoke legacy payer gateway clients and bridge credentials. Verify stopped processes cannot restart with old authority. **Legacy images do not obey `wallet_signing_authority`: changing a database grant alone cannot fence them.** Preserve permanent Cardano/Solana local retirement markers and lock files. The Sui file signer now refuses ordinary ledger access when any `.retired` marker exists. After stopping every identified old signer, use the approved retirement tool below to retain a permanent hash-bound `.lock` as well; the retained older binary ignores the marker but cannot acquire that lock. Verify all original ledger paths are fenced and old credentials/configuration cannot create an independent signer. Never remove a stale lock just to make a test pass.
4. Capture a final consistent PostgreSQL 18 snapshot and protected history/export manifests, including identities, counts, hashes, caps, blocked attempts and gas exposure. Use an approved internal client; do not open Render database networking. The accessible internal snapshot method and latest owner-managed backup must be established before cutover; neither is presently verified.
5. Apply additive migrations to the existing authoritative database, import verified Sui history atomically, and register the existing owned wallet sources disabled with pinned policies. Retain the protected historical Sui database volume/manifests for old receipts; do not remap old purchase owners or manufacture hosted receipt URLs.
6. Provision only approved existing keys and dedicated tokens into the consolidated payer boundary. Deploy the exact candidate to the existing Cardano service and gateway with signing disabled; suspend the old Solana service only within the approved scope. Leave old services recoverable.
7. Verify identity derivation, imported counts/hashes/exposure, policies, blocked attempts, customer/source mapping, migrations and private history integrity. Run bounded **non-spending** MCP initialize/discovery, OAuth, source listing, selected-rail read-only readiness, console and proof-access checks. No quote/prebook/hold/order is needed merely for preflight.
8. Only after the named approved activation conditions pass, enable source records and grants for the exact instance, enable payer signing and restore commerce authority. Recheck that old signers and old commerce authority remain fenced. Do not create a purchase. Hand off with `READY_FOR_OWNER_MCP_TEST — LIVE E2E NOT YET VERIFIED`.

Existing hosted receipts/resource URLs stay on the same origin and authoritative database. Historical local Sui proofs remain historical with their protected old store. Unknown obligations remain inspectable even when an operator must keep signing disabled.

## Rollback boundary

Before any new signing/reservation with uncertain outcome, a rollback may restore the old build only after revoking/stopping the new authority, inspecting in-flight state and verifying the same complete authoritative history. Preserve all additive records and local retirement guards.

After new signing, submission or uncertainty, **never restore a stale snapshot or re-enable an old signer against divergent history**. Reconcile the canonical database and exact retained candidates, then roll forward or perform a separately reviewed rollback that understands those histories. No automatic wallet switch, new booking/order or repeat payment is a recovery strategy.

## Separate database retention recommendation

Read-only Render metadata on 10 October confirms expiry **5 November 2026, 14:55:54 Singapore** (`2026-11-05T06:55:54.699333Z`). Free PostgreSQL has no managed backup/PITR; the latest owner-managed backup and restore rehearsal are unknown.

**Act Now:** complete the conditionally authorized protected consistent export before expiry, verify restore in a disposable PostgreSQL 18 database, and record retention/access ownership. Confirm an approved internal export method without changing network permissions. **Investigate Now:** choose retention before expiry. A paid extension or provider change is a separate owner decision and is not implemented by this milestone. The database expiry is an operational risk, not justification for rebuilding the application.

See [runtime evidence](RENDER_MULTIWALLET_RUNTIME_EVIDENCE.md), [manual matrix](../demo/MULTIWALLET_MANUAL_ACCEPTANCE.md) and [task ledger](../work/ACTIVE_TASK.md) for current verification boundaries.

## Independent review and verification

A fresh independent agent reviewed the integrated candidate read-only for authorization, custody, source binding, idempotency, persistent history, concurrency, runtime/quotas and cutover. One Act Now code issue was fixed: a legacy Cardano/Solana wallet could select a fresh namespace. Registration and ledger opening/readiness now reject it, and cross-table identity triggers serialize/reject clone insertion. Native PostgreSQL regression passes; legacy histories remain accessible.

No unresolved code blocker was reported. Remaining Act Now activation blockers are verified old-process/credential fencing and a consistent protected internal backup/restore. Investigate Now: current workspace quota/spend settings and actual Render runtime/selected-rail/Playwright acceptance. Ignore / Accept Risk: documented Free sleep/restarts with durable candidate recovery; deferral risks latency/interrupted requests. Public onboarding and richer background orchestration are Park for Later: they are outside scope and do not weaken demo ownership or recovery. See task ledger for final targeted results; no new live purchase is claimed.

## Conditional authorization checkpoint

The owner approved candidate 968807b04952a0c7d881b8f01a681daa8e7cb0de / source fingerprint 05c1ff091c82eec0d9dbabcfedfdcbe44f3bb2b993aa9484ae4f9365a758cb30 with mandatory backup/quota and Sui retirement gates. That exact checkpoint was reverified; further narrow fixes receive an exact replacement SHA/fingerprint from the clean release-plan script. No additional broad implementation cycle is required.

**Gate 1 remains blocked by access.** Authenticated API reports zero Render database exports. The CLI read-only connection is denied by the existing IP allowlist; its official implementation connects via the external connection string, not an internal tunnel. Free services have no shell/SSH/jobs, and the existing gateway has no full-database export endpoint. No current eligible internal export executor has been demonstrated. No backup or restore is claimed. The documented workspace API exposes identity metadata, not quota/billing balances; the browser-control helper failed to initialize, so dashboard quota/spend evidence is unavailable. No workaround deployment or network-permission change was attempted.

To resume, obtain (a) actual workspace remaining hours/build/bandwidth and billing/spend settings, and (b) an owner-approved executable internal export path that preserves database access restrictions. If that path requires a backup-only build replacement or temporary application executor, it requires an explicit narrow exception to the current pre-backup replacement/no-extra-service gates. Do not silently implement that exception. It must remain free, export-only, protected, bounded and incapable of signing or merchant writes. The existing conditional authority for custody/migrations/cutover remains sufficient only after its gates pass.

**Gate 2 implementation passes local checks; existing signer retirement is pending Gate 1.** The ordinary file ledger now rejects every marker, including malformed markers. Only readForImport permits read-only identity/permission validation. Run scripts/sui/retire-history.ts with --manifest PATH for offline signature/hash verification. Permanent retirement additionally requires --retire, CAPSULE_APPROVED_SUI_RETIREMENT=true and CAPSULE_BACKUP_RESTORE_VERIFIED=true after actual backup/restore and quiescence; flags are assertions, not permission. The compiled tool is included in the payer build. Import --apply requires matching protected .retired and .lock fences before opening PostgreSQL.

Retirement never modifies the history file or deletes a lock. It pins owner and exact source SHA256, fsyncs the permanent lock before the marker, and is idempotent for matching complete fences. Interruption after a complete matching lock can resume; an empty/truncated/conflicting lock remains blocked for manual reconciliation, never automatic repair. Do not import or activate after such a failure. Older local binaries were exercised against disposable history from retained Sui ref bae2f623dccc47d7604a48919c969e2229bce340 (ledger source SHA256 3e557f5b31a0748ee351107eae80ccc47fdc8a191813ad565d1aa05f2d1302f9); their signing callback was denied by the permanent lock despite their read ignoring the marker. This proves that retained implementation against the same path, not actual current process/key fencing.

A fresh bounded independent review found no completed-retirement authority/history blocker. Investigate Now: partial fence writes deliberately require manual reconciliation; regression coverage and this blocker rule retain that conservative behavior. The argument-parsing ambiguity noted by review was fixed. This review inspected source only; it did not execute tests or inspect deployments. No new hosted acceptance, history migration or activation has occurred. All nine live rows remain NOT RUN.
