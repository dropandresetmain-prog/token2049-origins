## X Layer integration status — 13 October 2026

X Layer Testnet native USD₮0 rail is integrated in the local candidate and independently accepted, including a fresh nonce-1 transfer, persisted receipt, and idempotent Shopify sandbox execution. Acceptance evidence: [report](work/XLAYER_ACCEPTANCE_20261013.json); [integration record](work/XLAYER_INTEGRATION.md). This does not change the hosted handoff above: X Layer is not activated on Render, migration `0014` is not applied to hosted Neon, and no new signing grant or hosted deployment is authorized by this integration.

# Capsule — current handoff

READY_FOR_OWNER_MCP_TEST — LIVE E2E NOT YET VERIFIED

Gateway 86f519450b1d61d5c42f8bbadb685b49f01ea798 / Git fingerprint 50029d5666088b1fc848b650a125cd637bbcd1c6b15812cdd0ebb4110a876fe3 / dep-db5kvf142hec739b8940; payer 3945f9c52cf76e1960569d53416361bcd42de175 / retained fingerprint addbe059ddebc7794a8d6f510f964f0d1dee300e3a58dcdb44248fd088ecdd46 / activation deploy dep-db5la02jnfac73ast890. Worker00ee6d4a-afdd-4807-ad05-f46d33fa1986/moduleSHA dc652cc9fc9f22de757e0d35387e15726f985ba3929f162180313dab515cbf15 unchanged.

| Cycle | Started UTC | Idle seconds | Elapsed ms | Verified result |
|---|---|---:|---:|---|
| 1 | 2026-10-11T09:01:41.427Z | 3418.142 | 36054 | initial429; Worker upstream200; authenticated ready; canonical invalid-ID400; independent startup; unchanged histories |
| 2 | 2026-10-11T09:19:00.446Z | 983.989 | 34449 | initial429; Worker upstream200; authenticated ready; canonical invalid-ID400; independent startup; unchanged histories |

Two independently cold integrated cycles PASS before covered activation. Fixed nesting90s Worker/110s gateway caller/130s preparation, unchanged45s MCP pending/repeat joining. Known sanitized upstream classification survives failure; payment POSTs never automatically retry. Controlled repeatability does not guarantee future ingress or explain the prior intermittent failure.

Existing conditional authorization covers exact narrow replacements and activation after gates. Fresh full PG18 restore, canonical histories, original ownership/identities/policies, retained three-rail initializer and old local/cloud fences PASS. Same payer signing enabled only after both cycles; non-spending transport/ownership/proof checks PASS while grants stayed off; exact three source/instance grants and saved customer commerce scope restored last. No key relocation, policy change, history reset, purchase, broadcast or provider write in this continuation.

Final16OAuth/MCP read-only checks PASS; owned source list configured3, unauthenticated401, console/historical receipt/proof200. Histories unchanged except explicitly approved authority/customer configuration and OAuth records. All9live rows NOT RUN. Do not retry the three expired incident purchases.

MCP https://token2049-origins.onrender.com/mcp; existing OAuth issuer https://token2049-origins.onrender.com/ supports dynamic registration. Console https://token2049-origins.onrender.com/console/. Owner refresh/reconnect if cached scope is read-only; use protected clipboard retrieval in docs/demo/MULTIWALLET_MANUAL_ACCEPTANCE.md. [Current OpenAI guide](https://developers.openai.com/plugins/deploy/connect-chatgpt), checked11October. No manual payer preparation.

Final authenticated Render17:25SG: Hobby/no card,82.75/750hours used (667.25remaining),69/500build minutes (431remaining),119MB/5GB,6/25services, accrued/projectedUSD0. Rounded shared counters can lag. Workers Free remains Active; exact account-wide Worker/Neon remaining compute allowance is not measured. No paid change.

Rollback: fence customer writes/signing/grants and inspect current canonical histories first. Never restore stale history or reactivate old signers after spending/uncertainty. Preserve old receipts/proofs and snapshots. STOP for owner tests; same chat for narrow owner-reported failures only.

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

Cold startup timestamps: cycle1 2026-10-11T09:02:08.995625573Z; cycle2 2026-10-11T09:19:23.592959176Z. Worker terminal classifications were upstream_2xx/HTTP200/routingnone in both; caller received them before authenticated readiness and safe400.
