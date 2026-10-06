# Native Masumi integration into current main

Integration date: 2026-10-07 Singapore. Base: `84c0aef7a7acd1851c590c54ccd8881b9dc365d5`, fetched again before promotion. Branch: `codex/masumi-integration`; the promoted source tip is available with `git rev-parse HEAD`.

## Outcome and scope

The completed native Masumi lane is integrated with current main, preserving Cardano, Solana, GlobalSandbox runtime database wiring, Shopify, Atlas, Nuitée, OCBC, MCP and the runtime WebSocket dependency. Source commits `ce7a565` and `6e627c6` were cherry-picked as `c0d46e2` and `d1717ef`. The two wiring conflicts were resolved additively against current main.

The separate authenticated MIP-003 runtime creates durable owner/task/purchase correlations, discloses and verifies native service fees, returns fresh core outcomes and reconciles ambiguous native writes without blind retries. A task may complete by delivering a truthful failed or stopped purchase outcome; task completion does not assert successful commerce. Only awaiting_funding asks for direct principal; queued/executing report progress, unresolved requests merchant reconciliation, and missed native submission deadlines preserve core truth without starting another native submission or authorizing another payment.

Masumi escrow is service remuneration, never merchant purchase principal. The explicit core Masumi principal adapter remains unavailable. Public Sokosumi listing, platform-to-agent authentication and marketplace-originated task delivery remain **PARTIAL / unverified**.

## Files changed

- `src/integrations/masumi/client.ts`, `src/funding/masumi/index.ts`: bounded native API/chain client, exact independent service-fee proof and disabled principal seam.
- `src/channels/sokosumi/main.ts`, `src/channels/sokosumi/runtime.ts`: authenticated durable task process, immutable fee terms, replay/recovery and truthful deadline-aware core status.
- `src/wiring.ts`, `tests/integration/wiring.test.ts`: additive adapter registration alongside Cardano/Solana; preserved GlobalSandbox runtimeDb wiring.
- `tests/unit/masumi-fee.test.ts`, `tests/integration/sokosumi-runtime.test.ts`, `tests/support/masumi.ts`: native proof boundaries, auth, replay, immutable terms, withdrawal proof and actual core reauthorization/unresolved/queued/late-result flows.
- `scripts/masumi-*.{mjs,ts}`: isolated acceptance and recovery tools. These are not automatic provisioning and must not be blindly rerun.
- `.env.masumi.example`, `.gitignore`, `package.json`: placeholders, private-state exclusions and `channel:masumi` launcher. No dependency added; current main's `ws@8.22.0` retained.
- `docs/evidence/{masumi-live,sokosumi-runtime-live,sokosumi-discovery}.json`, `docs/work/MASUMI_SOKOSUMI_FIX.md`: retained sanitized native acceptance evidence and its limits.
- README, docs index/environment/handoff/issues/roadmap/runbook/test checklist/decisions log, current architecture/demo seed policy, active task and channel contract: current integration state and remaining marketplace boundaries. Historical pre-Masumi acceptance remains separate.

## Checks and results

Run in a fresh isolated integration worktree on Node 24:

| Check | Result |
| --- | --- |
| `npm ci --no-fund` | PASS: 253 packages installed, 254 audited, zero vulnerabilities |
| `node node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism` | PASS: 735/735 tests, 35 files, 66.40 seconds |
| `npm run typecheck` | PASS |
| `npm run build` | PASS, including migration copying and compiled task entry point |
| `git diff --check` | PASS |
| Read-only integration review | PASS; task-state finding fixed and closure confirmed |
| Bounded private-value scan | PASS; no new secret occurrence. Exact unchanged baseline lines with a known public identifier overlap are accepted only as existing baseline matches. |

The initial targeted run passed 39/40 tests; the new reauthorization test incorrectly expected undefined rather than the canonical null receipt. The assertion was corrected to require null. The subsequent complete suite passed without timeout, runtime or production behavior relaxation.

No new provider booking, native payment, registry mint or chain submission occurred during integration. The regression suite uses isolated PostgreSQL schemas and controlled provider fixtures. These checks do not upgrade the previous external acceptance verdicts or establish a final combined external E2E run.

## Retained native acceptance

The original lane independently proved one real Preprod 10000-base-unit (0.01 tUSDM) fee lock, matching native result hash, exact tagged seller payout, ordinary escrow input consumption and identical post-payout runtime restart/replay. Payout fingerprint `a74c8b58140b4d30` had 39 independent confirmations at 2026-10-06 15:57:21 UTC. Merchant and direct principal were explicitly local fixtures outside this lane. Full provenance, immutable deadlines, previous unpaid attempts and vendor accounting behavior remain in [MASUMI_SOKOSUMI_FIX.md](MASUMI_SOKOSUMI_FIX.md).

All existing private configurations, signer budgets, native wallet/database history, original unpaid attempts and recovery checkpoints are retained. No ledger, wallet, database or ambiguous purchase was reset to obtain passing results.

## Remaining issues and next steps

| Classification | Issue / action | Risk of deferring or accepting |
| --- | --- | --- |
| Investigate Now | Prove approved public Sokosumi host/listing metadata and platform-to-agent authentication, then one bounded real marketplace task if required for the demo. | Native success can be mistaken for public marketplace delivery. |
| Investigate Now | Ordinary native withdrawal amount summaries are unreported by current vendor source. Continue exact independent tagged chain proof and reject conflicting nonempty summaries. | Empty native summaries may be mistaken for zero earnings or unrelated wallet movement for payment. |
| Park for Later | Full Some recipient decoding and dispute/refund/WithdrawAuthorized variants; unsupported cases fail closed. | Those variants require operator reconciliation. |
| Ignore / Accept Risk | Original merchant/principal fixture boundaries are retained and labelled. | This lane's acceptance does not prove real merchant fulfillment or direct principal funding. |
| Investigate Now | Deployment and final combined external E2E remain unverified. | Passing local integration does not establish hosted acceptance. |

The prior Act Now task-status finding is resolved by this integration. Keep the immutable principal/service-fee boundary and protected signer history for subsequent work.

Local main promotion is authorized; remote push and deployment are not part of this checkpoint. Recommend a fresh chat for public Sokosumi hosting/authentication or final deployment, using this report and the native acceptance report as the compact handoff. Keep bounded integration follow-ups in this chat.
