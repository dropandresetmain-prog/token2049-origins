# ACTIVE TASK — PostgreSQL persistence migration

## Objective and authority

Replace persistence completely before external acceptance: DATABASE_URL -> PostgreSQL.
Local development and automated integration tests use PostgreSQL.
Hosted runtime uses Render PostgreSQL. SQLite is not supported.

Repository: dropandresetmain-prog/token2049-origins.
Base: build/commerce-core, 2b6260b41149d36fafcb98b387dec9cf43faa31f.
Fetch before edits confirmed the remote/base SHA unchanged and a clean starting worktree.
Branch: build/postgres-persistence.
Isolated worktree: C:/Dev/token2049-origins/postgres-persistence.
The active commerce-core worktree was not edited. No merge or gateway deployment is authorized here.

Read before phases: RUNBOOK, TEST_CHECKLIST, KNOWN_ISSUES, local-verification,
IMPLEMENTATION_PLAN and CORE_CONTRACT. Original planning persistence choices are historical;
financial/domain contracts and provider restrictions remain unchanged.

## Before-edit migration note and inventory

The pre-migration schema had 16 domain tables plus schema_meta: customers, api_clients, offers,
quotes, purchases, idempotency_keys, funding_evidence, capacity_pools, reservations, jobs,
funding_attempts, execution_attempts, journal_entries, journal_lines, purchase_events, bank_observations.
Preserve primary keys, foreign keys, ownership, indexes and unique guards: token hashes, quote digests,
one purchase per quote, one reservation/funding candidate per purchase, customer/operation/key,
rail/network/transfer proof, execution key/attempt number, job dedupe, journal event and event sequence.
Amounts remain integer text + BigInt; domain timestamps/serialized JSON remain text to preserve values.
PostgreSQL identity replaces the historical line autoincrement; version tracking moves to schema_migrations.

Preserved transaction boundaries: purchase/reservation/idempotency/events, prepared funding and recovery
job, verified evidence/journal/queue, execution markers/results, reconciliation, expiry, clients and bank
observation batches. Original synchronous writer serialization becomes connection-bound async transactions
with savepoints and a short core-write advisory lock. External provider calls stay outside transactions.
Claims use FOR UPDATE SKIP LOCKED. Startup/tick repair only expired leases; owner/attempt fences prevent
stale completion/rescheduling. Per-purchase worker/funding session locks reuse a pooled connection.
Persisted started attempts always recover through readback, never repeat execution.

This inspection note was first recorded before implementation in checkpoint e54a1da.

## Completed phases

- [x] Base/cleanliness/instructions and persistence/recovery inspection.
- [x] Official Postgres 18 Compose service, loopback binding, healthcheck, persistent local volume.
- [x] pg 8.23.1 and types pinned; no persistence framework or second backend.
- [x] Ordered transactional migrations with version/checksum validation and migration advisory lock.
- [x] Async PostgreSQL callers across core/auth/HTTP/evidence/composition/client CLI.
- [x] Safe competing job claims, live lease preservation, stale claim fences, funding exclusion.
- [x] Random schema per test fixture; explicit reuse for restart, owned cleanup, no global truncate.
- [x] Complete suite: 406/406 tests in 22 files; original 396 behaviors preserved.
- [x] Compiled gateway health/auth and two-process restart persistence probe.
- [x] SQLite runtime/config/schema/tests/volume references removed; historical planning labelled.
- [x] One free Render PostgreSQL database provisioned/migrated/SQL-smoked, no gateway deployed.
- [x] Relevant run/deploy docs and prepared Render template updated.

## Migrations and verification

1. src/migrations/0001_initial.sql — all domain tables/constraints/indexes and immutable journal triggers.
2. src/migrations/0002_journal_truncate_guard.sql — PostgreSQL statement triggers prohibit journal truncation.
The already-applied first file was preserved when adding the second migration.

PASS: clean local DB startup; empty-schema migrations; migration rerun/concurrent startup/checksum failure;
typecheck; production build; full suite; focused restart/concurrency/idempotency; integer-safe journal;
compiled gateway health/capabilities/inspect/auth and restart; Docker build stage; Render Blueprint validation;
Render verified-TLS SQL/migrations/isolated write-read; git diff --check.
No external commerce/provider calls, Cardano payments, wallet changes, or live acceptance were performed.
See docs/evidence/local-verification.md for evidence, changed-file manifest and limits.

## Render status and cost

Name: token2049-origins-db. ID: dpg-db29mujncjis73dtvf70-a.
Region: singapore. PostgreSQL: 18.6. Plan: free ($0), 1 GB, no managed backups.
Expires: 5 November 2026, 14:55 Singapore time. Any paid upgrade needs explicit authorization.
External verification used a temporary single-host rule, then restored 127.0.0.1/32 (no reachable client).
Same-region Render services can use the internal URL. Credentials existed only in process memory;
no connection URL/password was printed or saved in Git/local files. No gateway environment exists yet.
The prepared render.yaml requires the private URL in a future Render service secret environment.
Existing Tencent resources were inspected only; none was changed.

## Findings, limits and handoff

Act Now — resolved: startup stole live leases, stale jobs lacked ownership fences, concurrent proof
confirmation needed a transactional pending-state recheck, and native TRUNCATE bypassed row immutability.
Evidence/recommendations/deferral risks are in KNOWN_ISSUES. Short serialized writes remain a throughput
limit accepted for one-worker launch; this is not a distributed-worker or HA deployment.

No historical database-file import was performed. The new backend initializes PostgreSQL and preserves
its state across restart; it does not read an old persistence file. The final gateway runtime image/live
Chromium checkout was not revalidated here; build stage and compiled host gateway are verified.

Merge risks: core persistence APIs now return Promises. Coordinate service/worker/HTTP/evidence changes
with the separate Atlas/payer patch lane; do not overwrite its policy fixes. No provider adapter, payer
policy, MCP/payment authority or business/payment semantics were changed in this lane.
All external purchasing acceptance remains BLOCKED_EXTERNAL as recorded in the commerce runbook.

Next task: review and merge this branch through the owner; do not start another task automatically.
Use a fresh chat for merge/external acceptance because this migration context is long.
Read current ledger/evidence first, confirm current target HEAD and preserve excluded policy lanes.
