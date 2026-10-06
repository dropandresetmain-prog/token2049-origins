# Capsule — current handoff

## Current repository state

Repository: dropandresetmain-prog/token2049-origins

Authoritative main baseline:
8a76225364bf3b56fe2bf192297ee17b86d8f540

Status:
PRE-MASUMI integrated main baseline established.

Main contains:
- PostgreSQL persistence and migrations;
- progressive needs_input and explicit funding-option approval;
- Cardano Preprod funding;
- Solana Devnet funding;
- Shopify deterministic execution path;
- Shopify Global Catalog discovery + durable sandbox shadows;
- Atlas flights;
- Nuitée hotels;
- OCBC read-only observations;
- canonical HTTP + thin MCP;
- customer/judge proof projection;
- approved Capsule UI V3 design assets/reference.

Not integrated:
- Masumi/Sokosumi lane.

Not yet done on this baseline:
- deployment;
- final integrated external E2E;
- ChatGPT host connection;
- runtime implementation of approved UI V3;
- final Astra review+fix;
- submission/demo package finalization.

## Verification at main promotion

Pre-Masumi integration gate:
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
| Masumi | Not integrated; separate lane pending |

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

1. Receive and assess the final Masumi/Sokosumi lane; integrate only if its verified value exceeds integration risk.
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
