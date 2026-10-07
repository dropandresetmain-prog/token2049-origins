# Final activation — Option B checkpoint

Status: **PARTIAL — Atlas gate approval required**. Option B migration, retirement and dual-rail hosted acceptance are complete. The recording checkpoint is not yet reached.

Runtime/deployed SHA: afa59b1459aec6fad545ab5eeec1b2b37a15445c. Branch: integration/final-activation. Gateway, Cardano payer and free Solana payer use the same tested commit. Evidence-only commits may follow this runtime checkpoint.

The operator explicitly selected permanent historical blocking without chain reconciliation. Both original 1050-unit candidates remain historically unresolved; neither is classified as unsent or terminal on chain. The original source text, headers, payer signatures, sponsor signature/reservation absence, timestamps, memos, metadata and all exposure are preserved in PostgreSQL. Purchase/message/candidate/signature references are banned in both signer roles, and database triggers freeze the original rows and audit records.

Payer import: 7 entries, 94220 committed base units, including both 1050-unit liabilities. Sponsor import: 6 entries, 25002 committed fee lamports. Original hashes match; permanent markers are identical after deployment and controlled restart. Both original purchase IDs return HTTP 403 policy_violation. Active Solana incomplete count is zero. Conflict and non-empty destination rejection pass isolated PostgreSQL tests.

Both original legacy files remain byte-identical, with exact-hash retirement markers and permanent lock files. No legacy Solana process or container was found before handoff. Existing keys and identity are reused; no new wallet, signature, submission, order or booking occurred.

Finalized Solana balances: payer 10 SOL / 19.907880 USDC; sponsor/treasury 4.999974998 SOL / 20.092120 USDC. Approved caps: per payment 250000 base units, cumulative 500000, commercial ceiling 25000 USD minor, sponsor fees 100000 lamports. Remaining cumulative 405780; usable per-payment headroom 250000; sponsor fee headroom 74998. Authenticated status reports fresh chain evidence and bounds headroom by chain balances.

Both public payers return health/status 200 and configured sources. Cardano protected configuration, caps, 5 accepted entries, 94820 committed units and original import marker remain unchanged. Both controlled restarts returned 200; public MCP recovered afterward. An actual platform idle cold start was not exercised.

Public Nuitée executable quote quo_01M4BECGQ6XDBJZ609Q6H3XHD8 exposes both rails and both configured sources simultaneously. Missing rail returns needs_input/funding_selection; invalid option returns invalid_request; neither creates a purchase. No fallback is observed. Nuitée booking is not run.

Atlas search succeeds, but its executable quote correctly fails route_unavailable while the gate is false. Automatic approval review rejected enabling ATLAS_ALLOW_TEST_BALANCE_PAYMENT=true without approval for that exact setting. A user approval question is pending. Deferring the change leaves Atlas search-only and prevents full final readiness; it does not affect completed migration or Nuitée/dual-rail acceptance.

Typecheck/build pass. Focused suites pass: 33 tests (Option B/payment), 103 additional existing Solana/provider checks, 5 balance/hosted service checks and 179 dual-rail/provider/readiness checks. Full backend and final live-E2E gates remain deferred.

Changed implementation: clients/solana/blocked-history.ts, ledger-import.ts, pg-ledger.ts, ledger-port.ts, ledger.ts, pay.ts, hosted-sponsor.ts, bridge.ts, hosted.ts; scripts/provision-hosted-solana-render.mjs; additive migration 0009; focused regression tests. Migrations 0001–0008 were not modified. CDP, Sokosumi and submission documents were not changed.

Next safe action (same chat): resolve the pending exact Atlas sandbox setting approval, verify its hosted executable quote without order/payment, then report READY FOR FINAL SOLANA + NUITÉE E2E and stop for Min Htet's recording/live-E2E approval. Never reuse either blocked original purchase or candidate. Do not run the final booking in this activation.

Detailed evidence: docs/evidence/final-activation/option-b-checkpoint.json, option-b-services.json, option-b-mcp.json and historical-block-policy.json. Previous activation evidence is retained.
