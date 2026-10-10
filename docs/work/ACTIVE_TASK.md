# Capsule consolidated multi-wallet payer
Updated: 10 October 2026 (Singapore). Re-read before major phases and completion.

## Objective and corrected architecture
- Keep Render gateway, hosted /mcp OAuth, console, provider/browser implementations.
- Keep Render PostgreSQL 18 token2049-origins-db authoritative; no network exposure changes.
- One Render Free payer: Cardano Preprod, Solana Devnet, Sui Testnet modules.
- Authenticated customer -> logical payer profile -> multiple registered wallet sources.
- Preserve deployed demo. Owner correction supersedes Neon/Cloudflare and no-sleep requirement.

## Source
- Remote: https://github.com/dropandresetmain-prog/token2049-origins.git
- Branch: codex/capsule-on-demand-multiwallet
- Worktree: C:/Dev/token2049-origins-on-demand
- Base: 7c09b37eaaeda2bf3eec94fc1e3456118962f636 (fetched origin/main).
- Implementation checkpoint: final candidate SHA resolved by clean release-plan script after exact-file commit.
- Sui: bae2f623dccc47d7604a48919c969e2229bce340 merged as d7cd82c after overlap review.
- Prior ledger preserved: PUBLIC_JUDGE_CHECKPOINT.md.
- Shared checkout codex/console-source-store and its uncommitted work untouched.
- No cloud migrations/resources or secret relocation attempted; Neon lookup abandoned read-only.

## Fixed constraints
- One payer runtime, multiple profiles/wallets; no service per chain or wallet.
- No keys in gateway or caller-selected identity/URL; purchase-id-only payer API.
- Listing/quoting reads registrations/configuration; only selected source performs live checks.
- Approval binds customer, exact quote, funding option and source; never fallback.
- Preserve signed candidates, reservations, independent caps, sponsor roles, unknown outcomes.
- Additive migrations only; 0001-0010 unchanged. No history resets/reassignment.
- No new infrastructure provider, workflow platform, keepalive or wake orchestration.
- Sandbox/testnets/notional scale and independent payment+merchant confirmation remain explicit.

## Authorization
- Code, fixture signing, disposable local DB tests, exact-file commits and branch pushes permitted.
- Read-only existing account/deployment metadata/public state permitted; no secrets printed.
- Owner approval: provider writes, broadcast, key relocation, canonical DB mutation,
  signing authority/fencing, main/deployed replacement, paid plan/provider change.
- Old services retain authority until approved cutover; same wallet must never have two active signers.
- Owner performs nine live tests after hosted readiness; no live purchases authorized.

## Phases and outcomes
- [x] Verify refs/remote/worktree; reconcile correction; preserve previous ledger.
- [x] Inspect core/MCP/OAuth/config/provider execution and legacy ledgers/historical Sui evidence.
- [x] Verify read-only Render service plans and PostgreSQL18 expiry/network metadata.
- [x] Review/integrate Sui feature lane and async persistent-ledger port.
- [x] Implement ownership, source snapshot, exact approval and selected-source MCP/core/proof.
- [x] Implement single default-disabled lazy dispatcher and preserved legacy ledger namespaces.
- [x] Finish immutable financial policy/import/recovery tooling and native PostgreSQL tests.
- [x] Integrated regression gate/build and fresh independent review; fix blockers.
- [x] Inspectable cutover manifest/runbook, owning docs, backup recommendation, manual sheet.
- [x] Prepare verified exact-file checkpoint and consolidated owner authorization packet; final push verified below.

