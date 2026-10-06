# Runbook — Commerce Core

This branch implements the local first lane. Real Cardano funding and provider acceptance remain blocked; see [ACTIVE_TASK](work/ACTIVE_TASK.md) and [local verification](evidence/local-verification.md). Configuration or a passing fixture never proves an external purchase.

## Local runtime

Use Node 24 or later and one gateway process with one worker and one persistent SQLite database. Do not run multiple writers or share the database across replicas. Planning sources under `docs/planning/` remain pinned.

```powershell
Set-Location C:\Dev\token2049-origins-core
npm ci
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

`APP_ENV=production` is refused. `/health` proves process health. `/v1/capabilities` reports configuration/readiness without secrets. `/inspect` is a public static shell: enter an appropriately scoped token there to load same-origin evidence. No private data or token is embedded or persisted in browser storage.

## Clients and funding authority

Create an MCP customer client first, then a separate payer client for the SAME returned customer ID. Tokens are written to ignored `data/clients/*.token`, never printed.

```powershell
node --env-file=.env --import tsx scripts/create-client.ts --name "Demo MCP" --channel mcp
node --env-file=.env --import tsx scripts/create-client.ts --name "Demo payer" --channel http --role payer --customer cus_REPLACE
node --env-file=.env --import tsx scripts/create-client.ts --name "Operator" --channel console --role operator
```

The default MCP client has offers/quotes/purchase/evidence scopes and lacks `purchases:fund`. The payer role has only purchase read/fund. The operator role has read/evidence/operator scopes. A role is provisioned locally, never accepted from a caller's request body. Custom `--scopes` overrides the default; avoid write-only clients because purchase idempotency retries currently also require read scope.

Copy `.env.payer.example` to ignored `.env.payer` for the separate payer process. Set a reviewed test-token principal budget, daily/cumulative caps, per-transaction ADA fee/output caps, an exact asset and payee, and one ABSOLUTE shared ledger path for all processes using the wallet. These example policy values do not authorize Atlas spending.

```powershell
node --env-file=.env.payer --import tsx clients/payer/wallet-generate.ts
# After funding the disposable wallet with Preprod tADA and exact SDK-supported tUSDM:
node --env-file=.env.payer --import tsx clients/payer/pay.ts --purchase pur_REPLACE
```

Wallet generation refuses to overwrite a mnemonic file and prints only the public address and faucet references. Protect mnemonic, token and ledger files with OS access controls; mode 0600 alone is not a Windows ACL guarantee. Never load `.env.payer`, mount wallets, or import `clients/payer` into the gateway.

The payer first requests the x402 challenge, verifies network/asset/payee/amount/quote policy, signs once, persists its signing/payment ledger and retries the exact payload. The transaction includes metadata label 2049 committing to the resource, purchase, quote, digest, expiry, network, asset, amount and treasury. A vanilla x402 signer without this commitment is unsupported. Details are in [Cardano protocol](evidence/cardano-protocol.md).

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
| Atlas | Approved sandbox host and credentials. `ATLAS_ALLOW_TEST_BALANCE_PAYMENT` stays false until explicit founder approval of the sandbox test-balance exception. Only explicit zero transaction fees are supported before payment, including final readback. A hold is unpaid. Paid ticketing remains distinct from ticketed. Test-balance usage consumes synthetic capacity and never creates a card liability. |
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

A stale payer ledger lock or signing record needs manual chain/ledger reconciliation before repair. Never delete a lock or signing record merely to retry spending. Back up SQLite consistently, including WAL state, before changing deployment or schema.

## Container

```powershell
docker build -t t2o-commerce-core .
docker run --rm --env-file .env -e APP_ENV=sandbox -e HOST=0.0.0.0 -e DATABASE_PATH=/data/gateway.db -e SHOPIFY_BROWSER_EXECUTABLE=/usr/local/bin/shopify-chromium -p 127.0.0.1:8787:8787 -v t2o-gateway-data:/data t2o-commerce-core
```

For a named-volume container, provision its clients against the database INSIDE that volume, rather than a separate host database. Run the compiled client tool with a writable working directory:

```powershell
# Use the actual running container name and the returned customer ID.
docker exec -w /data CONTAINER_NAME node /app/dist/scripts/create-client.js --name "Demo MCP" --channel mcp
docker exec -w /data CONTAINER_NAME node /app/dist/scripts/create-client.js --name "Demo payer" --channel http --role payer --customer cus_REPLACE
# Token files are at /data/data/clients/<client-id>.token; copy each privately to a protected host location.
```

The image installs Chromium without swallowing installation failures, runs as `node`, and excludes the payer client. `.env` is supplied at runtime, never copied into the image. Local Linux ARM64 image build, non-root browser launch, scoped auth and named-volume restart checks PASS; see [container verification](evidence/container-verification.md). No public deployment or live Shopify checkout was performed. Recheck the image and volume permissions for the actual deployment environment.
