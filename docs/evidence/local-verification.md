# External acceptance hardening — local verification, 2026-10-06

Branch: build/external-acceptance-hardening. Base: 45db8d6a2fd486947b9e6b5045493a849309f326.
Worktree: C:/Dev/token2049-origins/external-acceptance-hardening. Final SHA: git rev-parse HEAD;
remote must match before delivery. Original core 2b6260b41149d36fafcb98b387dec9cf43faa31f was verified
as ancestor, then Commerce Core fast-forwarded/pushed and remote verified at 45db8d6. All worktrees
were clean before editing. Main remains 95a896c730cf893c3afd00919ebe16ad823a608b; no main merge,
Render operation, deployment or merge of hardening into Commerce Core.

Accepted review baseline: original owner-supplied findings and the PostgreSQL review/reconciliation
pasted in Hackathon Build Recommendation, conversation 6ac3a6cd-5400-83ec-8547-957895148604,
message a1ba86e2-463f-4ae5-b514-6900bc3f2565. Review target 45db8d6, PASS TO INTEGRATE. The report
reconfirms AN-1/IN-4, PG-2/PG-5 and unchanged Shopify IN-1/Atlas IN-2/IN-3. The original full core
review was absent in the worktrees; its accepted reconciled findings were used. This is implementation
verification, not a new independent review.

Environment: Windows ARM64, PowerShell, Node 24.15.0. Local loopback PostgreSQL **18.6** using the
existing healthy postgres:18 Compose container. Tests use isolated random schemas and real SQL.
No .env/provider secrets were loaded. No new package dependency or migration.
The npm PowerShell wrapper referenced a missing npm-cli; commands used the installed Node/npm CLI
or pinned local binaries. Installation used node plus C:/Program Files/nodejs/node_modules/npm/bin/npm-cli.js
ci --ignore-scripts (183 packages). No dependency versions/lockfile were changed.

| Check / exact command | Result | Evidence and limits |
|---|---|---|
| node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit | PASS | Strict source/scripts/clients/tests. |
| node node_modules/typescript/bin/tsc -p tsconfig.build.json; node scripts/copy-migrations.mjs | PASS | Production output includes dist/demo/demo-data.json and unchanged SQL migrations. |
| node node_modules/vitest/vitest.mjs run tests/unit/settlement.test.ts tests/integration/scaled-settlement.test.ts tests/unit/cardano-payer.test.ts tests/unit/cardano-adapter.test.ts tests/unit/atlas-executor.test.ts | PASS | Initial focused financial/payer/gate set: 169/169. Final additional closed-gate readback regression also passes. |
| node node_modules/vitest/vitest.mjs run tests/unit/atlas-executor.test.ts tests/unit/cardano-payer.test.ts tests/integration/scaled-settlement.test.ts | PASS | Final focused set 101/101; preserves readback after gate closes. |
| node node_modules/vitest/vitest.mjs run | PASS | **440/440 tests in 24 files**, zero failures/skips; final run at 16:10:58 SGT, duration 9.88s. |
| Quote/funding/channel contracts and evidence | PASS | Included in full suite; signed wrong scale/amount/asset/payee/network/decimals refuse; commercial and chain amounts visible together. |
| Journal, Cardano adapter/binding/SDK/payer/ledger | PASS | Included in full suite; fee allocation and trial balance per asset; missing history refuses before signing/gateway access. |
| Integration, PostgreSQL concurrency/idempotency and funding recovery | PASS | All tests/integration included; real separate connections, locks/fences, restart/replay/recovery retained. |
| DATABASE_URL=local loopback; node dist/scripts/db-smoke.js | PASS | PostgreSQL 18.6 authenticated; isolated write/read, pool restart/migration rerun; two compiled gateway processes verify health/auth/persistence. Probe schema removed. |
| DATABASE_URL=local loopback; node dist/scripts/readiness.js | PASS | Exit 0, all five adapters MISSING_CONFIG; Atlas payment gate disabled. No provider calls. |
| DATABASE_URL=local loopback; node dist/scripts/readiness.js --strict | EXPECTED FAIL | Exit 1 with missing provider configuration; this is fail-closed readiness, not external PASS. |
| docker build --target build -t t2o-hardening-build:verification . | PASS | Linux ARM64 build packaging includes demo JSON; final Chromium runtime image not tested. |
| git diff --check | PASS | Two trailing blank lines corrected; final check clean. Exact-file staging; no secret/env/wallet artifacts staged. |

