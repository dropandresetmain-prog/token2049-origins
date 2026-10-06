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
- Remote publication: build/external-acceptance-hardening; delivery requires origin SHA == git rev-parse HEAD.
  The final completion report records the verified SHA (avoids a self-referential commit hash).

## Scope, risks and verification

Canonical secret-free demo JSON and strict loader; exact 1:1000 policy frozen in quote/purchase JSON;
separate commercial principal/fee/total and testnet principal/fee/total. Existing records retain their
stored requirements. No PostgreSQL DDL required.

Targeted fixes: AN-1 Atlas closed gate, IN-4 absolute initialized payer ledger, PG-2 worker logging,
PG-5 fee scaling. Shopify IN-1 and Atlas IN-2/IN-3 stay blockers. Other findings remain out of scope.
Accepted baseline: owner-supplied original review findings plus the PostgreSQL review/reconciliation
pasted in the planning chat, Hackathon Build Recommendation (6ac3a6cd-5400-83ec-8547-957895148604,
message a1ba86e2-463f-4ae5-b514-6900bc3f2565). The original full core report was not present in the
reviewed worktrees; its reconciled findings remain authoritative. No new review was started.

Affected areas: contracts/core/funding binding, evidence, independent payer, Atlas, demo scripts,
packaging/docs. Risks: financial semantics, recalculating old obligations, lost ledger history,
supplier writes behind closed gate. Checks: typecheck/build; scaling/frozen contracts/fee journal;
Cardano/payer/ledger/Atlas/evidence; integration/PostgreSQL concurrency/recovery; full Vitest;
compiled gateway smoke; local readiness; diff check. External evidence remains NOT_RUN.

## Progress

- [x] Verify and integrate PostgreSQL baseline.
- [x] Inspect authoritative docs and affected live code.
- [x] Demo SSOT and schema.
- [x] Frozen settlement, fee scaling and regressions.
- [x] Payer ledger and Atlas gate.
- [x] Safe worker error logging.
- [x] Local verification and docs: 440/440 tests in 24 files, typecheck/build, compiled smoke, readiness and diff check.
- [x] Exact-file checkpoint commits; hardening-only push and remote comparison are the delivery guard. No merge.

Next action: independent review of build/external-acceptance-hardening before the unfunded Shopify
rehearsal. Do not start that review automatically.

## Verified results and review handoff

No new migrations/dependencies. Financial behavior remains review-gated on this branch; do not merge
it into Commerce Core yet. Commerce Core remote stays at 45db8d6; main stays at 95a896c. No Render
resource was read or changed in this lane. AN-1, IN-4, PG-2 and PG-5 pass local regressions. Shopify
IN-1 and Atlas IN-2/IN-3 remain Investigate Now blockers; PG-1 and other parked findings stay deferred.

Build-stage Docker packaging includes compiled demo JSON. Full runtime image/live Chromium is NOT_RUN.
Readiness with provider credentials absent is MISSING_CONFIG for all adapters; informational exit 0,
strict exit 1 as expected. No secrets or local environment files were read into the verification process.

Use a fresh review chat: base 45db8d6, this branch head from git rev-parse HEAD, exact manifest and
commands in docs/evidence/local-verification.md, current decision in docs/decisions/scaled-testnet-settlement.md.
Review scope is frozen commercial/chain semantics, fee journal, payer ledger/binding, closed Atlas gate
and sanitized worker logging. Exclude frontend/Solana/Masumi/deployment/external calls and parked backlog.
