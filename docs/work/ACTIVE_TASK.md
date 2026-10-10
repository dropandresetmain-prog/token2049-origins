# Capsule consolidated multi-wallet payer

Updated: 10 October 2026 (Singapore). Re-read before major phases and completion.

## Objective and corrected architecture
- Keep Render gateway, hosted /mcp OAuth, console, provider/browser implementations.
- Keep Render PostgreSQL 18 token2049-origins-db authoritative; no network exposure changes.
- Consolidate Cardano Preprod, Solana Devnet and Sui Testnet into one Render Free payer.
- Authenticated customer -> logical payer profile -> multiple registered wallet sources.
- Preserve known-good deployed demo; do not promote main or replace endpoints.
- Superseding owner correction removes Neon/Cloudflare migration and no-sleep requirement.

## Source
- Remote: https://github.com/dropandresetmain-prog/token2049-origins.git
- Branch: codex/capsule-on-demand-multiwallet
- Worktree: C:/Dev/token2049-origins-on-demand
- Base/initial HEAD: 7c09b37eaaeda2bf3eec94fc1e3456118962f636 (fetched origin/main).
- Sui ref: origin/feat/sui-purchase-funding @ bae2f623dccc47d7604a48919c969e2229bce340.
- Sui merge base equals base; three commits ahead. Overlap review pending.
- Previous tracked ledger preserved: PUBLIC_JUDGE_CHECKPOINT.md.
- Shared checkout codex/console-source-store and its uncommitted work untouched.
- No cloud resource, migration code or secret relocation from original architecture started.
- Abandoned read-only Neon lookup required reauthentication; no mutation occurred.

## Fixed constraints
- One payer runtime, multiple users/wallets; no new service per chain or wallet.
- No key in gateway, arbitrary signing API, caller-selected customer or payer URL.
- Wallet list reads registrations; only selected source performs live readiness.
- Approval binds customer, quote digest, funding option and source; never fallback.
- Preserve signed candidates, reservations, caps, sponsor roles and unknown outcomes.
- Additive migrations only; applied historical migrations immutable.
- No resets, replacement wallets, generic orchestration or new infrastructure provider.
- Sandbox merchants/testnets/notional scale and independent confirmation remain explicit.

## Authorized work and gates
- Inspect, code, fixtures, disposable local DB tests, exact-file commits and branch pushes.
- Read-only existing deployment/account metadata and public state; never print secrets.
- Owner approval required: provider writes, broadcast, key relocation, canonical DB mutation,
  signing authority/fencing changes, main/deployed release replacement or paid resource.
- Old services remain authoritative until approved cutover; no simultaneous old/new signer.
- Owner performs nine live E2Es after hosted readiness; none authorized here.

## Required outcomes / phases
- [x] Fetch/verify main, Sui ref, remote and isolated branch.
- [x] Reconcile corrected scope and preserve previous ledger.
- [ ] Inspect gateway/MCP/auth, payer ledgers, provider contracts and hosted evidence.
- [ ] Verify Render Free runtime/account metadata and DB expiry/backup read-only.
- [ ] Integrate reviewed Sui lane; retain historical evidence/protocol restrictions.
- [ ] Freeze ownership/source/approval contracts and additive DB design.
- [ ] Implement consolidated selected-source dispatch and persistent Sui history/import.
- [ ] Integrate existing MCP/core/console with explicit wallet selection.
- [ ] Focused fixtures, concurrency/recovery/native PostgreSQL verification.
- [ ] One integrated regression gate and fresh independent review; fix blockers.
- [ ] Inspectable default-deny cutover manifest, retention advice and manual nine-row sheet.
- [ ] Commit/push verified candidate; consolidated owner authorization packet.

## Checkpoint and next action
- No application code changes yet. Isolated worktree clean before ledger preservation.
- Next: inspect existing contracts/ledgers and read-only Render CLI access.
- Ledger/current detailed record will link evidence as it is collected.

## Blockers and evidence boundaries
- Recorded DB expiry 5 Nov 2026 14:55 Singapore; actual metadata/backup not verified yet.
- Real Render Free candidate initialization/memory acceptance pending; local tests cannot prove it.
- Existing protected wallets/history not copied; hosted signing/import require approval.
- Existing historical evidence is not new candidate hosted/live acceptance.
- No live purchases/provider preflight writes performed.

## Evidence
- docs/work/PUBLIC_JUDGE_CHECKPOINT.md: prior tracked release history.
- docs/ENVIRONMENT.md: recorded runtime/DB facts (to verify).
- docs/work/SUI_FUNDING.md on Sui lane: integration review pending.
