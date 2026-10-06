# ACTIVE TASK — Commerce Core, first long-horizon lane

Reread before each phase, after compaction, after subagent results and before completion.

## Goal

Prove `authenticated agent -> executable quote -> real Cardano Preprod funding -> journal/reservation
-> provider sandbox purchase -> independently retrieved outcome -> safe receipt`, then the same contract
across Shopify retail, Atlas flights and Nuitée hotels. Publish seams for Solana, MCP/ChatGPT,
Masumi/Sokosumi and console lanes.

## Source and repository

- Planning source: `dropandresetmain-prog/wip-personal@af648eece01321fec50bcddeee9ba92fd3e10d3a`,
  folder `token2049-hackathon/` (six `.md` files copied verbatim to `docs/planning/`, fetched via
  authenticated `gh api` at that ref; byte sizes match source).
- Target: `dropandresetmain-prog/token2049-origins` (verified empty locally and remotely before first commit).
- Root docs commit on `main`; code on `build/commerce-core` in worktree `C:\Dev\token2049-origins-core`.
- First docs commit / base SHA: `95a896c730cf893c3afd00919ebe16ad823a608b` (`main`, pushed, verified via ls-remote).

## Runtime decisions (record reasons)

- Node v24.15.0 (LTS) on Windows x64; TypeScript 6.0.3 strict (7.x skipped: new native compiler, avoid churn);
  Express 5.2.1; zod 4.6.5; vitest 4.1.11. ESM/NodeNext (required by @x402/cardano + evolution-sdk).
- Persistence: built-in `node:sqlite` (no native build toolchain), single file, WAL, single writer/worker.
- Cardano: x402 v2 `@x402/*@2.26.0` (template pins; event content freeze), facilitator verify+settle inside the
  funding adapter BEFORE evidence is persisted; worker executes only from confirmed persisted evidence.
- Shopify: Storefront cart + controlled Playwright checkout on own dev store with Bogus gateway; Admin GraphQL
  readback (`displayFinancialStatus`, `test`, transactions). Checkout MCP `complete_checkout` likely tier-gated.

## Checkpoints

- [x] C0 Docs-only first commit pushed on `main` (`95a896c`)
- [ ] C1 Contract + runnable skeleton (v1 schemas, auth, capabilities/readiness, error shape, money,
      persistence, jobs) — SHA published for parallel lane
- [ ] C2 Treasury + local commerce spine (quotes, authority, reservations, balanced journal, jobs,
      idempotency, restart reconciliation, fixtures)
- [ ] C3 Provider routes: Nuitée, Shopify, Atlas, OCBC observation
- [ ] C4 Direct Cardano x402 funding (SDK pinned, verify/replay/expiry)
- [ ] C5 HTTP + thin MCP + payer client + evidence API + run/deploy docs + Masumi fixtures
- [ ] C6 Independent review, triage, handoff

## Completion matrix (local impl / external acceptance)

| Row | Local | External |
|---|---|---|
| Docs and contracts | PASS (C1 tests) | n/a |
| Treasury | PASS (local fixtures) | n/a |
| Cardano | NOT_RUN | BLOCKED_EXTERNAL |
| Shopify | NOT_RUN | BLOCKED_EXTERNAL |
| Nuitée | NOT_RUN | BLOCKED_EXTERNAL |
| Atlas | NOT_RUN | BLOCKED_EXTERNAL |
| Security | NOT_RUN | n/a |
| API/MCP | NOT_RUN | n/a |
| Evidence | NOT_RUN | BLOCKED_EXTERNAL |
| Remote checkpoint | NOT_RUN | n/a |

## Blockers (integration | missing | evidence | human action | next independent task)

- All providers | credentials not yet provisioned | no `.env` | Min Htet provisioning in parallel |
  build adapters against fixtures
- Atlas | permitted sandbox payment mechanism | qoder-atlas@e79c387 `transactionAdapter.ts:85-86,202-207`:
  `pay.do` supports only `paymentMethod:1` (sandbox account balance); no card path found in code/docs |
  founder decision: approve bounded sandbox-only test-balance exception (labelled `test_balance_paid`, never card
  spend/supplier credit) or provide another permitted mechanism | build search/verify/order/retrieve; pay gated by flag
- Shopify | programmatic completion | Storefront checkout-complete mutations shut down 2025-04-01; Checkout MCP
  completion likely tier-gated | dev store + Bogus gateway + tokens | controlled browser checkout worker
- OCBC | read-only APIs (accounts, cards, txns) per tencent-hackathon@d02f7ba; sandbox data historical | creds |
  observation adapter only

## Current checkpoint

C1 — contract + runnable skeleton committed (v1 schemas, HTTP, auth/scopes, error shape, money, journal,
reservations, jobs, worker, restart recovery; 35 local tests). Channel contract: `docs/contracts/CHANNEL_CONTRACT.md`.

## Next action

Dispatch parallel adapter workers (Cardano, Shopify, Atlas, Nuitée, OCBC) on per-worker branches from C1; then
MCP + payer client + evidence API; integrate, review, recheck readiness.
