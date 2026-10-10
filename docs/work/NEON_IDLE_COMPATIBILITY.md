# Neon idle compatibility checkpoint

This branch derives from deployed 7c09b37eaaeda2bf3eec94fc1e3456118962f636 and contains only the owner-authorized minimum database compatibility adjustment. It does not integrate consolidated wallets or Sui, alter provider contracts, change signing authority or migrate application schema.

Empty queues sleep up to30minutes; durable purchase/reservation and job inserts wake locally after successful outer commit. Nested rollback notifications are discarded; timer callbacks do not inherit a held PostgreSQL session. Delayed jobs, claimed leases and reservation expiry schedule earlier wakeups. Startup recovers durable obligations; existing attempts use existing readback rules. No new runtime/scheduler/queue or keepalive.

Deploy only after the existing known-good DATABASE_URL-only cutover passes, with the same Neon direct verify-full connection and existing provider/payer/OAuth configuration. Verify effective WORKER_INTERVAL_MS is absent(default1800000) or >=1800000. Both old payer services remain7c09b37 until the separate consolidated-release gates pass. If the compatibility deployment fails, suspend gateway and roll forward on the same canonical Neon history; never silently resume source or keep rapid polling running indefinitely.

Parent migration record: docs/architecture/NEON_DATABASE_MIGRATION.md on codex/capsule-neon-migration. Known-good migrations0001-0009 must remain immutable. No live purchase, chain broadcast or merchant write is authorized in compatibility verification.
