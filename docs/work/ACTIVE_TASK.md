# Pre-Masumi integrated candidate

## Scope and authority

Integrate completed E2E, crypto/provider, Shopify Global sandbox and UI design lanes.
After the local gate and promotion, main is the authoritative implementation baseline.
Masumi is NOT INTEGRATED / PENDING SEPARATE LANE.
No deployment, new Pay, chain transfer, provider booking or consequential external action.
Historical external evidence remains historical; local fixtures do not establish paid acceptance.

## Verified source heads

| Source | Exact SHA | Verified availability |
|---|---|---|
| main before | 95a896c730cf893c3afd00919ebe16ad823a608b | local + origin |
| E2E acceptance | 63df582c6e837b6ae3c35aefb9ec97d90347dd99 | local + origin |
| Crypto integration | 799f9619e70d77b841273f5523d94d7b43d0482f | local only; no remote source branch |
| Shopify Global sandbox | c4e53db75763373831626aaa702f9c318db07744 | local + origin |
| UI | 46087f0616335daaeadb169f2229c6376b6d6bef | local + origin |

Fetched all refs before changes. All four source worktrees were clean.
E2E acceptance and main are ancestors of crypto integration; Global and UI diverge.
Base: 799f9619e70d77b841273f5523d94d7b43d0482f, preserving integrated source commits.
Branch: integration/pre-masumi-candidate.
Worktree: C:/Dev/token2049-origins/pre-masumi-candidate.
The primary checkout's pre-existing untracked integration-e2e directory was not changed.

## Integrations completed

- Crypto base includes latest E2E, canonical Cardano binding, Solana and OCBC history fix.
- Global merge f96811b preserves durable shadows/provenance and newest checkout behavior.
- UI merge 8f27521 adds DESIGN.md, approved logos and V3 reference; no runtime wiring.
- Wiring conflict resolved with GlobalSandboxExecutor around current ShopifyExecutor,
  plus both Cardano and Solana adapters. No parallel purchase/execution contracts.
- Operational docs reconciled from actual code and retained evidence, not old lane snapshots.
- Clean installation exposed missing ws runtime peer for pinned Solana SDK; added ws 8.22.0.
- Gateway example now includes receive-only Solana, publication ID and optional buyer IP.
- No applied migration rewritten; history is 0001, 0002, 0003.

## Invariants

Progressive needs_input; immutable exact quote; explicit fundingOptionId selection.
No silent Cardano default. Both funding rails disclose 1:1000 scaled testnet settlement.
Generic find_offers/create_quote/buy/get_purchase remain thin over canonical HTTP/core.
One purchase, idempotency, journal and evidence model. Selected source offer has one shadow.
Source merchant truth never implies source payment/order; sandbox charges are labelled.
Current browser preserves address/cart binding, PCI allow-list, settled shipping/totals,
Bogus verification, normal Pay actionability, passive diagnostics and unknown-outcome safety.
No forced Pay or blind retry. PostgreSQL only; protected payer histories remain separate.

## Retained evidence

| Lane | Prior external evidence | Remaining limit |
|---|---|---|
| Cardano | PASS real Preprod funding/restart/readback | Merchant fixture; protected budget exhausted |
| Solana | PASS finalized Devnet funding/recovery | Merchant fixture; provided payer required |
| Nuitée | PASS sandbox booking/readback | USD 96.24 includes fee; tested method only |
| Atlas | PASS sandbox payment/ticketing | Ambiguous-create recovery NOT_VERIFIED |
| OCBC | PASS masked read-only sandbox observations | Historical data; no bank settlement |
| Shopify deterministic | UNRESOLVED paid attempt | One Pay; held reservation; no order/receipt |
| Shopify Global | PASS discovery, shadow, publication/readback | Exact quote UNRESOLVED; paid order NOT_RUN |
| MCP | PASS protocol journeys | Merchant/funding fixtures; ChatGPT host NOT_VERIFIED |
| UI | Approved V3 design/assets | Static reference; runtime implementation pending |

Original purchase pur_01M48PSSTDQDR4VGPAQPC2VRYZ is untouched: one Pay attempt,
unresolved, held reservation, no receipt and no Cardano transaction in that run.
Do not retry or fabricate its resolution. No local test resolves either Shopify external gap.
Evidence sources: docs/evidence/e2e-acceptance-log.md,
docs/evidence/shopify-global-sandbox-e2e.md, docs/work/COMPLETED_LANES.md,
docs/work/CARDANO_FIX.md, docs/work/SOLANA_FIX.md and SOLANA_LIVE.json.

## Verification and promotion

Current results and exact commands: docs/evidence/pre-masumi-integration.md.
Local gate PASS: clean install (253 packages, zero audit findings), healthy local PostgreSQL,
fresh DB migrations/rerun/checksums, typecheck/build, focused suites and full Vitest once
(697/697, 33 files), compiled gateway/MCP smoke, informational readiness, asset sanity,
diff check and bounded secret scan. Readiness is MISSING_CONFIG without credentials;
external evidence remains limited as listed above.
Promotion requires clean candidate and freshly fetched origin/main remaining an ancestor
without unrelated commits. Push candidate, fast-forward main to that exact head, verify
local main = origin/main = integration head. No force push or deployment.
Final candidate SHA is obtained from git rev-parse integration/pre-masumi-candidate;
that commit contains this report, so it does not embed its own hash.

## Current blockers and next action

See docs/KNOWN_ISSUES.md for exact classifications, actions and deferral risks.
Shopify paid ambiguity, shadow quote, SG market, throttling, Catalog retention guidance,
Atlas ambiguous-create recovery, ChatGPT host and deployment config remain bounded gaps.
Private config/history provisioning is required before any future signer/provider operation.
Use a fresh chat for subsequent milestones; this integration context is complete.
Start subsequent work from the new main baseline while waiting for Masumi; once all final
lanes are integrated, run Astra final review+fix before the actual final E2E.
Do not start that review or E2E automatically.
