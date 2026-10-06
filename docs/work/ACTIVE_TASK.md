# ACTIVE TASK — Commerce Core, first long-horizon lane

Reread before each phase, after compaction, after subagent results and before completion.

## Goal and authority

Prove `authenticated agent -> executable quote -> real Cardano Preprod funding -> journal/reservation -> provider sandbox purchase -> independently retrieved outcome -> safe receipt`, then the same contract across Shopify retail, Atlas flights and Nuitée hotels. Publish seams for Solana, MCP/ChatGPT, Masumi/Sokosumi and console lanes. Local implementation is complete; external proof remains BLOCKED_EXTERNAL.

- Planning source: `dropandresetmain-prog/wip-personal@af648eece01321fec50bcddeee9ba92fd3e10d3a`, `token2049-hackathon/`; six files copied verbatim to `docs/planning/` through authenticated gh API. Pinned planning sources remain unchanged.
- Target: `dropandresetmain-prog/token2049-origins`.
- Main/root docs-only commit: `95a896c730cf893c3afd00919ebe16ad823a608b` (pushed).
- Integration branch/worktree: `build/commerce-core`, `C:\Dev\token2049-origins-core`.
- Tested implementation checkpoint: `beac0228eec8418380b575e1d90665da3e939989`. Operational docs follow this checkpoint; use current branch HEAD for the complete handoff.

## Runtime and financial decisions

Node 24.15.0, TypeScript 6.0.3 strict, Express 5.2.1, zod 4.6.5, Vitest 4.1.11, ESM/NodeNext; existing SDK pins x402 2.26.0 and Evolution 0.5.14 retained. Built-in SQLite, WAL, one gateway writer/worker, persistent volume. Production is refused.

Cardano adapter verifies/settles through the facilitator and independently checks Blockfrost. Core persists prepared hash + frozen funding resource/requirement + recovery job BEFORE settlement. SDK-compatible signer commits quote/resource metadata and validity end. Payer keys and protected cap ledger remain in a separate process; ambiguous transfers refuse new funding and recover by chain read only. Late confirmed funds remain refundable obligations, never expired purchases.

Shopify uses own dev-store Storefront cart + controlled Bogus checkout + independent Admin readback; no mark-paid/order-create Admin shortcuts. Atlas test-balance pay remains behind explicit founder approval and requires explicit zero fees; provider test-balance usage is distinct from card liability. Nuitée uses sandbox ACC_CREDIT_CARD simulation with exact independently retrieved identities. OCBC is read-only masked/historical observation and never capacity or settlement truth. Unknown provider outcomes and charge anomalies retain exposure and do not repeat writes.

## Checkpoints — local implementation

- [x] C0 Docs-only main first commit `95a896c`.
- [x] C1 Contract + runnable skeleton `0955263`; lane base `3bf1b61`.
- [x] C2 Treasury, authority, balanced journal, capacity, jobs, replay and durable funding/provider restart recovery.
- [x] C3 Shopify/Atlas/Nuitée provider adapters and OCBC observation implemented/wired, locally tested.
- [x] C4 Direct Cardano x402 + committed bounded payer/bridge implemented, offline verified. Real Preprod proof blocked.
- [x] C5 HTTP + MCP + scoped evidence/public inspect + run/deploy docs; channel equivalence and fee-only Masumi seam fixtures. No live ChatGPT/Masumi integration claim.
- [x] C6 Three independent bounded reviews, Act Now fixes, triage and handoff.

## Completion matrix (2026-10-06)