## Explicit regression evidence

- USD 1.00 -> 1000 base units -> 0.001000 test stablecoin.
- USD 10.00 -> 10000 base units -> 0.010000 test stablecoin.
- USD 183.40 -> 183400 base units -> 0.183400 test stablecoin.
- USD 123.47 -> 123470; zero -> zero; USD 500.00 -> 500000. Unsupported currency/precision refuse.
- Actual configured commercial boundary tested at USD 183.40: exact boundary purchases; one cent over refuses.
- Quote at 1/1000, edit the current loaded demo SSOT to full_notional, create purchase and restart against
  changed config: fundingRequirement still has original scale/183400. Funding/receipt/evidence and journal
  retain both USD 183.40 simulated capacity and 183400 observed fixture token units in distinct assets.
- USD 100 principal + USD 1 service fee -> 100000 + 1000 = 101000. Later fee/policy config edits do not
  change posting. Testnet fee/principal allocations are frozen; no negative principal.
- Wrong signed scale, amount, asset, payee, network and decimals fail before facilitator submission;
  signature commitment changes for every modified economic/binding field.
- Atlas OFF: search allowed, executable quote refused; no hold/order/pay/passenger write. An older stored
  flight quote cannot create a new customer funding requirement. ON behavior stays tested; readback of
  earlier paid attempts remains available when the gate closes. IN-2/IN-3 were not fixed.
- Required absolute existing protected payer ledger accepted; missing variable, relative/malformed path,
  missing initialized history and corrupt history refuse. First-time setup initializes exclusively;
  existing wallet with missing ledger demands operator reconciliation. Setup tests create temporary
  offline mnemonic/ledger files and remove them; no wallet was funded or used for a network transaction.
- Worker DB failure log retains only stage/jobId/whitelisted machine code, with no error body/SQL secrets.

## External status and risks

All external evidence remains **NOT_RUN**: Cardano transfer, Shopify checkout/rehearsal, Atlas calls,
Nuitée booking, OCBC calls and deployment. Readiness uses credential-free composition only.

AN-1, IN-4, PG-2 and PG-5: PASS locally. Shopify IN-1 and Atlas IN-2/IN-3 remain Investigate Now blockers.
PG-1 and other parked review findings remain deferred. Legacy unstructured/full-notional obligations
are preserved but refused by the new demo payer (Ignore / Accept Risk; requote for new demos, retain
old recovery). Windows ACL enforcement remains an operator responsibility (Ignore / Accept Risk).
Full runtime/live selector validation remains Investigate Now; do not infer it from host/build tests.
No unresolved new Act Now finding was identified during implementation checks.

Next action, in a fresh chat: independent review of this branch before the unfunded Shopify rehearsal.
Do not automatically review, merge, rehearse or deploy.

## Changed-file manifest (42 files)

```text
.env.payer.example
Dockerfile
README.md
clients/payer/config.ts
clients/payer/ledger.ts
clients/payer/payer.ts
clients/payer/wallet-generate.ts
demo/demo-data.json
docs/KNOWN_ISSUES.md
docs/RUNBOOK.md
docs/TEST_CHECKLIST.md
docs/contracts/CHANNEL_CONTRACT.md
docs/decisions/scaled-testnet-settlement.md
docs/evidence/cardano-protocol.md
docs/evidence/local-verification.md
docs/work/ACTIVE_TASK.md
scripts/atlas-check.ts
scripts/nuitee-check.ts
src/composition.ts
src/contracts/commerce.ts
src/contracts/index.ts
src/contracts/ports.ts
src/contracts/settlement.ts
src/core/journal.ts
src/core/service.ts
src/core/store.ts
src/core/views.ts
src/core/worker.ts
src/demo/config.ts
src/evidence/read-model.ts
src/execution/atlas/executor.ts
src/funding/cardano/adapter.ts
src/funding/cardano/binding.ts
tests/integration/scaled-settlement.test.ts
tests/support/fixtures.ts
tests/support/harness.ts
tests/unit/atlas-executor.test.ts
tests/unit/cardano-adapter.test.ts
tests/unit/cardano-payer.test.ts
tests/unit/settlement.test.ts
tests/unit/shopify-browser.test.ts
tests/unit/shopify.test.ts
```

