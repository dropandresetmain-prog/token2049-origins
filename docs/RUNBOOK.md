# Runbook — Commerce Core

This branch implements the local first lane. Real Cardano funding and provider acceptance remain blocked; see [ACTIVE_TASK](work/ACTIVE_TASK.md) and [local verification](evidence/local-verification.md). Configuration or a passing fixture never proves an external purchase.

## Local runtime

Use Node 24 or later and one gateway process with one worker. The database contract is
`DATABASE_URL -> PostgreSQL`. Local development and automated integration tests use PostgreSQL.
Hosted runtime uses Render PostgreSQL. SQLite is not supported. PostgreSQL 18 matches Render's
current default. Planning sources under `docs/planning/` are historical snapshots for persistence choices.

```powershell
Set-Location C:\Dev\token2049-origins\external-acceptance-hardening
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

`APP_ENV=production` is refused. `/health` proves process health. `/v1/capabilities` reports configuration/readiness without secrets. `/proof` is the customer/judge view; `/inspect` retains engineering evidence. Both are public static shells: enter a customer `evidence:read` token to load owner-scoped same-origin evidence. No private data or token is embedded or persisted in browser storage; clear the session when finished.

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

This branch remains review-gated. No Shopify rehearsal, provider/payment call, testnet transaction or
deployment is authorized by local verification. Atlas stays disabled; IN-1/IN-2/IN-3 remain blockers.

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

Shopify IN-1 hosted-field allow-list/forced pay click must be investigated in the later UNFUNDED live
rehearsal. Atlas IN-2 ambiguous pay.do and IN-3 final-fee readback remain payment-acceptance blockers;
the provider table is not external acceptance proof. Do not enable Atlas to bypass these blockers.

## Current Capsule E2E candidate — 2026-10-06

This section supersedes the earlier Shopify IN-1 rehearsal instruction for this E2E. The production
Storefront cartCreate path now creates an exact quote by observing the settled hosted checkout before
approval or funding. Quote observation fills the approved synthetic buyer/address and selects shipping,
but enters no card data and has no payment checkpoint. It freezes item/shipping/tax/total and the
post-observation cart binding. The later execution browser rechecks the full breakdown and cart before
its one durable pay_click boundary. API estimated totals or missing tax alone never authorize payment.

The US/NY Agent Commerce Test Tee rehearsal reached REHEARSAL_STOPPED_BEFORE_PAY_CLICK with USD 17.95
(9.95 item + 8.00 Standard shipping + 0.00 checkout-balanced tax), hosted frames on
checkout.pci.shopifyinc.com and normal Pay now actionability. Independent Admin readback found zero new
orders. This is unfunded evidence, not a paid E2E result. Use a fresh deployed quote; never hardcode or
reuse the local total. SG sellability remains deferred. See the append-only E2E ledger.

Deployment preparation is authorized; merge and deploy require approval of the exact tested SHA.
render.yaml now targets main in Singapore, APP_ENV=sandbox, with automatic deploys off. Fast-forward
only to the approved candidate and verify Render deployed that commit. The existing separately
provisioned Singapore database must use DATABASE_URL with its internal connection URL; DATABASE_PATH
is obsolete. Set PUBLIC_BASE_URL to the actual final HTTPS service host before creating approvable
quotes: funding commitments bind that URL.

The intended Storefront deployment profile uses SHOPIFY_STOREFRONT_TOKEN (public authentication).
Leave SHOPIFY_STOREFRONT_PRIVATE_TOKEN unset; the local delegate inherits a short parent lifetime and
the runtime has no delegate mint/refresh lifecycle. A read-only public-auth search independently found
the canonical live variant at USD 9.95. This proves current catalog access, not deployed cart/browser
readiness or permanent validity. Verify deployed authentication and one-cart behavior before funding;
never probe cartCreate repeatedly. Shopify may throttle public-auth traffic; use existing bounded
backoff, then a quiet window and one clean retry. Do not invent a forwarded buyer IP.

SHOPIFY_CLIENT_ID/SHOPIFY_CLIENT_SECRET independently mint and refresh the Admin readback token in
memory. That refresh does not extend a Storefront delegate. Storefront requests require product-listing
and checkout read/write access; independent Admin order readback requires read_orders. The provisioning
app already has broader scopes; do not expand them during the E2E. Confirm actual granted scopes and
minimize them after acceptance. SHOPIFY_STORE_PASSWORD is a gateway secret. Confirm the owned dev
store and Bogus gateway before setting their confirmation flags true. Chromium comes from the image's
SHOPIFY_BROWSER_EXECUTABLE default; never copy a local Windows executable path into Render.

Receive-only verifier names are CARDANO_NETWORK=cardano:preprod, CARDANO_FACILITATOR_URL,
CARDANO_TREASURY_ADDRESS, CARDANO_ASSET_UNIT, CARDANO_ASSET_DECIMALS=6 and BLOCKFROST_PROJECT_ID
(not the old CARDANO_PROVIDER_PROJECT_ID alias). Verify the exact tUSDM asset, treasury, facilitator
support and independent Preprod readback after deployment. Only ready funding rails may appear.
The payer wallet, keys, mnemonic, bridge credentials and spend ledger stay local in their separate
process; none belongs in the gateway image or Render environment. Keep Atlas payment disabled.

Stop after deployed health/migrations, Shopify/Admin, Chromium, Cardano verifier and MCP readiness,
then wait at Human Checkpoint C. New quote/source approval and one funding attempt require the later
explicit checkpoints. Any ambiguous irreversible chain/order result stops writes and prohibits retry.

Provider references: [Storefront authentication](https://shopify.dev/docs/api/storefront/latest),
[delegate lifetime](https://shopify.dev/docs/apps/build/authentication-authorization/delegate-api-access),
[Admin access tokens](https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens).

## Shopify Global Catalog sandbox addition

Configure nonsecret `SHOPIFY_SANDBOX_PUBLICATION_ID` alongside existing owned development-store/Bogus configuration. Live discovery is opt-in typed `discovery: live`; no Catalog API key is required for the verified keyless UCP profile. Runtime caps USD100 item, quantity1; exact sandbox total remains subject to Capsule intent/approval. Product creation happens after selection only; products are retained for audit/demo.

[Lane decision](decisions/shopify-real-discovery-sandbox-execution.md) documents runtime scopes, migration0003 and boundary. [Protocol](evidence/shopify-protocol.md) contains the test-only unfunded harness command. [Evidence](evidence/shopify-global-sandbox-e2e.md) is PARTIAL: do not run a fresh paid test until original E2E outcome reconciliation completes. No production fixture toggle or real Cardano call exists in this lane.
