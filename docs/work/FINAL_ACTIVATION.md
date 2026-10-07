# Final activation — recording checkpoint

Status: **READY FOR FINAL SOLANA + NUITÉE E2E**. Stop here for Min Htet to begin recording and explicitly approve the live E2E. No payment, provider order or booking was executed during activation.

Branch: integration/final-activation. Verified branch SHA: 20f985123f614e3d07963779f7c354ce68736457. All three live services use tested runtime SHA afa59b1459aec6fad545ab5eeec1b2b37a15445c; subsequent commits contain evidence only.

The approved Atlas setting ATLAS_ALLOW_TEST_BALANCE_PAYMENT=true is deployed on the gateway. Every other gateway environment value was verified unchanged. Atlas executable quote quo_01M4BEYBDBR9Y1NQJ79TSCDXJE and Nuitée executable quote quo_01M4BEY9D6VENT99VVX0RBK9HS both pass through the public hosted MCP, each exposing configured Cardano and Solana sources and both funding options simultaneously. Missing selection returns needs_input/funding_selection; invalid selection returns invalid_request. Neither creates a purchase, and no fallback occurs.

Option B preserves both original 1050-unit candidates as historical unresolved / permanently blocked. Chain classification remains unknown. They are not classified as unsent or chain-terminal. Both source texts, original references/statuses, payer signatures, absent sponsor signatures/reservations, timestamps, memos, metadata and committed exposure are retained immutably in PostgreSQL. Original purchase, message, candidate and payer-signature identities are prohibited in both signing roles before readiness/RPC/signing. Both old purchase IDs return HTTP 403 policy_violation:

- pur_01M48S9JMWEXMS34EEYCZ0YYKP
- pur_01M48SB32BXEZGS9KPC74NNGM5

Payer import: 7 entries, 94220 committed base units, including the entire 2100-unit ambiguous exposure. Sponsor import: 6 entries, 25002 committed fee lamports. Identity, original hashes, counts and totals match. Import markers remain exact after deployment and controlled restart; rerun verifies without reimport. Conflict and non-empty destination rejection pass isolated PostgreSQL regression tests. Both original source files remain byte-identical with permanent exact-hash retirement and lock markers. No local legacy Solana signer process or container was found. New hosted signing uses PostgreSQL exclusively.

Payer: 5iSWoZSucVSaNjtxeVC5TCJTN1RQBC6nScw8P32X5MZ6. Sponsor/treasury: 6QdrzAxbQMZGCSuk2R9ddneHum22VUJdabDM56ZAr6EU. Solana Devnet; mint 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU. No wallet or key was replaced.

Finalized chain snapshot at 2026-10-07T15:17:09.347Z: payer 10 SOL / 19.907880 USDC; sponsor/treasury 4.999974998 SOL / 20.092120 USDC. Caps: per payment 250000 base units; cumulative 500000; commercial ceiling 25000 USD minor; sponsor fees 100000 lamports. Remaining cumulative 405780, usable per payment 250000, sponsor fees 74998. Balance evidence bounds usable headroom; unavailable evidence reports zero usable headroom without blocking migration.

Public Solana payer https://t2o-solana-payer.onrender.com is free and returns health/status 200, configured source and PostgreSQL-backed history. Cardano returns health/status 200 and configured source. Its caps, 5 accepted rows, 94820 committed units and original import marker remain unchanged. Both controlled restarts returned 200, source/readiness recovered, and public MCP recovered afterward. True platform idle cold start was not exercised. Active Solana incomplete: 0; Cardano signing/signed: 0. The two historical ambiguities remain explicitly unresolved and permanently isolated from new attempts.

Typecheck and build pass. Focused suites passed: 33 Option B/payment tests; 103 existing Solana/provider checks; 5 balance/hosted-service checks; 179 dual-rail/provider/readiness checks. Full backend suite and live E2E were not run. This checkpoint changes only deployment configuration and activation evidence; the tested runtime code is unchanged.

Implementation files previously changed: clients/solana/blocked-history.ts, ledger-import.ts, pg-ledger.ts, ledger-port.ts, ledger.ts, pay.ts, hosted-sponsor.ts, bridge.ts, hosted.ts; scripts/provision-hosted-solana-render.mjs; additive SQL migration 0009; focused regression tests. Migrations 0001–0008, Cardano caps/history, CDP runtime, Sokosumi and submission documents were not changed.

Next step: continue in this same chat only after the recording/live-E2E approval. Obtain a fresh quote and balance/readiness evidence for that run; never act on either blocked historical purchase or candidate. The sandbox Atlas gate does not authorize creating an Atlas order or using its balance in this checkpoint.

Evidence: docs/evidence/final-activation/option-b-checkpoint.json, option-b-services.json, option-b-mcp.json, historical-block-policy.json. Previous evidence is retained.
