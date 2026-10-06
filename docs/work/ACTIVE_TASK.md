# Active task — Shopify real discovery / controlled sandbox lane

This ledger belongs only to `build/shopify-global-sandbox`; other worktree ledgers remain untouched. Historical planning snapshots are unchanged.

## Git baseline

Fetched and verified `origin/build/e2e-acceptance` at `0afd377681fe0e27e0ea86cf2cfaa34cdb970769` before creating isolated branch `build/shopify-global-sandbox`. Worktree: `C:/Users/sethl/.codex/worktrees/shopify-global-sandbox/token2049-origins`. No merges. The E2E remote later advanced to diagnostic-only63df582; that later change is not inherited here.

## Outcome

Implementation and local verification complete. Real Global Catalog discovery PASS; one real shadow/product publication and Storefront visibility PASS; external exact quote guard unresolved; sandbox execution NOT_RUN; overall PARTIAL. No approval, funding, card entry, Pay or order in this lane. No Cardano transaction.

Source is a runtime GravaStar Mercury K1 Lite - Transparent Black observation at USD89.95, never a demo hardcode. One retained shadow recovered by unique custom ID after an interrupted publication. Full details and identifiers: [lane evidence](../evidence/shopify-global-sandbox-e2e.md). Architecture/scopes: [decision](../decisions/shopify-real-discovery-sandbox-execution.md).

## Completed

- Additional `discovery: live` mode; strict official UCP Catalog normalization and live selection lookup.
- Durable native-ID shadow mapping, session locks, one immutable live quote per offer, restart recovery, independent publication and sale readiness.
- Existing quote/execution/payment core preserved; source and sandbox provenance on normalized contracts/proof; fixture funding truthfully labelled.
- USD/quantity/item caps, owned development-store verification, no source images/payment, retained-shadow exclusion from ordinary discovery.
- Test-only bounded harness, external ambiguity guard, local lifecycle/concurrency/order/proof regression tests.
- Current docs and evidence updated; no dependencies or scope expansion.

## Verification

667/667 tests across29 files PASS; typecheck/build/diff check PASS;39 changed files scanned, no new configured-secret or live-token/private-key matches. Source/Storefront external evidence passed; no real order/receipt success claimed.

## Boundaries and risks

The original E2E lane has an unresolved post-Pay outcome. This lane did not retry payment. Three meaningful unfunded carts total were used: original quote plus two separated diagnostics; no further external cart probing. The source expired during investigation; expiry was not bypassed. No real quote total, order or receipt acceptance is claimed.

Investigate Now: original payment outcome, exact shadow checkout summary, Catalog reduced-offer transaction-retention guidance. Park for Later: FX, cleanup scheduling, delegated budgets. See evidence for classified risk/action details.

## Integration

Overlaps: contracts, core service/worker, Db session-lock handling, wiring, Shopify Admin transport/Storefront/browser parser, MCP description, proof page/model, demo config, migrations and current docs. Preserve both lanes' browser diagnostics and strict totals checks. Migration0003 must be reconciled with later migration numbering before integration. New nonsecret variable: `SHOPIFY_SANDBOX_PUBLICATION_ID`. No merge or final review started.

## Exactly one next action — fresh chat

Read-only reconcile original Shopify purchase `pur_01M48PSSTDQDR4VGPAQPC2VRYZ` / attempt `att_01M48PSSXDE96996RCDHP89NTR` in retained schema `shopify_accept_cefde6fa7269419080a4509999373a78`, using current E2E evidence and provider readback. Do not create a new cart or click Pay; do not merge. Recommend a fresh chat because implementation and external diagnosis context is long. Only after the original outcome is resolved can new paid acceptance be considered.
