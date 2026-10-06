# Pre-Masumi integration verification

Local verification on 2026-10-06, Singapore time. No paid Shopify, chain transfer,
provider booking/payment/mutation, deployment or Masumi execution occurred.
This report describes the checkpoint used for exact-head main promotion. Obtain its SHA
from `git rev-parse integration/pre-masumi-candidate`; compare with `main` and `origin/main`.
The completion report records final equality after push. This commit cannot embed its own hash.

## Source reality and integration

| Source | Exact SHA | Availability at initial fetch |
|---|---|---|
| Main before | 95a896c730cf893c3afd00919ebe16ad823a608b | local + origin |
| E2E acceptance | 63df582c6e837b6ae3c35aefb9ec97d90347dd99 | local + origin |
| Crypto integration | 799f9619e70d77b841273f5523d94d7b43d0482f | local only |
| Global sandbox | c4e53db75763373831626aaa702f9c318db07744 | local + origin |
| UI | 46087f0616335daaeadb169f2229c6376b6d6bef | local + origin |
| Masumi | excluded | NOT INTEGRATED / PENDING SEPARATE LANE |

All four selected source worktrees were clean. Main and latest E2E are ancestors of crypto;
Global/UI diverge. Integration branch/worktree: `integration/pre-masumi-candidate`,
`C:/Dev/token2049-origins/pre-masumi-candidate`, base exact crypto head above.
Primary checkout's existing untracked `integration-e2e/` data was preserved.

1. Crypto base already includes E2E and completed funding/provider fixes; no redundant core merges.
2. Global merge `f96811bc47145cc3b51399eb3c8e134dec36e170`.
3. UI merge `8f2752143d97ee918a9cf6f736ae7f6ac7d77f82`.
4. Clean-install runtime fix `dc2fe94`: exact `ws@8.22.0`, 23 manifest/lock lines.
5. Current docs/example reconciliation and this verification checkpoint.

Global conflicts: `src/wiring.ts`, `docs/KNOWN_ISSUES.md`, `docs/TEST_CHECKLIST.md`,
`docs/work/ACTIVE_TASK.md`. Wiring retains both funding adapters and the Global wrapper
around the latest ShopifyExecutor. Operational docs were reconciled to actual code/evidence.
Browser/test files merged automatically and were inspected: only strict Free-shipping
parsing is added to the newer E2E browser; passive diagnostics/payment behavior is retained.
UI merged cleanly, exactly 21 design/reference/asset files, no runtime semantics changes.
Source histories are preserved, no squash or force.

## Architecture and external truth

Deterministic controlled product -> current exact hosted quote -> sandbox checkout/test proof.
Live Global Catalog/UCP -> normalized selected source -> one durable shadow/native identity
recovery -> publication/Storefront readback -> SAME exact quote/execution machinery.
Source merchant/item observation and sandbox shipping/tax/total/order provenance remain distinct.
MCP generic tools and canonical purchase/idempotency/funding/evidence model remain unchanged.
No local check demonstrates resolution of either historical Shopify external gap.

| Lane | Final local regression | Retained external evidence / limit |
|---|---|---|
| Cardano | PASS | PASS real Preprod funding/readback/restart; merchant fixture, exhausted protected budget |
| Solana | PASS | PASS finalized Devnet funding/recovery; merchant fixture, provided payer required |
| Nuitée | PASS | PASS sandbox booking/readback; USD 96.24 includes processing fee |
| Atlas | PASS | Ticketing PASS; ambiguous-create recovery NOT_VERIFIED |
| OCBC | PASS | Corrected history and masked read-only observations PASS; historical sandbox data |
| Shopify deterministic | PASS | Paid external acceptance UNRESOLVED; one Pay, held reservation, no receipt |
| Shopify Global | PASS | Discovery/shadow/publication/readback PASS; exact quote PARTIAL/UNRESOLVED; paid order NOT_RUN |
| MCP | PASS protocol/local | ChatGPT host NOT_VERIFIED |
| UI | PASS static reference/assets | Approved V3; existing runtime UI retained |
| Masumi | Excluded | NOT INTEGRATED / PENDING SEPARATE LANE |

Original `pur_01M48PSSTDQDR4VGPAQPC2VRYZ` was not read, mutated or retried by these tests.
Its retained evidence says one Pay, no confirmed order/receipt, unresolved/held reservation,
and no Cardano transaction in that run. No provider payment success is inferred from zero orders.
E2E ledger, Global evidence, COMPLETED_LANES, CARDANO_FIX, SOLANA_FIX and SOLANA_LIVE.json
are byte-for-byte retained from their authoritative source heads. Historical local-verification
reports remain history; this report records the integrated gate.

## Installation, migrations and runtime

- Initial `npm ci`: PASS, 252 packages, no audit findings. Focused tests then exposed a missing
  optional `ws` peer imported by pinned Solana SDK Node modules (five suites could not load).
- `npm view ws version` returned 8.22.0; it satisfies SDK peer `^8.18.0`.
- `npm install --save-exact ws@8.22.0`, then **fresh `npm ci`**: PASS, 253 packages,
  254 audited, zero vulnerabilities. Existing Solana transitive optional TypeScript ^5 peer
  warnings remain with TypeScript 6; strict typecheck/build and all runtime regressions pass.
- `docker compose up -d postgres`, `docker compose ps`,
  `docker compose exec -T postgres pg_isready -U origins -d origins`: PASS, healthy local PG18.
- Created a uniquely owned empty local database using Compose `psql CREATE DATABASE`.
  Set only its local `DATABASE_URL`, ran `npm run db:migrate` twice, read schema_migrations,
  and dropped only that owned temporary database. Both runs PASS, exactly three rows.
