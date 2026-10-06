# Capsule — TOKEN2049 Origins Commerce Gateway

> Any agent. Agent-native money in. Ordinary commerce out.

Capsule is a buyer-side commerce gateway for AI agents. The user's existing agent handles conversation and reasoning; Capsule handles typed commerce intent, exact quotes, explicit human authority, testnet funding verification, durable execution, reconciliation, accounting and proof.

## Current authoritative baseline

- Repository: dropandresetmain-prog/token2049-origins
- Latest integration base: 84c0aef7a7acd1851c590c54ccd8881b9dc365d5; current source tip is `git rev-parse HEAD`.
- Status: native Masumi service-fee/task runtime integrated; Sokosumi marketplace delivery remains partial.
- Previous pre-Masumi gate: 697/697 tests across 33 files plus install/build/migration/smoke checks PASS. Current Masumi integration checks: [MASUMI_INTEGRATION.md](docs/work/MASUMI_INTEGRATION.md).
- Deployment: NOT RUN.
- Masumi: native registry, escrow, result, exact seller payout and restart/replay PASS with external merchant/principal fixtures. Public Sokosumi listing/authenticated platform delivery remains unverified.
- Final external E2E: NOT RUN on this integrated main.

Main includes the latest E2E fixes, Cardano + Solana funding lanes, OCBC history fix, Nuitée and Atlas provider lanes, Shopify deterministic + Global Catalog/shadow work, thin MCP, PostgreSQL, evidence/proof, and approved Capsule UI V3 design references.

## Recorded external evidence

| Lane | Recorded result | Important limit |
| --- | --- | --- |
| Cardano | Real Preprod funding/recovery PASS | Merchant execution was a fixture; protected payer budget/history must be preserved |
| Solana | Finalized Devnet funding/recovery PASS | Merchant fixture; provided payer/preparation path required |
| Nuitée | Sandbox booking/readback PASS | USD 96.24 includes processing fee; tested payment method only |
| Atlas | Sandbox payment/ticketing PASS | Ambiguous-create recovery NOT VERIFIED |
| OCBC | Read-only sandbox observation/history PASS | Historical sandbox data; no settlement/debit claim |
| Shopify deterministic | Paid attempt UNRESOLVED | One Pay attempt; held unresolved reservation; no confirmed order/receipt |
| Shopify Global | Discovery/shadow/publication/readback PASS | Exact sandbox quote PARTIAL/UNRESOLVED; paid order NOT RUN |
| MCP | Protocol/local journeys PASS | ChatGPT host connection NOT VERIFIED |
| Masumi / Sokosumi | Native fee/task/payout PASS | Merchant/principal fixtures; actual Sokosumi marketplace delivery PARTIAL |
| UI | V3 design approved | Static reference only; not wired into runtime |

These rows are deliberately separate. A local green suite does not upgrade an external row.

## Core contract

Canonical flow:

1. collect missing information through structured needs_input;
2. find normalized offers;
3. create an exact immutable quote;
4. show available funding options;
5. human explicitly selects a funding option and approves the quote;
6. verify funding;
7. execute exactly once with durable checkpoints;
8. reconcile unknown outcomes by readback, never blind retry;
9. return a concise proof/receipt backed by durable evidence.

Purchase-principal funding rails: Cardano Preprod and Solana Devnet. Masumi is integrated separately as task remuneration; its escrow never funds merchant principal. Its core principal seam deliberately reports unavailable.

Commerce providers currently implemented: Shopify, Atlas and Nuitée. Shopify has two retail discovery modes:
- deterministic Capsule-owned store flow;
- live Shopify Global Catalog discovery -> durable shadow in Capsule's dev store -> same controlled sandbox execution path.

The source merchant receives no order/payment in the Global Catalog flow. Source offer evidence and Capsule sandbox execution evidence stay distinct.

## Database

Capsule uses PostgreSQL only.

- Local dev/tests: official PostgreSQL 18 via Docker Compose.
- Hosted DB provisioned: Render PostgreSQL, Singapore.
- SQLite is unsupported.
- Applied migrations: 0001_initial.sql, 0002_journal_truncate_guard.sql, 0003_shopify_shadows.sql.

## Demo settlement

Public-testnet stablecoins use a disclosed 1:1000 notional scale. Example:

USD 183.40 commercial notional -> 0.183400 six-decimal test stablecoin.

This is not FX and does not establish crypto-to-fiat settlement. Provider sandboxes continue to use the full commercial test amount.

## UI

Capsule is the approved name. DESIGN.md and docs/design/ui-v3/ are the approved design reference. The production runtime has not yet been wired to V3.

## Start here

Current docs:
- docs/DOCS_INDEX.md — what is authoritative vs historical
- docs/HANDOFF.md — complete project handoff
- docs/ROADMAP.md — remaining hackathon work
- docs/KNOWN_ISSUES.md — current triage
- docs/ENVIRONMENT.md — runtime/services/configuration
- docs/architecture/CURRENT_ARCHITECTURE.md — current system architecture
- docs/demo/CANONICAL_DEMO.md — target judge flow
- docs/demo/SEED_DATA.md — seed/preflight discipline
- docs/RUNBOOK.md — operations
- docs/TEST_CHECKLIST.md — verification gates
- docs/work/ACTIVE_TASK.md — current checkpoint and next action

Historical planning snapshots under docs/planning/ and append-only lane evidence under docs/evidence/ remain intentionally unchanged.