---

The prior PostgreSQL migration record below is retained as historical evidence. Its remote resource
operations were performed in that earlier lane, not this hardening lane.

# PostgreSQL local and Render verification — 2026-10-06

- Branch: build/postgres-persistence; base 2b6260b41149d36fafcb98b387dec9cf43faa31f.
- Environment: Windows ARM64, PowerShell, Node 24.15.0; Docker Desktop 29.6.2, Linux ARM64.
- Local PostgreSQL: official postgres:18 image, 18.6 (Debian 18.6-1.pgdg13+2).
- Render PostgreSQL: 18.6 (Debian 18.6-1.pgdg12+2), singapore.
- Dependencies added: pg 8.23.1, @types/pg 8.23.1; npm install audit reported zero vulnerabilities.
- Local development and automated integration tests use PostgreSQL. Hosted runtime uses Render PostgreSQL. SQLite is not supported.
- External adapters use offline fixtures/transports only. No commerce/provider requests or payments occurred.

| Command/check | Result | Evidence and limits |
|---|---|---|
| docker compose up -d --wait | PASS | Newly created project volume/network and official image; healthy, 127.0.0.1:55432 only. |
| npm run db:migrate | PASS | Empty local public schema; ordered 0001 then additive 0002. Each random test schema also migrates from empty. |
| Migration rerun/concurrent initialization | PASS | One history row per file, persisted customers survive, changed checksum fails without resetting data. |
| npm run typecheck | PASS | Strict source/scripts/tests compile. |
| npm run build | PASS | Production TypeScript build; ordered SQL copied into dist/src/migrations. |
| npm test | PASS | **406 tests in 22 files**; final suite, zero failed/skipped. Original 396 behaviors retained; 10 PostgreSQL-specific tests added. |
| PostgreSQL concurrency | PASS | Independent pools/gateways: identical buys, quote uniqueness, bounded capacity, locked-row skipping, live leases, expired/stale claims, competing funding exclusion, journal event dedupe and pool exhaustion regression. |
| Transaction rollback and money | PASS | Nested savepoint failure leaves outer transaction usable; concurrent contexts remain separate. Amount 900719925474099312345678901234567890 retains exact text/BigInt value. Update/delete/TRUNCATE journal mutations are rejected. |
| Restart and recovery | PASS | Funding response loss/restart, frozen origin, submitted/late funds, replay, unknown outcomes and provider attempt readback; severed fixture pool sessions release locks and cannot persist a late result. No repeated provider execution. |
| node dist/scripts/db-smoke.js | PASS | Real PostgreSQL, isolated application customer row, close/reopen and migration rerun; compiled gateway started/killed/restarted twice on loopback. Health/capabilities/inspect 200, anonymous evidence 401, persisted scoped client authenticates 200 after restart. |
| docker build --target build -t t2o-postgres-build:verification . | PASS | Linux ARM64 build stage validates Docker dependency install, production compile and migration packaging. Final Chromium runtime image is NOT_RUN in this lane. |
| render blueprints validate ./render.yaml -o json | PASS | valid=true; validation only. Blueprint not synced and gateway not deployed. |
| Render SQL verification | PASS | Certificate-verified TLS connection, application migrations, isolated non-sensitive customer write/read, pool restart and idempotent migration rerun. Probe schema removed. |
| git diff --check | PASS | Source/example/docs whitespace validated; exact-path staging. No production connection strings or secrets staged. |