- Fresh-schema/competing-startup/rerun/checksum-tamper tests also PASS.
- No migration numbering conflict; 0001/0002 unchanged; PostgreSQL-only config/runtime confirmed.

| Migration | Recorded SHA-256 checksum |
|---|---|
| 0001_initial.sql | 0b0c60b9a4802dd14079462d07ade84942e62f2ff30c0434d221725a57276255 |
| 0002_journal_truncate_guard.sql | 6eae5af236e97a9a10afe7e40797c05a69a0f200d5654d1d957dd86d7f143804 |
| 0003_shopify_shadows.sql | 6911f552a873c887f71463e035150c24557edead21600dc04a870cb64ed2b527 |

## Tests and checks

`npm run typecheck`: PASS. `npm run build`: PASS, including dist SQL migration copy.

Focused contract/Shopify command (the absent diagnostics-only filename matched no separate file;
diagnostic regressions live in shopify-browser.test.ts and shopify.test.ts and were included):

```powershell
npx vitest run tests/contracts tests/unit/shopify-browser.test.ts tests/unit/shopify-browser-diagnostics.test.ts tests/unit/shopify.test.ts tests/unit/shopify-global-catalog.test.ts tests/unit/shopify-shadow-admin.test.ts tests/integration/shopify-global-sandbox.test.ts
```

PASS **241/241**, eight files. Remaining focused command:

```powershell
npx vitest run tests/unit/cardano-adapter.test.ts tests/unit/cardano-binding.test.ts tests/unit/cardano-payer.test.ts tests/unit/cardano-sdk-roundtrip.test.ts tests/unit/solana-funding.test.ts tests/unit/solana-ledger.test.ts tests/unit/solana-sponsor.test.ts tests/integration/solana-funding.test.ts tests/integration/funding-recovery.test.ts tests/integration/scaled-settlement.test.ts tests/unit/settlement.test.ts tests/unit/atlas-executor.test.ts tests/unit/nuitee.test.ts tests/unit/ocbc-adapter.test.ts tests/unit/mcp-config.test.ts tests/unit/mcp-static.test.ts tests/unit/mcp.test.ts tests/unit/evidence-router.test.ts tests/unit/money-journal.test.ts tests/integration/postgres.test.ts tests/integration/safety-regressions.test.ts tests/integration/human-orchestration.test.ts tests/integration/spine.test.ts tests/integration/wiring.test.ts tests/unit/shopify-webhook.test.ts
```

Initially 432 passing tests/20 files and five import-blocked suites. After fresh-install fix:

```powershell
npx vitest run tests/unit/solana-funding.test.ts tests/unit/solana-ledger.test.ts tests/unit/solana-sponsor.test.ts tests/integration/solana-funding.test.ts tests/integration/wiring.test.ts
```

PASS **24/24**, five files. Final focused coverage: all 33 files, 697 tests passed.

**Full suite executed ONCE after fix**:

```powershell
npm test -- --maxWorkers=2 --no-file-parallelism
```

PASS **697/697, 33/33 files**, 53.68 seconds. Focused counts are subsets, not additional coverage.
Includes contracts/funding/provider/MCP/proof and PostgreSQL concurrency/idempotency/recovery.

- `node dist/scripts/db-smoke.js`: PASS. Fresh owned schema; compiled gateway twice;
  health/capabilities/inspect/proof/public script, anonymous 401, persisted authorized client,
  DB/pool/process restart and migration rerun. No provider credentials; owned schema cleaned.
- Compiled MCP smoke: SDK Client + StdioClientTransport launches `dist/src/channels/mcp/main.js`
  with only loopback gateway/dummy token-file configuration. Initialize, generic tool list and
  `find_offers` with incomplete retail intent -> non-error needs_input PASS. Zero gateway requests.
  Initial smoke supplied malformed `{}` without required category; corrected fixture only,
  no product change. Temporary file removed. Ignored helper: artifacts/pre-masumi/mcp-smoke.mjs.
- `npm run readiness` with provider/payer variables absent: informational PASS, all six
  components MISSING_CONFIG, Atlas gate disabled. No external readiness request made.
- Static UI sanity PASS: 21 nonempty files; nine WEBP headers/declared sizes; both prototype
  scripts parse; V2 verification JSON parses; local HTML links resolve. Candidate matches exact
  UI source bytes. No new visual render or runtime prototype integration claimed.
- `git diff --check`: PASS. Final historical integration diff/staged checkpoint also checked.
- Bounded credential/private-file scan: tracked UTF-8 text files <=1 MiB, binary files skipped,
  private-key/GitHub/OpenAI/Shopify/AWS/Slack/gateway-token/JWT patterns and private filenames.
  Final scan: 223 tracked files, 214 text files, zero findings; paths/line numbers only on
  findings, no secret values printed. Ignored local
  secrets/history were not copied or staged. This is a bounded scan, not proof of all secret shapes.

## Current disposition and promotion guard

Current classified issues/actions/deferral risks: [KNOWN_ISSUES](../KNOWN_ISSUES.md).
No outstanding local integration failure. Shopify unresolved paid/quote, protected checkout
lookup, Catalog retention, Atlas unknown-create, ChatGPT host and deployment config remain
Investigate Now. SG/UI/Masumi and larger scope remain parked/excluded; no production claim.
Source provenance and public examples are current; signer/private config stays separate.

Final gate requires clean integration worktree, bounded secret scan PASS, all source ancestry,
fresh fetch and main ancestor/no-unrelated-change guard. Push the candidate, then fast-forward
local main and push without force to that exact head. Verify main = origin/main = candidate.
No post-promotion feature implementation or deployment. Continue in a fresh chat from main.