## Current checkpoint and next action
- Integrated gate: 55 files / 732 tests; 729 passed, three changed expectations fixed.
- Affected rerun: 8 files / 150 passed (contracts, MCP, Sui payer, hosted config/OAuth).
- Selected-payer wrong-source checks: 3 files / 126 passed, no broadcast/settlement.
- Policy/import/native PG focused gate passed; namespace review fix: 4 files / 28 passed.
- Console tests: 9 files / 89 passed; root and console typechecks passed.
- Final gateway/console build and root/console typechecks passed.
- Actual Node24 Linux production payer image: disposable 3-rail signing/serialization PASS8checks.
- Network disabled, read-only filesystem, 512MiB/0.1CPU; peak RSS137.2MiB, Node24.21.0.
- Independent reviewer found legacy wallet history bypass via fresh namespace; fixed runtime/DB guards.
- Independent review complete: namespace bypass fixed, no unresolved code blocker; owner boundaries retained.
- Read-only Cardano status: 5 accepted, 94,820 committed, headroom5,005,180; import4/66,830.
- Sui existing file: 2 signed, amount35,900/gas20,000,000; both signatures verified read-only.
- Protected Sui sha256: 3db74885426ee2e7e42226d3a4ebb64b0ab8834babc09ea35049fdcfee7817f0.
- Solana current remote ledger summary not checked: approved local bridge token unavailable.
- Final affected gate: multiwallet13 + registration2 + hostedpayer20 =35 passed; walletledger5 passed.
- HTTP startup has no keys and denies pay/sign; stalled wallet does not block another selected rail.
- Operator selected-source preflight initializes without pay/sign/balance claims; legacy open is read-only.
- Next resume: reread this ledger and explicit approval; reverify drift/quota/backup, execute only approved cutover actions, then hosted non-spending checks.
- Disposable Docker PG18: capsule-consolidated-payer-tests, loopback55436, UUID test schemas only.
- Tests never use deployed DB or existing wallet keys. Detailed tool logs kept outside Git.

## Release state
- READY_FOR_OWNER_AUTHORIZATION; candidate local, not hosted payment-test ready.
- Implementation commit: 454bf66309694580a42cb332e97461191cf08b7a, pushed and verified.
- Final release SHA/fingerprint: run scripts/multiwallet/release-plan.mjs on clean branch (includes this evidence checkpoint).
- Production Docker artifact: sha256:0b80b5028f6efb06236ddb5e734cea308d8d925a1828ac4ce596db8ebf1d3b04.
- Implementation push verified against remote SHA; main remains7c09b37. Final evidence checkpoint pushed and matched before handoff.
- Exact resource/secret names/actions: deploy/consolidated-payer-release.json.
- Cutover/rollback/independent review: docs/architecture/CONSOLIDATED_PAYER.md.
- Act Now: old authority fencing, approved consistent private backup/restore before expiry.
- Investigate Now: actual quota/spend settings, Render candidate runtime and hosted readiness.
- Park for Later: public onboarding, richer background orchestration.
- Ignore / Accept Risk: Free sleep/restarts with durable recovery; expected latency.

## Evidence boundaries / blockers
- Actual DB expiry: 2026-11-05T06:55:54.699333Z = 5 Nov 14:55:54 Singapore.
- Render Free PG18: available, Singapore, no HA/replica/pool, external access disabled.
- Free DB has no managed backups per official docs; owner-managed export remains unverified.
- Existing gateway/Cardano/Solana Render services Free; no deployment changes.
- Workspace remaining hours/build/bandwidth/spend setting unverified; shared750h/month documented.
- Real candidate Render initialization/memory pending approved non-spending deployment.
- Keys/history untouched; Sui pinned import and signing activation require owner approval.
- Historical Sui/live evidence does not prove candidate hosted acceptance.
- Manual nine-row live matrix NOT RUN. No provider preflight writes/broadcasts.

## Evidence links
- docs/work/PUBLIC_JUDGE_CHECKPOINT.md: preserved prior release checkpoint.
- docs/work/SUI_FUNDING.md and docs/demo/: retained Sui historical evidence.
- docs/architecture/RENDER_MULTIWALLET_RUNTIME_EVIDENCE.md: official runtime/account limits.
- docs/demo/MULTIWALLET_MANUAL_ACCEPTANCE.md: owner manual matrix (all NOT RUN).
- tests/integration/multiwallet.test.ts: canonical native-PG/MCP fixture matrix and ownership.
