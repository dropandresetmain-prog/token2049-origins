# Capsule — current handoff

## Current repair — BLOCKED_TECHNICAL

Gateway fe8abb7a82eb6e610445b40459137b5735647f39; retained payer 3945f9c52cf76e1960569d53416361bcd42de175; branch codex/capsule-neon-migration. Original3wallet identities/histories preserved; Solana/Sui token caps now match Cardano5,100,000 base units per payment, daily and cumulative at 1:1000. Sponsor/gas limits unchanged.175 integrated tests, 85 affected tests, eight final boundary tests, six runner assertions, typecheck and build PASS. Independent review found no source blocker.

Actual cold requests failed before payment claims. Bounded retries and identified request both return429; one actual gateway-runtime unauthenticatedhealth probe confirms Render x-render-routing: hibernate-rate-limited. Payer did not start. Temporary probe removed; normal gateway restored. OAuth/MCP16 and44-table financial/history preservation PASS.

Payer signing,three wallet grants and customer writes remain disabled. OldSolana/local signers remain fenced. No new quote/purchase/payment/provider operation. All repaired live rows NOT RUN; do not start E2E yet. [Evidence, reviewed support request and exact resume](architecture/PAYER_READINESS_REPAIR.md). Owner must obtain a supported Free cold-admission resolution or explicitly decide a material architecture exception; no paid/keep-alive/manual-warm fallback is authorized. Same chat for narrow resume. No stale rollback orretrying the three incident IDs.

## Previous hosted checkpoint — historical, superseded by repair

Branch `codex/capsule-neon-migration`; worktree `C:/Dev/token2049-origins-neon-migration`. Both Render Free gateway and consolidated payer are live at `cb7b96e9e43a09842c1e9ee031bd1d8e3ec73e78`, source fingerprint `f2d961ba32f725057312b47ba7557e7971f194a648417314a5a18b9d9abcd84a`. Main is unchanged at `7c09b37eaaeda2bf3eec94fc1e3456118962f636`. Later documentation-only checkpoint HEAD is recorded by Git and the task ledger; it is not a different deployed artifact.

Owner-approved Neon migration and consolidated cutover are complete. Three original wallets are enabled for `capsule_cb7b96e9e43a`; all old cloud payer clients are revoked, original cloud signing-key files removed after protected backup, local ledgers permanently retired, old Solana service suspended. No new wallet, cap increase, history reset, chain payment or provider write occurred.

Actual Render three-rail initialization/read-only checks PASS (Node24.21.0, peak145,856KiB), normal restart/source listing has no operator RPC fan-out, hosted OAuth/MCP16PASS, console/historical proof/source GET checks PASS. All25 original financial tables match the final pre-consolidation snapshot after accounting for the additive nullable recovery column. Sui2signed/35,900token units/20,000,000MIST remain intact. Post-cutover backup `f1fe714b075f1d294d1927dbf3b4a4561462d2f16cdcbad47c262068d579ffa7` restores all43tables/602rows plus catalogs/ACLs into disposable PG18. Protected evidence stays outside Git.

**Next action belongs to the owner:** connect/refresh the existing [MCP](https://token2049-origins.onrender.com/mcp) using OAuth, retrieve the existing consent code locally, and execute [nine-row manual acceptance](demo/MULTIWALLET_MANUAL_ACCEPTANCE.md). Every live row is NOT RUN. [Console](https://token2049-origins.onrender.com/console/) remains public read-only. The local `console-access-key` copy does not match the existing deployed reader hash; it was not changed. Public demo receipt/proof access passes without it.

No additional deployment, review cycle, feature or payment test is authorized by this handoff. Use the same chat for narrow owner test failures, retaining purchase IDs and unknown liabilities. Never repeat buy/switch wallet after ambiguity. No stale Render/Neon backup rollback after new signing; fence authority and reconcile canonical history first. [Runbook](architecture/CONSOLIDATED_PAYER.md), [runtime evidence](architecture/RENDER_MULTIWALLET_RUNTIME_EVIDENCE.md), [ledger](work/ACTIVE_TASK.md).

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
