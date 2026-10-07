# Active task - hosted commerce completion

## Goal and base
- Base: ca5519ac6abb134b81f5cc194657a55718ec4701 (review/final-astra).
- Branch: feat/hosted-commerce-completion.
- Worktree: C:/Dev/t2o-wt-hosted-commerce-completion.
- Complete Atlas/Nuitee enablement, generic readiness recovery, free hosted Solana.
- Do not modify shared checkout, main, historical E2E evidence, or unrelated lanes.

## Required outcomes
- Atlas sandbox executable; proven guards retained; no new booking/payment.
- Nuitee capability traced; remove only artificial restriction if present.
- One generic read-only readiness recovery for both rails; sanitized diagnostics.
- No-spend smoke uses saved profile with fulfillment: { category: retail }.
- Free public Solana HTTPS payer + bearer auth + PostgreSQL; no disk/private service.
- Preserve payer AND sponsor identities/history; pinned import and retirement.
- Both sources visible simultaneously; explicit fundingOptionId; no fallback.
- Final reviewable candidate only; deployment requires explicit final authorization.

## Checklist
- [x] Verify exact base and create isolated requested worktree.
- [x] Provider enablement: live Atlas false; candidate true; no Nuitee restriction found.
- [x] Inspect protected history: payer 7 entries/94220; sponsor 6 entries/25002 fees.
- [x] Bounded generic status diagnostics/recovery; no payment retries; wake removed.
- [x] Saved-profile smoke; optional payer probes follow MCP; integration passes.
- [x] PostgreSQL ledger/import/retirement and immutable reservation tests pass.
- [x] Public Solana payer with internal sponsor and independently verified finality.
- [x] Free Render provisioning and dual-source configuration/tests.
- [x] Checkpoints: 2e07802 provider/readiness; 421ed55 Solana; e1029a4 fixture corrections.
- [x] Final gates run once; failed/affected test checks corrected and rechecked.
- [x] Secret scan, migration checksums/order, ancestry and whitespace checks pass.
- [x] Completion report saved and documentation checkpoint committed.

## Current checkpoint
- Candidate Atlas gate enabled; exact sandbox, zero-fee and single-pay guards preserved.
- Provider suites and 22 existing provisioning tests pass; live Atlas remains false.
- Generic transient-503 recovery for both rails collects the same MCP quote operation.
- Live Cardano status connected in 33219 ms without health pre-warming.
- A genuinely cold/restarting live state or prior fast-error root cause is not proven.
- Solana uses internal sponsor; gateway verifies finality without signing/broadcasting.
- New migration 0008; all older migrations untouched.
- Both existing Solana identities retained; sponsor is also treasury, payer distinct.
- Canonical histories are in the older solana-funding worktree, not missing main data path.
- Two unsigned 1050 reservations remain counted and block migration/readiness.
- Both real key files inherit broad access; apply refuses until permissions are fixed.
- Current caps missing/blank; historical 102000 cap is not silently reauthorized.
- Real histories/key permissions unchanged; no chain spend/deploy/service write.
- Solana focused suite: 33 tests pass; permission/smoke/transient: 6 pass, 47 skipped.
- Actual service uses isolated PostgreSQL/fake RPC, retaining identical imports on restart.
- Legacy facilitator still requires explicit URL/token; hosted mode needs neither.
- Typecheck/build/console typecheck pass; console tests 87 pass.
- Full suite: 1210 pass, one stale migration-count failure; corrected affected suites 12 pass.
- 0001-0007 byte-identical to base; 0008 is the only new migration.
- Safe to integrate: YES. Safe to deploy: NO, protected-state blockers remain.

## Next action
- Stop for user decision after the final clean-status/SHA check.
- Use a fresh chat for reservation reconciliation, key ACLs, explicit caps and balances.
- Read docs/work/HOSTED_COMMERCE_COMPLETION.md for evidence, risks and exact next task.
- Real migration/deployment/funding remain unauthorized and blocked by protected state.

## Critical constraints
- No deploy, merge, merchant booking, chain spend, history reset, or new identity.
- Existing OAuth, disclosure, retry/idempotency and Astra fixes preserved.
- Reservation before signing; ambiguous outcomes never produce a new signature.
- Never retry /pay as part of readiness recovery.
- Secrets only in protected files/environment; no credentials/bodies/PII in diagnostics.
- Read before major phases, after agents/compaction, and before completion.

## Evidence status
- Historical Atlas+Cardano and Nuitee+Solana E2E are pre-existing, not rerun.
- Local candidate with hosted config: Atlas 5 offers/quote, Nuitee 10 offers/quote.
- Provider probes use the saved profile and create no order/payment/booking.
- Public MCP quote acceptance and actual cold restart are not yet observed.
- Evidence: docs/evidence/hosted-commerce-completion/*.json (sanitized).
- Both rails visible together in local MCP integration; live Solana not provisioned.
- No live PostgreSQL import, retirement or funding proof has been performed.
