# Test checklist — pre-Masumi candidate

Local verification uses the final integrated code and isolated local PostgreSQL data only.
Commands/results: [integration verification](evidence/pre-masumi-integration.md).
Historical evidence is not rewritten or rerun. Masumi is excluded.

## Required local gate

- Clean npm ci; compatible pinned dependencies; no audit vulnerabilities.
- Local PostgreSQL up/healthy; fresh database migrations and idempotent rerun.
- Contiguous 0001_initial.sql, 0002_journal_truncate_guard.sql, 0003_shopify_shadows.sql.
- Competing migration startups and checksum-tamper rejection; PostgreSQL-only runtime.
- npm run typecheck and npm run build, including migration copy.
- Focused contracts: needs_input, immutable quotes, explicit fundingOptionId and 1:1000 policy.
- Cardano/Solana boundary/commitment/payer caps, funding recovery and replay regressions.
- Deterministic Shopify hosted quote, selected address/cart binding, PCI host, shipping wait,
  multiline totals, strict Free rows, Bogus checks, normal Pay, passive diagnostics and no retry.
- Global Catalog normalization, source/shadow truth, native identity recovery, publication,
  Storefront readback, concurrency/idempotency, old deterministic compatibility and quote reuse.
- Atlas gate/zero fees/independent ticket readback; Nuitée fee/identity/ambiguity checks.
- OCBC endpoint/normalization; MCP generic tools, needs_input, payer identity, duplicate/F-1 guidance.
- Evidence/proof provenance, simulated funding disclosure, unresolved/receipt semantics.
- PostgreSQL concurrency/idempotency/recovery, journal immutability and nested session locks.
- UI/design asset sanity: nonempty files, WEBP lengths/signatures, prototype syntax, local links.
- FULL npm test once after fixes; count includes focused suites, not additive coverage.
- Compiled gateway health/auth/restart smoke on a fresh owned schema, no provider credentials.
- Compiled MCP stdio initialize/list/needs_input smoke, no provider/funding action.
- Readiness informational with credentials absent; MISSING_CONFIG is expected, not acceptance.
- git diff --check and bounded tracked-file secret scan; no .env or signing history staged.
- Clean candidate, source ancestry, fresh main guard, candidate push, main fast-forward and SHA equality.

## Retained acceptance matrix

| Lane | Local regression gate | Recorded external evidence / limit |
|---|---|---|
| Cardano | Required PASS | PASS real Preprod funding/restart/readback; merchant fixture |
| Solana | Required PASS | PASS finalized Devnet funding/recovery; merchant fixture |
| Nuitée | Required PASS | PASS sandbox booking/readback; USD 96.24 includes processing fee |
| Atlas | Required PASS | Ticketing PASS; ambiguous-create recovery NOT_VERIFIED |
| OCBC | Required PASS | Corrected history/read-only observations PASS; historical sandbox |
| Shopify deterministic | Required PASS | Paid UNRESOLVED, one Pay, held reservation, no receipt |
| Shopify Global | Required PASS | Discovery/shadow PASS; exact quote UNRESOLVED; paid order NOT_RUN |
| MCP | Required PASS | Local/protocol PASS; ChatGPT host NOT_VERIFIED |
| UI | Asset/reference checks | Approved V3; static prototype not production runtime |
| Masumi | Excluded | NOT INTEGRATED / PENDING SEPARATE LANE |

## Forbidden actions in this gate

No new Cardano/Solana transfer, Shopify Pay, Atlas booking/payment, Nuitée booking, OCBC
mutation, deployment or Masumi execution. Do not run manual spending/provider harnesses.
Do not retry or mutate pur_01M48PSSTDQDR4VGPAQPC2VRYZ or its retained schema/history.
No local fixture or combined green test count can resolve historical external ambiguity.
Subsequent work starts from promoted main; final Astra review+fix and actual final E2E are
separate later tasks after all final lanes are integrated.
