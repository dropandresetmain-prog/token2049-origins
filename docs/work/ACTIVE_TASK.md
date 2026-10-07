# Active task — hosted commerce completion

## Goal and base
- Base: ca5519ac6abb134b81f5cc194657a55718ec4701 (review/final-astra).
- Branch: feat/hosted-commerce-completion.
- Worktree: C:/Dev/t2o-wt-hosted-commerce-completion.
- Complete Atlas/Nuitée enablement, generic readiness recovery, free hosted Solana.
- Do not modify shared checkout, main, historical E2E evidence, or unrelated lanes.

## Required outcomes
- Atlas sandbox quote executable; proven guards retained; no new booking/payment.
- Nuitée current capability traced; remove only artificial restriction if present.
- One generic read-only readiness recovery for both rails; sanitized diagnostics.
- No-spend smoke uses saved profile with fulfillment: { category: retail }.
- Free public Solana HTTPS payer + bearer auth + PostgreSQL; no disk/private service.
- Preserve payer AND sponsor identities/history; pinned import and retirement.
- Both sources visible simultaneously; explicit fundingOptionId; no fallback.
- Final reviewable candidate only; deployment requires explicit final authorization.

## Checklist
- [x] Verify exact base and create isolated requested worktree.
- [x] Trace provider enablement; live Atlas false/Nuit�e sandbox-key configured; candidate Atlas true.
- [x] Inspect protected history: payer 7 entries/94220; sponsor 6 entries/25002 fees.
- [x] Implement bounded generic status diagnostics/recovery; 56 focused tests pass.
- [x] Fix saved-profile smoke; pending integration evidence.
- [x] PostgreSQL ledger/import/retirement; 7 focused PostgreSQL tests pass.
- [ ] Public Solana payer with internal sponsor and independently verified finality.
- [ ] Free Render provisioning and dual-source config/tests.
- [ ] Focused tests and checkpoint commits after verified phases.
- [ ] Final gates once; secret scan, migration checksums, ancestry, clean status.
- [ ] Completion report with honest hosted evidence limits.

## Current checkpoint
- Candidate Atlas sandbox gate enabled; no provider guard changes; Nuit�e needs no restriction edit.
- Provider suites and 22 provisioning tests pass; live Atlas gate remains false (no deploy).
- Generic diagnostics/recovery tested; no proven live cold failure classification yet; wake removed.
- Solana public payer uses internal sponsor, no facilitator HTTP surface, gateway finality verification.
- New migration 0008; all older migrations untouched.
- Both Solana identities retained; sponsor is also treasury owner, payer remains distinct.
- Canonical legacy files located under the older solana-funding worktree, not missing main data path.
- Two unsigned 1050 reservations remain counted; they block migration/readiness pending reconciliation.
- Key files inherit broad Modify access; apply must refuse until permissions are fixed.
- Local configured caps are blank; 102000 cap is historical, no new policy silently inferred.
- Real histories and key permissions remain unchanged; no chain spend/deploy/service write.

## Next action
- Finish sponsor/payment/provisioning tests and hosted dual-rail integration.
- Run no-spend live provider and payer reads where safe; clearly separate from candidate acceptance.
- Checkpoint verified provider/readiness changes, then final candidate gate and report.

## Critical constraints
- No deploy, merge, merchant booking, chain spend, history reset, or new identity.
- Existing OAuth, disclosure, retry/idempotency and Astra fixes preserved.
- Reservation before signing; ambiguous outcomes never produce a new signature.
- Never retry /pay as part of readiness recovery.
- Secrets only in protected files/environment; no credentials/bodies/PII in diagnostics.
- Read this file before each major phase, after agents/compaction, before completion.

## Evidence status
- Historical Atlas+Cardano and Nuitée+Solana E2E are pre-existing, not rerun.
- Current hosted acceptance and actual cold restart have not yet been observed.
- Solana hosted proof depends on deployment authorization; no claim of live proof.
