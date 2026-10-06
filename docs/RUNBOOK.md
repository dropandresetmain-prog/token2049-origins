# Runbook — Capsule integrated baseline

Current authority: the integrated main baseline, including native Masumi. See [ACTIVE_TASK](work/ACTIVE_TASK.md), [current integration verification](work/MASUMI_INTEGRATION.md), [historical pre-Masumi verification](evidence/pre-masumi-integration.md) and [issue triage](KNOWN_ISSUES.md). Retained Cardano/Solana, Nuitée, Atlas and OCBC evidence passed within their stated limits. Shopify paid/Global exact quote and ChatGPT host remain unresolved or unverified. No provider/chain/payment/deployment action is authorized by local checks.

The native Masumi task service runs separately on loopback; startup/configuration is in [ENVIRONMENT](ENVIRONMENT.md#masumisokosumi). Its fee is separate from direct purchase principal. Public Sokosumi marketplace hosting/authentication/delivery remains unverified.

## Local runtime

Use Node 24 or later and one gateway process with one worker. The database contract is
`DATABASE_URL -> PostgreSQL`. Local development and automated integration tests use PostgreSQL.
Hosted runtime uses Render PostgreSQL. SQLite is not supported. PostgreSQL 18 matches Render's
current default. Planning sources under `docs/planning/` are historical snapshots for persistence choices.

```powershell
Set-Location C:\Dev\token2049-origins
npm ci
docker compose up -d --wait
$env:DATABASE_URL = 'postgresql://origins:origins_local_only@127.0.0.1:55432/origins'
npm run db:migrate
npm run typecheck
npm test
npm run build
npm run readiness
```

`readiness` is informational and exits zero even when configuration is missing. `npm run readiness -- --strict` requires every adapter to report `EXTERNAL_CHECK_PASSED`; that only proves the adapter's readiness probe, not paid commerce acceptance.

Copy `.env.example` to ignored `.env` and fill the gateway configuration privately. Neither npm scripts nor the application load dotenv automatically. Use Node's explicit environment-file flag:

```powershell
node --env-file=.env --import tsx src/main.ts
# Or, after build:
node --env-file=.env dist/src/main.js
```

`APP_ENV=production` is refused. `/health` proves process health. `/v1/capabilities` reports configuration/readiness without secrets. `/console/` is the customer and judge frontend (the Capsule console, `web/`); `/` and the earlier `/proof` page redirect there. `/inspect` retains engineering evidence. Both are public static shells: enter a customer token (`purchases:read` and `evidence:read`; `quotes:write` also shows price details) to load owner-scoped same-origin data. No private data or token is embedded or persisted in browser storage; clear the session when finished. A key with `operator:read` (the operator role) also gets read-only **Treasury** and **Connections** screens in the console: stored treasury figures and OCBC sandbox observations with adapter readiness. They call only GET endpoints and never trigger a bank refresh; see `docs/contracts/CONSOLE_CONTRACT.md`.

## Human demo flow

1. Submit the known intent fields. On 422 `needs_input`, ask only for the listed canonical fields,
   merge the answer in the host agent and retry. Unknown or malformed values are ordinary validation
   failures. Ask the user for synthetic fulfillment in sandbox; never fabricate demo values.
2. Search, collect required fulfillment and create the exact quote. Present commercial total,
   terms/expiry, available funding options and the separate 1:1000 testnet obligation.
3. Ask the human to select one quote-scoped `fundingOptionId`, then explicitly approve exact terms
   and that payment choice. Submit `{quoteId,approval:{maxTotal,quoteDigest,selectedFundingOptionId}}`.
   No default Cardano choice exists. Missing/blocked rails are omitted. A zero-option quote cannot buy.
4. For automatic MCP payment, the separate protected payer bridge must implement authenticated
   `GET /status` and report a matching configured public source. Its identity display is not a balance
   check. An old/unreachable/mismatched bridge blocks creation safely; do not fall back to another rail.
   Without a bridge, show external payment instructions. Payer secrets stay only in the signer process.
5. Follow the same purchase with `get_purchase`. Repeated buy follows matching approval and never
   sends another payment. An operator resolves an actual payer refusal on that same purchase through
   the bounded payer/recovery workflow; repeating buy is not a retry-spending instruction.
6. Open `/proof`, authenticate with evidence scope and select the purchase. Refresh progress as needed.
   Verify that pending steps remain pending, the merchant environment is labelled and receipt
   limitations are visible. Expand technical evidence only when needed.

This integration runs local regressions only. Preserve original unresolved Shopify purchase pur_01M48PSSTDQDR4VGPAQPC2VRYZ: no new Pay, mutation or replacement purchase. The next final review is a later Astra review+fix after all final lanes are integrated.

## Clients and funding authority

Create an MCP customer client first, then a separate payer client for the SAME returned customer ID. Tokens are written to ignored `data/clients/*.token`, never printed.

```powershell
node --env-file=.env --import tsx scripts/create-client.ts --name "Demo MCP" --channel mcp
node --env-file=.env --import tsx scripts/create-client.ts --name "Demo payer" --channel http --role payer --customer cus_REPLACE
node --env-file=.env --import tsx scripts/create-client.ts --name "Operator" --channel console --role operator
```

The default MCP client has offers/quotes/purchase/evidence scopes and lacks `purchases:fund`. The payer role has only purchase read/fund. The operator role has read/evidence/operator scopes. A role is provisioned locally, never accepted from a caller's request body. Custom `--scopes` overrides the default; avoid write-only clients because purchase idempotency retries currently also require read scope.

Copy `.env.payer.example` to ignored `.env.payer` for the separate payer process. Set token-denominated limits for the scaled settlement total (principal plus fee), daily/cumulative caps, per-transaction ADA fee/output caps, an exact asset and payee, and one ABSOLUTE shared ledger path for all processes using the wallet. These example policy values do not authorize Atlas spending.

```powershell
node --env-file=.env.payer --import tsx clients/payer/wallet-generate.ts
# After funding the disposable wallet with Preprod tADA and exact SDK-supported tUSDM:
node --env-file=.env.payer --import tsx clients/payer/pay.ts --purchase pur_REPLACE
```

Wallet generation exclusively initializes both the new mnemonic and protected ledger, and prints only the public address and faucet references. PAYER_LEDGER_FILE is required and must be an absolute file path. Pay/bridge startup and every payment refuse missing or corrupt history. If a wallet exists but its ledger disappeared, stop and reconcile history; never initialize an empty replacement to regain budget. Protect mnemonic, token and ledger files with OS access controls; mode 0600 alone is not a Windows ACL guarantee. Never load `.env.payer`, mount wallets, or import `clients/payer` into the gateway.

The payer first requests the x402 challenge, verifies the structured scaled_testnet policy, exact commercial/chain arithmetic, decimals, network/asset/payee/amount/quote policy, signs once, persists its signing/payment ledger and retries the exact payload. The transaction includes metadata label 2049 committing to the resource, purchase, quote, digest, expiry, network, asset, amount and treasury. A vanilla x402 signer without this commitment is unsupported. Details are in [Cardano protocol](evidence/cardano-protocol.md).

For MCP automation, create a private bridge-token file independently of the gateway token, set the SAME token-file path for bridge and MCP, and launch:

```powershell
node --env-file=.env.payer --import tsx clients/payer/bridge.ts
node --env-file=.env.mcp --import tsx src/channels/mcp/main.ts
```

Use `.env.mcp.example` for the MCP process. Gateway destinations require HTTPS except exact loopback HTTP. The payer bridge is loopback-only and exposes authenticated `POST /pay` with a purchase ID; it does not accept caller-selected payee or amount. Redirects are refused. MCP defaults to stdio; optional `MCP_HTTP_PORT` binds only loopback. With no bridge, `buy` returns an action-required funding result.

## Provider gates

| Provider | Required gate and truthful completion |
|---|---|
| Shopify | Own dev store, Storefront token, Admin read credentials, browser executable, explicit dev-store/Bogus flags. Synthetic Test Buyer / example.com identity only. Cart quote includes delivery and tax. Durable `pay_click` precedes the browser click. Independent Admin readback must bind the quote nonce and show `test=true`, `PAID`, successful Bogus SALE/CAPTURE and exact presentment amount. No Admin mark-paid/order-create path exists. |
| Atlas | Approved sandbox host and credentials. `ATLAS_ALLOW_TEST_BALANCE_PAYMENT` stays false until explicit founder approval of the sandbox test-balance exception. Closed gate permits search but refuses executable quotes, creation of funding requirements and provider writes before holds/passenger submission. Only explicit zero transaction fees are supported before payment, including final readback. A hold is unpaid. Paid ticketing remains distinct from ticketed. Test-balance usage consumes synthetic capacity and never creates a card liability. |
| Nuitée | Confirmed `sand_` sandbox key. Unknown/production prefixes are blocked. ACC_CREDIT_CARD payment is provider-simulated. Independent GET readback must bind booking ID, client reference, hotel ID, sandbox flag, paid status and exact amount. Ambiguous HTTP 408/5xx cannot release exposure. |
| OCBC | Application credentials and API subscriptions; customer session where needed. Only token mint and read-only observations. Historical sandbox data is labelled; no observation changes journal or capacity. Card resource contracts remain externally unverified. |

For local Shopify browser setup, install the pinned Playwright Chromium with `npx playwright-core install chromium`, obtain its executable path from `chromium.executablePath()`, and set `SHOPIFY_BROWSER_EXECUTABLE`. Live selectors, shipping/tax behavior and permissions still need external verification; do not bypass CAPTCHA or OTP.

The signature-verified Shopify route is `POST /v1/webhooks/shopify`, mounted before global JSON parsing. Exact bytes, shop domain, topic and delivery ID are validated. Payload payment claims are discarded. A delivery only durably schedules independent readback; duplicates never post money.

## Evidence and recovery

Customer routes `GET /v1/evidence/purchases` and `/purchases/:id` require `evidence:read` and customer ownership. Treasury, bank and `POST /v1/evidence/bank/refresh` require `operator:read`. Raw provider prose, fulfillment, tokens and checkpoints are private. Receipt/result provenance overrides environment inference; `executionEvidenceStatus` distinguishes quote-only provenance from recorded execution evidence.

Before facilitator settlement, the core persists a candidate hash, frozen funding resource identity and read-only recovery job. Proven pre-settlement failures permit retry; once settlement may have started, new transfers are refused until recovery. Confirmation and candidate recovery continue hourly after the retry threshold, with manual-required events. Restart repairs absent jobs. Never retry a merchant side effect after an execution attempt has started: retrieve only.

Expiry releases unused merchant capacity but does not erase uncertain or confirmed crypto receipts. Confirmed funds arriving after expiry/closure become a customer-unapplied refundable obligation and never execute expired authority. Funds already applied to a failed/unexecuted purchase remain customer prepayment. Refund signing/payment is outside this lane; do not claim a refund was sent.

Wrong-currency, scale, amount or other financial anomalies retain exposure and require operator review. Later matching/cancelled responses cannot erase an earlier charge anomaly. Unknown outcomes must not be manually marked successful, released or re-spent. Preserve the database and sanitized provider evidence before investigation; no general operator mutation/mark-paid API is supplied.

The funding-attempt table is an additive startup schema change. Earlier local records lack the frozen resource URL and fall back to configured `PUBLIC_BASE_URL`; preserve their original origin for recovery. New records retain their original cryptographic resource identity across origin changes. Unfunded old-origin purchases should be re-quoted after a deployment-origin change; the payer rejects a mismatched resource.

A stale payer ledger lock or signing record needs manual chain/ledger reconciliation before repair. Never delete a lock or signing record merely to retry spending. Use a consistent PostgreSQL logical backup (pg_dump) before schema/deployment changes. Preserve journal and recovery data; the free Render plan has no managed backups.

## Database operations

Compose exposes PostgreSQL only on loopback port 55432. The named volume persists local development
state across app/DB restarts. Credentials in compose.yaml are local-only and must never be used on Render.

```powershell
# Start / health
docker compose up -d --wait
docker compose ps
# Stop, preserve data
docker compose down
# Destructive LOCAL reset: removes only this Compose project's database volume
docker compose down --volumes
docker compose up -d --wait
npm run db:migrate
# Migration rerun and compiled runtime/auth/restart probe
npm run db:migrate
node dist/scripts/db-smoke.js
# Focused checks (all use real local PostgreSQL)
npm run test:integration -- tests/integration/postgres.test.ts tests/integration/spine.test.ts tests/integration/funding-recovery.test.ts
```

Commands assume the local DATABASE_URL above is present. Source migrations are ordered SQL files in
`src/migrations/`; the build copies them to `dist/src/migrations/`. Startup awaits the migration lock,
checks the applied history/checksums, and runs missing migrations in a transaction. Unknown versions,
changed applied files or out-of-order history fail startup. There is no startup reset/down migration.
Append new numbered files; never edit a file already applied to a database.

Amounts remain exact integer strings handled with BigInt. A five-connection pg pool binds each async
transaction to one connection; nested operations use savepoints. Short core write transactions share
an advisory lock to preserve multi-table capacity/journal/event invariants. Provider calls remain outside
transactions. Job claims use row locks with FOR UPDATE SKIP LOCKED; workers respect unexpired leases,
fence job completion/rescheduling by owner and claim attempt, and serialize provider work per purchase.
Funding verification has a separate per-purchase session lock; lock holders reuse the same connection.
Persisted started attempts reconcile by readback after restart and never repeat provider execution.
This preserves one-worker operations; it is not an HA or distributed-worker launch.

Each test fixture owns a random `test_<uuid>` schema. Tests can run files concurrently without truncating
shared tables. Restart tests reuse their own schema. The crash test terminates only its registered pool's
sessions, using its unique application_name, then verifies readback recovery. Crashed test runs can leave
schemas; use the explicit local reset only when local development data is disposable. Do not point the
suite at Render or a production database.

## Container and Render

```powershell
docker build -t t2o-commerce-postgres .
# Join the Compose network to reach the database by its service name.
# Only DATABASE_URL differs from the host-local .env example; no database volume belongs to the gateway.
docker run --rm --network token2049-origins_default --env-file .env -e APP_ENV=sandbox -e HOST=0.0.0.0 -e DATABASE_URL=postgresql://origins:origins_local_only@postgres:5432/origins -p 127.0.0.1:8787:8787 t2o-commerce-postgres
```

The gateway image still runs as node with the pinned Chromium installation and excludes the payer.
Client provisioning writes a token file locally; the client record lives in PostgreSQL. Export token files
privately before an ephemeral container exits. Source execution: `npm run client:create`; compiled tool:
`node dist/scripts/create-client.js`. Both use the same DATABASE_URL as the gateway.

Provisioned database (2026-10-06): **token2049-origins-db**, service ID
`dpg-db29mujncjis73dtvf70-a`, Singapore, PostgreSQL 18, **free ($0)**, expires
**5 November 2026 at 14:55 Singapore time**. Storage is 1 GB, with no managed backups.
Verified TLS SQL connection, migrations and isolated non-sensitive application write/read: PASS.
External access was restricted to a temporary single-host rule for verification, then changed to
`127.0.0.1/32` (no reachable external client). Same-region Render services can still use the private URL.
Existing Tencent services were inspected only and were not modified.

`render.yaml` is a prepared gateway template, not a deployment. It does not create another database.
For the later authorized deployment, select Singapore and privately set DATABASE_URL to this database's
**internal** connection URL in the Render service secret environment. Set the actual PUBLIC_BASE_URL and
other authorized gateway secrets separately. Auto-deploys are off. Do not sync/deploy this Blueprint as
part of database migration. No gateway secret environment exists yet; credentials were used only in
process memory for SQL verification, never printed or saved in Git/local connection files.

For maintenance from outside Render, temporarily allow only the maintainer's exact public IP, use the
external URL with `sslmode=verify-full`, and restore the restrictive rule afterwards. Never disable TLS
certificate verification or open an all-IP database rule. Before the free database expires, export data
or explicitly authorize an upgrade; this lane authorizes no paid plan.

Official sources: [Postgres creation/connections](https://render.com/docs/postgresql-creating-connecting),
[free database limits](https://render.com/docs/free), [Blueprint fields](https://render.com/docs/blueprint-spec).

## Demo settlement policy

The hackathon demo uses a disclosed **1:1000 notional scale** for public-testnet stablecoins:
USD 183.40 commercial principal -> 0.183400 tUSDM on Cardano Preprod (183,400 base units at 6 decimals).
These test assets have no real-world value. This is a testnet notional scale, not an FX rate.
The chain transfer demonstrates payment authorization, amount binding, transaction settlement,
purchase gating and reconciliation. It does not prove USD redemption, crypto-to-fiat conversion,
Visa settlement, bank settlement or equivalent economic value. Provider sandbox commerce continues
at its full commercial test amount. SERVICE_FEE_BPS remains 0 by default; a configured non-zero fee
uses the same scale as principal.

Canonical secret-free scenario data: [demo/demo-data.json](../demo/demo-data.json), validated by
[src/demo/config.ts](../src/demo/config.ts). Runtime endpoints, secrets, exact asset identities,
protocol constants and independent signer/security caps remain runtime configuration or code.
See [current settlement decision](decisions/scaled-testnet-settlement.md).

## Payer limits and operational errors

Example six-decimal asset limits: 500000 per payment (0.500000), 1500000 cumulative (1.500000),
1000000 per UTC day (1.000000). These are independent token safety caps, not USD balances. They
correspond to commercial notional ceilings of 500/1500/1000 USD under the fixed scale, including fees.
Keep one absolute protected ledger path shared by CLI and bridge. POSIX mode 0600 remains best effort;
apply Windows ACLs. Setup refuses existing wallet/ledger files, and never resets old spend history.

Worker tick/job failures emit sanitized worker.error events with stage, optional jobId and whitelisted
SQLSTATE/system errorCode. Messages/SQL detail/provider bodies are omitted. Durable retries/recovery
are unchanged. PG-1 lease renewal stays parked.

## Current Shopify architecture

Both paths use the same current ShopifyExecutor, hosted exact quote, browser execution and
independent Admin readback. Controlled-catalog discovery selects a Capsule product directly.
Opt-in discovery: live uses official Global Catalog/UCP, normalizes a reduced sourceOffer,
then creates/reuses one durable Capsule shadow per selected offer. Publication and Storefront
readback precede the exact quote; source and sandbox evidence remain distinct. The source
merchant receives no order or payment. Ordinary discovery excludes retained audit shadows.

Configure SHOPIFY_SANDBOX_PUBLICATION_ID only for the live-shadow path, alongside owned-store
credentials/dev-store/Bogus gates. Live mode is USD, quantity one, source item at most USD 100.
The mapping survives ambiguous create/publication via native identity readback and migration
0003_shopify_shadows.sql. Quote retries reuse frozen fulfillment/terms; changed/expired terms
require new discovery. There is no parallel Global purchase contract or Shopify-only MCP API.

Read-only hosted quote freezes settled item/shipping/tax/total before approval or funding,
with no card entry or Pay checkpoint. Execution rechecks cart/address/full breakdown,
shipping settlement, PCI allow-list and Bogus gateway before a normal actionable Pay click.
No force click. The durable pay_click precedes the one submission; passive diagnostics run
before cleanup on unknown outcome. Unknown payment remains unresolved with held exposure.

Admin `read_orders` scope alone is insufficient: configure **Protected customer data** for the
commerce app in Shopify Partners > API access requests. Our verification query does not require
the optional customer name, email, phone or address fields. Shopify permits development-store
access after saving the data-use declaration, without an App Store review. Verify against an
existing test order: an empty orders response can conceal missing Order-object access.
See [Shopify protected-data requirements](https://shopify.dev/docs/apps/launch/protected-customer-data).
An access-denied readback after Pay requires fixing access and reconciling that same purchase,
never another checkout submission. The dedicated local `shopify-reconcile-acceptance.ts` harness
allows only Admin order queries and recovery of the retained acceptance purchase.

The corrected deterministic US/NY checkout produced paid test order #1001 at USD 17.95;
independent Admin reconciliation issued its receipt with local fixture funding. Global
discovery/shadow/publication and exact USD 89.95 free-shipping quote now pass, but no paid
Global acceptance was run. Historical unknown submissions remain unknown; do not retry them.
These results do not establish chain funding, other providers or hosted deployment.
See append-only [E2E ledger](evidence/e2e-acceptance-log.md) and
[Global evidence](evidence/shopify-global-sandbox-e2e.md). Do not rerun their paid harnesses.

## Configuration and later deployment

Use DATABASE_URL and BLOCKFROST_PROJECT_ID. Do not load obsolete variable aliases.
The intended Render Storefront profile uses SHOPIFY_STOREFRONT_TOKEN. Leave the optional
private delegate unset; there is no delegate mint/refresh lifecycle. Admin credentials
refresh their own readback token separately. SHOPIFY_STOREFRONT_BUYER_IP, if supplied,
must be the actual egress address. Throttling calls for bounded backoff, not repeated carts.

The prepared render.yaml targets main with automatic deploys off. Actual deployed token,
public origin, database, browser architecture, US market and rail readiness are unverified.
No deployment occurs here. Any later deployment must use its authorized exact main head,
private DATABASE_URL and correct PUBLIC_BASE_URL before creating funding commitments.
The recorded Render DB expiry above is historical metadata; recheck before using that service.

## Solana and retained provider evidence

.env.example contains receive-only Solana Devnet configuration. .env.solana.example also
contains separate payer/sponsor key paths and caps; do not load signer keys into the gateway.
Run payer/sponsor independently only in a later authorized spending task. Authenticated
/prepare and the supplied payer are required; stock-client compatibility is unverified.
Preserve existing signer histories; never reset locks/caps to gain spending headroom.
Cardano supplied signer requires canonical quote metadata. Its recorded budget is exhausted.

[Completed lanes](work/COMPLETED_LANES.md) retains Cardano/Solana independent testnet proofs,
Nuitée USD 96.24 including processing fee, Atlas sandbox ticketing and OCBC corrected history
observations. Atlas ambiguous-create recovery remains NOT_VERIFIED. The Atlas payment gate
still defaults false; prior test evidence does not authorize a new booking. OCBC is read-only;
bank observations do not modify journal/capacity. No provider readiness or receipt means
production readiness or real bank/card settlement.

## MCP, UI and verification

Generic find_offers/create_quote/buy/get_purchase remain thin over canonical HTTP/core.
needs_input, selected funding option, public payer identity, duplicate suppression and F-1
follow-existing-purchase guidance are retained. Compiled stdio/protocol tests do not establish
ChatGPT host compatibility. UI V3, DESIGN.md and approved logos are design references only;
existing runtime proof/inspect behavior remains in place.

Use the local fixture suites and compiled db-smoke against local PostgreSQL only. Full suite
is run once for the final gate after focused fixes. Informational readiness with no provider
credentials reports MISSING_CONFIG, not external success. See TEST_CHECKLIST and the recorded
integration verification for commands/results. No .env/private history is copied or committed.
