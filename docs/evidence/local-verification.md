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
