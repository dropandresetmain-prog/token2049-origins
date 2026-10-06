# Commerce Core handoff

## PostgreSQL persistence handoff

The current database lane is `build/postgres-persistence`, based on
`2b6260b41149d36fafcb98b387dec9cf43faa31f`. Read ACTIVE_TASK and local-verification for its final status.
The application now requires DATABASE_URL -> PostgreSQL, locally and on Render. Persistence callers
are async; merge policy-lane changes carefully through CommerceCore/Worker and HTTP/evidence callers.
The following commerce implementation history predates this migration.

## Current state

Local implementation checkpoint `beac0228eec8418380b575e1d90665da3e939989` on `build/commerce-core`, worktree `C:\Dev\token2049-origins-core`. Documentation checkpoint follows it; use `git rev-parse HEAD` for the complete branch head. Main remains the original docs-only `95a896c`. All six implementation lanes have been integrated; this branch is not merged to main.

The executable gateway registers Shopify, Atlas, Nuitée, Cardano and OCBC; mounts authenticated evidence, public inspect and raw-body Shopify webhook routes; and supplies separate MCP/payer/wallet commands. Fixtures remain under tests only. No live payment, provider order, wallet generation, OCBC observation or external acceptance was performed in this continuation.

## Completed work and decisions

- Cardano: locally prepared canonical hash and immutable funding requirement are durable before settlement. Read-only chain recovery survives response loss, same-proof retries, restart, old origin/config and expiry. Pre-settlement rejection clears only proven unsubmitted candidates; ambiguous settlement prevents another transfer. Signed metadata binds the exact quote/resource and TTL cannot exceed quote expiry.
- Core: balanced immutable journal, replay protection, synthetic reservations, refundable late/unexecuted obligations, single worker and read-only restart reconciliation. Unknown outcomes never trigger another provider write. Charge anomalies remain held until operator review. Ticket refresh only moves consistently paid ticketing to ticketed.
- Providers: Shopify cart delivery/tax quote + controlled Bogus checkout + strict Admin paid test proof; Nuitée exact sandbox booking identities and paid readback; Atlas sandbox create/readback with payment flag off and explicit zero fees required before pay. Test-balance usage is a separate synthetic account, never card payable.
- Channels/evidence: MCP funding scope excluded by default; separate same-customer bounded payer/loopback bridge; strict credential URL/redirect policy. OCBC observation never changes treasury/capacity. Customer evidence stays owner-scoped; bank/treasury needs operator scope. Receipt/result fixture provenance is preserved.
- Independent auth/funding, journal/restart and provider/evidence reviews completed. Act Now findings fixed and tested; remaining Investigate/Park/Accept entries are in KNOWN_ISSUES.

## Files to inspect

`docs/work/ACTIVE_TASK.md`, `docs/RUNBOOK.md`, `docs/TEST_CHECKLIST.md`, `docs/KNOWN_ISSUES.md`, `docs/evidence/local-verification.md`, `docs/contracts/CHANNEL_CONTRACT.md` are the operational starting point. Planning snapshots remain authoritative for scope.

Implementation: `src/wiring.ts`, `src/core/{service,worker,store,journal,capacity}.ts`, `src/infrastructure/{db,migrations}.ts and src/migrations/`, `src/contracts/ports.ts`; `src/funding/cardano/`, `clients/payer/`, `src/execution/{shopify,atlas,nuitee}/`, `src/channels/{http,mcp}/`, `src/banking/ocbc/`, `src/evidence/`. Restart/authority regressions: `tests/integration/funding-recovery.test.ts`, `safety-regressions.test.ts`, `wiring.test.ts`.

Lane checkpoints: MCP `d3477f2` + `12b1e03`; Atlas `413469b` + `d47463e`; Nuitée `3a39939` + `5f06326`; Shopify `fecbb29`; evidence `250f1ce` + `e0f947f`; Cardano/payer `f92539f` + `03cff5a`. Follow-ups were cherry-picked onto integration (`17f6756`, `7d159c3`, `e5c0abd`, `31f1eac`); original lane branches remain pushed. Worktrees remain available for inspection. Root dependencies were not changed during continuation.

## Verification

2026-10-06: full Vitest suite **396/396 in 21 files PASS**, strict typecheck PASS, production build PASS, compiled gateway startup/health/capabilities/inspect/auth smoke PASS, client CLI role/customer separation PASS, diff whitespace PASS. Sanitized readiness reports all five adapters MISSING_CONFIG; informational command exits 0, strict command exits 1 as designed. Docker image build, non-root Chromium launch, auth and persistent-volume restart checks PASS on Linux ARM64. Host Node is Windows ARM64 v24.15.0; container Node v24.21.0. No public deployment/live browser checkout claim. See local-verification for exact context.

## Next chat

Recommended model: **gpt-6.1-sol**. Recommended reasoning: **High**. The next task is bounded by the runbook but needs careful financial and external-evidence verification. Delegate isolated documentation/probes to cheaper workers; keep core semantics with the lead.

**Fresh chat prompt**

Use a **fresh chat** for the credential-dependent external acceptance milestone; this context is long. Read ACTIVE_TASK, RUNBOOK, TEST_CHECKLIST and KNOWN_ISSUES first. Confirm the current clean branch and privately provision gateway/payer credentials, test funds, protected cap ledger and provider sandbox access. Resolve the founder's Atlas payment-path decision and Shopify dev-store provisioning. Keep the Atlas payment flag off until explicit approval. Run readiness with configured environment, then a fresh bounded Cardano Preprod-funded Shopify purchase and independent paid test readback. Capture sanitized evidence and update only that external row. Repeat separately for approved Atlas and verified Nuitée; capture OCBC observations independently. If still blocked, preserve exact BLOCKED_EXTERNAL rows and continue only independent work.

A new agent must not repeat local fixture work to label external acceptance PASS. Do not introduce Solana/Masumi/console implementation into this branch as an unrequested scope expansion. Do not enable production, put payer keys in gateway, use Admin mark-paid, bypass CAPTCHA/OTP, repeat unknown provider writes, invent bank/FX settlement, erase payer history/locks, or release held anomalous exposure. Do not merge main, deploy or publish without the corresponding authorization. Keep exact-file staging and required commit trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
