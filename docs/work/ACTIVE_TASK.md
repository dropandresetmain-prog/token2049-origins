# Active task — external acceptance hardening

Prepare Commerce Core for first external acceptance. Local checks only: no provider/payment calls,
Cardano transaction, browser rehearsal, Atlas enablement, main merge or Render deployment.

## Verified integration baseline

- Original Commerce Core: 2b6260b41149d36fafcb98b387dec9cf43faa31f.
- Reviewed PostgreSQL: 45db8d6a2fd486947b9e6b5045493a849309f326; PASS TO INTEGRATE, 406 tests.
- Fetched and verified both remote SHAs; original core is an ancestor; all registered worktrees clean.
- Fast-forwarded build/commerce-core and pushed; remote verified at 45db8d6a2fd486947b9e6b5045493a849309f326.
- Main remains 95a896c730cf893c3afd00919ebe16ad823a608b.
- Branch: build/external-acceptance-hardening.
- Base: 45db8d6a2fd486947b9e6b5045493a849309f326.
- Worktree: C:/Dev/token2049-origins/external-acceptance-hardening.
- Hardening remote: pending checkpoints/push.

## Scope, risks and verification

Canonical secret-free demo JSON and strict loader; exact 1:1000 policy frozen in quote/purchase JSON;
separate commercial principal/fee/total and testnet principal/fee/total. Existing records retain their
stored requirements. No PostgreSQL DDL required.

Targeted fixes: AN-1 Atlas closed gate, IN-4 absolute initialized payer ledger, PG-2 worker logging,
PG-5 fee scaling. Shopify IN-1 and Atlas IN-2/IN-3 stay blockers. Other findings remain out of scope.
Review reports were not found in reviewed worktrees; the owner's accepted verdict/findings are the
current baseline pending report location.

Affected areas: contracts/core/funding binding, evidence, independent payer, Atlas, demo scripts,
packaging/docs. Risks: financial semantics, recalculating old obligations, lost ledger history,
supplier writes behind closed gate. Checks: typecheck/build; scaling/frozen contracts/fee journal;
Cardano/payer/ledger/Atlas/evidence; integration/PostgreSQL concurrency/recovery; full Vitest;
compiled gateway smoke; local readiness; diff check. External evidence remains NOT_RUN.

## Progress

- [x] Verify and integrate PostgreSQL baseline.
- [x] Inspect authoritative docs and affected live code.
- [ ] Demo SSOT and schema.
- [ ] Frozen settlement, fee scaling and regressions.
- [ ] Payer ledger and Atlas gate.
- [ ] Safe worker error logging.
- [ ] Local verification and docs.
- [ ] Exact-file commits and hardening branch push; no merge.

Next action: independent review of build/external-acceptance-hardening before the unfunded Shopify
rehearsal. Do not start that review automatically.
