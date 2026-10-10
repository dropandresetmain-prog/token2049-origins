# Capsule — current handoff

## Current consolidated-payer candidate — 10 October 2026

Worktree: `C:/Dev/token2049-origins-on-demand`; branch: `codex/capsule-on-demand-multiwallet`; base: `7c09b37eaaeda2bf3eec94fc1e3456118962f636`. Resolve exact checkpoint SHA/state from [ACTIVE_TASK](work/ACTIVE_TASK.md) and `git rev-parse HEAD`; do not resume from the historical baseline below.

The candidate reuses existing Render infrastructure and integrates Sui with one customer-linked multi-wallet payer. Keys, canonical history, live deployments and old authority remain untouched until approval. Read [cutover/rollback](architecture/CONSOLIDATED_PAYER.md), [runtime evidence](architecture/RENDER_MULTIWALLET_RUNTIME_EVIDENCE.md) and [owner manual tests](demo/MULTIWALLET_MANUAL_ACCEPTANCE.md). Finish the ledger's recorded next action in the same coding chat. No live purchases are authorized; all nine new live rows are NOT RUN.

The following older handoff remains retained integration history, not a current deployment claim.


## Current repository state

Repository: dropandresetmain-prog/token2049-origins

Latest integration base:
84c0aef7a7acd1851c590c54ccd8881b9dc365d5

Current source tip: `git rev-parse HEAD`. Exact integration checks: docs/work/MASUMI_INTEGRATION.md.

Status:
Native Masumi service-fee/task runtime integrated with the existing main lanes; actual Sokosumi marketplace delivery remains partial.

Main contains:
- PostgreSQL persistence and migrations;
- progressive needs_input and explicit funding-option approval;
- Cardano Preprod funding;
- Solana Devnet funding;
- authenticated native Masumi fee/task runtime with independently verified seller payout;
- Shopify deterministic execution path;
- Shopify Global Catalog discovery + durable sandbox shadows;
- Atlas flights;
- Nuitée hotels;
- OCBC read-only observations;
- canonical HTTP + thin MCP;
- customer/judge proof projection;
- approved Capsule UI V3 design assets/reference.

Not proved:
- public Sokosumi listing, platform-to-agent authentication and marketplace task delivery.

Not yet done on this baseline:
- deployment;
- final integrated external E2E;
- ChatGPT host connection;
- runtime implementation of approved UI V3;
- final Astra review+fix;
- submission/demo package finalization.

## Verification at main promotion

Historical pre-Masumi integration gate:
- clean npm install: PASS
- PostgreSQL fresh migrations + rerun/checksums: PASS
- typecheck/build: PASS
- full Vitest: 697/697 in 33 files PASS
- compiled gateway health/auth/restart smoke: PASS
- compiled MCP stdio/needs_input smoke: PASS
- UI/design sanity: PASS
- diff checks: PASS
- bounded secret scan: PASS

Exact commands/evidence: docs/evidence/pre-masumi-integration.md.

No deployment or new provider/payment/chain action occurred during integration.

## External evidence matrix

| Component | Current external evidence |
| --- | --- |
| Cardano | Real Preprod funding/recovery PASS; merchant fixture |
| Solana | Finalized Devnet funding/recovery PASS; merchant fixture |
| Nuitée | Real sandbox booking/readback PASS; final USD 96.24 includes processing fee |
| Atlas | Real sandbox payment/ticketing PASS; ambiguous-create recovery unverified |
| OCBC | Masked read-only sandbox observations/history PASS |
| Shopify deterministic | One paid attempt remains UNRESOLVED; do not retry that purchase |
| Shopify Global | Real discovery/shadow/publication/readback PASS; exact sandbox quote partial; paid order not run |
| MCP | Local/protocol PASS; ChatGPT host not verified |
| UI | V3 approved reference; runtime not implemented |
| Masumi / Sokosumi | Native fee/task/payout/restart PASS; external merchant/principal fixtures; marketplace delivery PARTIAL |

Original unresolved Shopify purchase:
pur_01M48PSSTDQDR4VGPAQPC2VRYZ

Do not retry, mutate or fabricate resolution. It is retained evidence of conservative unknown-outcome handling.

## Must-preserve invariants

- No silent funding rail selection.
- Approval binds exact quote + selected funding option.
- Testnet settlement is explicitly 1:1000; no FX claim.
- Payer keys stay outside the gateway.
- Cardano/Solana signer histories and cap ledgers must not be reset.
- Provider writes are checkpointed before irreversible calls.
- Unknown irreversible outcomes reconcile by readback; never blind retry.
- One purchase/idempotency/journal/evidence model across channels/providers.
- Shopify Global source merchant and Capsule sandbox execution remain separate facts.
- Fixture/local evidence is never relabelled as fresh external evidence.
- PostgreSQL only; migrations are append-only after application.

## Highest-priority remaining work

1. Prepare the actual Sokosumi host/listing/authentication milestone only if required for the demo; native Masumi is integrated. Keep task fees separate from direct purchase principal.
2. Run the cross-provider demo seed/preflight audit in docs/demo/SEED_DATA.md.
3. Wire approved UI V3 into the runtime proof/transaction console.
4. Verify deployment configuration and deploy the exact final candidate to Render.
5. Verify actual ChatGPT host connection if it materially improves the demo/submission.
6. Run Astra final review+fix on the exact integrated candidate.
7. Run one canonical final E2E on that exact candidate; preserve unknown outcomes rather than retrying.
8. Freeze features and finish video/deck/forms/submission evidence.

See docs/ROADMAP.md for ordering and cut criteria.

## Recommended next planning chat

Use a fresh GPT-6.1 Sol High/Astra-capable planning chat. Start from main, not old lane branches. Inspect repo/runtime first. Treat this handoff, ROADMAP, ACTIVE_TASK, KNOWN_ISSUES, ENVIRONMENT, architecture and demo docs as current authority. The planning chat should decide the minimum remaining path to a judge-ready submission, not reopen settled architecture.
