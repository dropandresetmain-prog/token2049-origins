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
- Base SHA: _(filled after first push)_

## Runtime decisions (record reasons)

- Node v24.15.0 (LTS) on Windows x64; TypeScript strict; Express; zod; vitest.
- Persistence: built-in `node:sqlite` (no native build toolchain), single file, single writer/worker.

## Checkpoints

- [ ] C0 Docs-only first commit pushed on `main`
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
| Docs and contracts | NOT_RUN | n/a |
| Treasury | NOT_RUN | n/a |
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
- Atlas | permitted sandbox payment mechanism | prior adapter uses `pay.do` test balance only |
  decision/approval if test balance is the only path | implement create/retrieve, keep pay gated

## Current checkpoint

C0 — docs-only commit.

## Next action

Commit and push docs on `main`; create `build/commerce-core` worktree; scaffold C1.