| Row | Local implementation | External acceptance |
|---|---|---|
| Docs/contracts | PASS — source snapshot, executable schemas, operational docs | n/a |
| Treasury | PASS — balanced journal, reservations, replay/restart/late obligations | n/a; simulated fiat is not settlement |
| Cardano/payer | PASS — SDK/CBOR fixtures, metadata/TTL, independent-readback fakes, caps, recovery | BLOCKED_EXTERNAL — credentials, controlled wallet/test funds and facilitator/Blockfrost access absent |
| Shopify | PASS — exact cart quote, payment checkpoint, strict Admin proof, raw webhook integration | BLOCKED_EXTERNAL — own dev-store/Bogus setup, credentials, installed browser/live selectors unverified |
| Nuitée | PASS — sandbox guards, identity-bound readback, ambiguous failures | BLOCKED_EXTERNAL — sandbox API key and fresh funded booking/readback absent |
| Atlas | PASS — gated test-balance flow, zero-fee guard, identity/amount readback, ticket refresh | BLOCKED_EXTERNAL — credentials, founder payment-path decision and latest fee proof absent |
| OCBC/evidence | PASS — scoped read model, persisted provenance, masked observations, no ledger writes | BLOCKED_EXTERNAL — credentials/subscriptions/session, live account/card APIs unverified |
| Security | PASS — auth/ownership/scopes, replay, redaction, URL/redirect boundaries and independent reviews | Live secret storage/deployment still NOT_RUN |
| HTTP/MCP | PASS — real adapters mounted, CLI role separation, local MCP tools/transport | Live MCP client/ChatGPT connection NOT_RUN |
| Deploy/container | PASS — image build, non-root Chromium, auth and named-volume restart on Linux ARM64 | NOT_RUN — no public deployment or live checkout claimed |
| Remote checkpoint | PASS — beac022 pushed; ls-remote SHA verified | n/a |
| Solana / live Masumi / polished console / submissions | NOT_RUN — separate subsequent lanes | NOT_RUN |

Full suite: **396 tests in 21 files PASS**; typecheck/build/compiled startup/client CLI roles/whitespace PASS. Informational readiness exits 0 with all five adapters MISSING_CONFIG; strict readiness exits 1. See `docs/evidence/local-verification.md` for evidence and limits.

## Exact external blockers and next action

| Integration | Missing / decision | Needed evidence and next action |
|---|---|---|
| Cardano | CARDANO_NETWORK, FACILITATOR_URL, TREASURY_ADDRESS, ASSET_UNIT, ASSET_DECIMALS and BLOCKFROST_PROJECT_ID absent in process environment; separate payer credentials/test funds/caps not provisioned | Provision privately; fresh Preprod treasury output + signed commitment + depth + persisted journal. No fake or fee-only funding. |
| Shopify | STORE_DOMAIN, STOREFRONT_TOKEN, CLIENT_ID/SECRET, explicit DEV_STORE/Bogus flags, browser executable; founder dev-store provisioning open | Provision own dev store, exact delivery/tax quote, synthetic checkout and independent test PAID/Bogus SALE-or-CAPTURE readback. |
| Atlas | BASE_URL, CLIENT_ID/SECRET; approved payment mechanism | Founder approves bounded sandbox-only test balance or identifies permitted card/VCC route. Keep flag false. Verify explicit latest zero fee, then independently paid/ticketed sandbox outcome. |
| Nuitée | NUITEE_API_KEY | Confirm sandbox key and exact booking/client/hotel readback fields, then fresh funded simulated-paid sandbox booking. |
| OCBC | API_CLIENT_ID/SECRET, subscriptions and customer session where needed | Independently verify account/card/history contracts; capture masked fresh observations with historical-data caveats. |
| Public deployment/client connection | NOT_RUN — separate authorized deployment/client milestone | Local image checks PASS; repeat access/TLS/browser/volume checks in the actual deployment environment. |

## Lane history and handoff

All original lanes merged. Pushed lane heads: MCP `12b1e03`, Atlas `d47463e`, Nuitée `5f06326`, Shopify `fecbb29`, evidence `e0f947f`, Cardano `03cff5a`. Follow-up patches cherry-picked into core; core owns wiring, financial semantics, shared contracts, root runtime and final verification. Exact paths and constraints are in `docs/HANDOFF.md`.

Recommend a fresh chat for credential-dependent external acceptance. Read RUNBOOK, TEST_CHECKLIST, KNOWN_ISSUES and HANDOFF. First resolve credentials/Shopify provisioning/Atlas founder decision, then prove Cardano-funded Shopify and update only the externally verified row; repeat approved Atlas/Nuitée and separate OCBC observation. Preserve BLOCKED_EXTERNAL where no proof exists. Do not merge main, enable production, deploy, publish, expand into unrelated lanes, erase cap history, release unknown exposure or repeat provider writes without the corresponding scope/authorization.