Tests never truncate shared state: tests/support/database.ts assigns a cryptographically random schema
per fixture, tracks owned pools/schemas for cleanup, and permits explicit reuse only for restart/concurrency.
Concurrent files use separate schemas. PostgreSQL is real; missing/unavailable local Postgres fails tests.
The crash helper terminates only server sessions bearing its registered pool's unique application_name.

## Render resource and secret handling

- Name: token2049-origins-db; ID: dpg-db29mujncjis73dtvf70-a.
- Region: singapore; major 18; plan free, $0, 1 GB.
- Expiry: 5 November 2026 at 14:55 Singapore time; no managed backups. No paid plan/autoscaling selected.
- Temporary external allow rule was this machine's exact public IP. Final rule: 127.0.0.1/32,
  description external-access-disabled. This allows no reachable external client; same-region internal
  access remains available. CLI metadata verified the final rule.
- Credentials were obtained through the authenticated official Render CLI, captured in memory only,
  and used with sslmode=verify-full. No password/full connection URL was printed or saved.
- The future gateway secret environment must receive the internal URL. No gateway was deployed and
  no existing Tencent/project resource was modified. render.yaml leaves DATABASE_URL unset (sync:false).

Official references: [Render database creation/connections](https://render.com/docs/postgresql-creating-connecting),
[free limits](https://render.com/docs/free), [Blueprint specification](https://render.com/docs/blueprint-spec).

## Scope and remaining history

The application has one contract: DATABASE_URL -> PostgreSQL. No driver/config/schema fallback remains.
SQLite/DATABASE_PATH mentions in the pinned IMPLEMENTATION_PLAN and SETUP_AND_EVIDENCE are explicitly
labelled historical; architecture statements here/README/RUNBOOK only state that SQLite is unsupported.
The old single-writer accepted risk is removed. Pre-migration container proof is marked historical.
No old database-file conversion/import was performed. Existing PostgreSQL records and invariants persist;
provider/payer/Atlas policy fixes remain the separate lane's responsibility.

Historical baseline evidence: build/commerce-core at this base reported 396/396 tests against its prior
persistence backend. That is history; the PostgreSQL results above supersede its database/runtime evidence.
The final gateway runtime image, live provider acceptance, and public deployment remain NOT_RUN here.

## Changed files

The final exact manifest is appended below. Git history is split into local environment, persistence,
PostgreSQL verification, and operational documentation checkpoints. Use git rev-parse HEAD for the
final branch SHA; no merge to build/commerce-core or main was performed.

```text
.dockerignore
.env.example
.gitignore
Dockerfile
README.md
compose.yaml
docs/HANDOFF.md
docs/KNOWN_ISSUES.md
docs/RUNBOOK.md
docs/TEST_CHECKLIST.md
docs/evidence/container-verification.md
docs/evidence/local-verification.md
docs/planning/IMPLEMENTATION_PLAN.md
docs/planning/SETUP_AND_EVIDENCE.md
docs/work/ACTIVE_TASK.md
package-lock.json
package.json
render.yaml
scripts/copy-migrations.mjs
scripts/create-client.ts
scripts/db-smoke.ts
scripts/migrate.ts
scripts/readiness.ts
src/channels/http/app.ts
src/composition.ts
src/core/capacity.ts
src/core/journal.ts
src/core/service.ts
src/core/store.ts
src/core/views.ts
src/core/worker.ts
src/evidence/read-model.ts
src/evidence/router.ts
src/infrastructure/auth.ts
src/infrastructure/config.ts
src/infrastructure/db.ts
src/infrastructure/migrations.ts
src/main.ts
src/migrations/0001_initial.sql
src/migrations/0002_journal_truncate_guard.sql
src/wiring.ts
tests/contracts/channel-equivalence.test.ts
tests/integration/funding-recovery.test.ts
tests/integration/postgres.test.ts
tests/integration/safety-regressions.test.ts
tests/integration/spine.test.ts
tests/integration/wiring.test.ts
tests/support/database.ts
tests/support/harness.ts
tests/unit/evidence-router.test.ts
tests/unit/mcp-static.test.ts
tests/unit/mcp.test.ts
tests/unit/money-journal.test.ts
```
