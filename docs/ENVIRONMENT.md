# Capsule environment and external services

Baseline: main @ 8a76225364bf3b56fe2bf192297ee17b86d8f540

This document names required configuration groups and verified service status. It contains no secrets.

## Runtime

- Node.js: 24+
- TypeScript: strict, current pinned project version
- HTTP: Express
- Database: PostgreSQL 18
- Local DB: Docker Compose, loopback
- Hosted DB: Render PostgreSQL, Singapore
- Browser: Playwright Chromium
- Runtime mode for hackathon: sandbox/testnet only; production mode is refused.

## Database

Required:
- DATABASE_URL

Do not use DATABASE_PATH; SQLite is unsupported.

Migrations:
1. 0001_initial.sql
2. 0002_journal_truncate_guard.sql
3. 0003_shopify_shadows.sql

Recorded Render DB:
- name: token2049-origins-db
- region: Singapore
- free plan recorded during provisioning
- recorded expiry: 5 Nov 2026 14:55 Singapore
- no managed backups on the recorded free plan

Recheck live metadata before depending on the recorded expiry.

## Gateway core

Important names:
- APP_ENV
- HOST
- PORT
- PUBLIC_BASE_URL
- QUOTE_TTL_SECONDS
- OFFER_TTL_SECONDS
- DEMO_PER_PURCHASE_LIMIT_USD_MINOR
- SIMULATED_CARD_CAPACITY_USD_MINOR
- SERVICE_FEE_BPS
- WORKER_INTERVAL_MS

PUBLIC_BASE_URL must be final before creating funded quotes because the funding resource is bound into the immutable requirement.

## Cardano Preprod

Gateway/verifier variables:
- CARDANO_NETWORK
- CARDANO_FACILITATOR_URL
- CARDANO_TREASURY_ADDRESS
- CARDANO_ASSET_UNIT
- CARDANO_ASSET_DECIMALS
- BLOCKFROST_PROJECT_ID
- BLOCKFROST_BASE_URL

Do not use the historical alias CARDANO_PROVIDER_PROJECT_ID.

Separate payer variables live outside the gateway, including mnemonic file, absolute payer ledger, caps, allowed asset and expected payee.

Recorded evidence: real Preprod funding/recovery passed. Preserve protected history; existing shared budget/history must not be reset.

## Solana Devnet

Gateway variables:
- SOLANA_NETWORK
- SOLANA_RPC_URL
- SOLANA_USDC_MINT
- SOLANA_ASSET_DECIMALS
- SOLANA_TREASURY_ADDRESS
- SOLANA_TREASURY_TOKEN_ACCOUNT
- SOLANA_FEE_PAYER_ADDRESS
- SOLANA_FACILITATOR_URL
- SOLANA_FACILITATOR_TRUSTED_ORIGIN — optional; one exact HTTPS origin for a hosted gateway
- SOLANA_FACILITATOR_TOKEN_FILE
- SOLANA_MAX_PAYMENT_BASE_UNITS

Separate payer/sponsor histories stay protected and outside the gateway.

Loopback HTTP remains supported. Remote facilitator URLs require the matching explicitly configured
HTTPS origin, without credentials, paths, query or fragment. Redirects are rejected for supported,
verify and settle. Provision only the bearer token as a Render secret file at
`/etc/secrets/solana-facilitator-token`; never provision payer/sponsor keys or histories there.
The facilitator still listens on 127.0.0.1; `SOLANA_FACILITATOR_LISTEN_PORT` selects its local port
when its advertised URL is HTTPS. Payer and facilitator configuration must pin that same origin.

Recorded evidence: finalized Devnet funding/recovery passed.

## Shopify

Required controlled-store config:
- SHOPIFY_STORE_DOMAIN
- SHOPIFY_API_VERSION
- SHOPIFY_STOREFRONT_TOKEN
- SHOPIFY_CLIENT_ID
- SHOPIFY_CLIENT_SECRET
- SHOPIFY_STORE_PASSWORD
- SHOPIFY_DEV_STORE_CONFIRMED
- SHOPIFY_BOGUS_GATEWAY_ENABLED
- SHOPIFY_BROWSER_EXECUTABLE
- SHOPIFY_HEADLESS

Optional/current:
- SHOPIFY_STOREFRONT_BUYER_IP — only actual egress IP, never invented
- SHOPIFY_SANDBOX_PUBLICATION_ID — required for Global Catalog selected-offer shadows

Render profile uses public Storefront auth; do not depend on a short-lived local delegate token.

Known bounded demo market: USD/US synthetic buyer. Singapore sellability remains unsupported.

## Atlas

- ATLAS_BASE_URL
- ATLAS_CLIENT_ID
- ATLAS_CLIENT_SECRET
- ATLAS_ALLOW_TEST_BALANCE_PAYMENT

Keep payment flag false unless explicitly authorized for the sandbox test-balance path.

Recorded evidence: sandbox payment/ticketing passed; ambiguous-create recovery not verified.

## Nuitée / LiteAPI

- NUITEE_API_KEY
- NUITEE_SEARCH_BASE_URL
- NUITEE_BOOKING_BASE_URL

Recorded evidence: sandbox booking/readback passed; final USD 96.24 included processing fee for the tested method.

## OCBC

- OCBC_API_CLIENT_ID
- OCBC_API_CLIENT_SECRET
- OCBC_API_BASE_URL
- OCBC_API_CALLS_PER_MINUTE
- OCBC_SANDBOX_SESSION_TOKEN where needed

Read-only observation only. Never treat OCBC snapshots as purchase settlement/capacity truth.

## MCP

MCP process:
- GATEWAY_URL
- GATEWAY_TOKEN_FILE
- optional CARDANO_PAYER_BRIDGE_URL + CARDANO_PAYER_BRIDGE_TOKEN_FILE (legacy alias PAYER_BRIDGE_URL/PAYER_BRIDGE_TOKEN_FILE = Cardano only)
- optional SOLANA_PAYER_BRIDGE_URL + SOLANA_PAYER_BRIDGE_TOKEN_FILE
- optional MCP_HTTP_PORT

Each URL/token pair is all-or-nothing, must be loopback, and the two rails must use different URLs. The Solana bridge process reads SOLANA_PAYER_BRIDGE_TOKEN_FILE and optional SOLANA_PAYER_BRIDGE_PORT (default 8789) plus the existing SOLANA_PAYER_* configuration (`npm run payer:solana:bridge`).

Stdio is the preferred local host mode. HTTP mode is loopback-only and unauthenticated inbound; do not expose it directly.

## Masumi/Sokosumi

The native service-fee/task runtime is integrated as a separate loopback process. It does not provide merchant purchase-principal funding or establish an actual Sokosumi marketplace listing.

Use `.env.masumi.example` for the required variables. Inject secrets privately; reuse the existing native registry, selling identity, database and recovery history. Public fee/identity/contract terms are frozen for each durable job store; configuration repricing fails startup while credential rotation is allowed. Keep MPS administration and signer material private.

```powershell
node --env-file=.env.masumi.local --import tsx src/channels/sokosumi/main.ts
```

With variables already in the process environment, `npm run channel:masumi` launches the same runtime. The gateway remains a separate process. Platform-to-agent authentication, a public TLS endpoint and approved listing metadata are still unverified; local account API authentication does not establish those boundaries.

## Render deployment

render.yaml points at main with auto-deploy off. The 7 October rehearsal is live from the isolated
`codex/render-rehearsal-solana-https` branch at `https://token2049-origins.onrender.com`; that same
HTTPS origin is frozen as PUBLIC_BASE_URL. Solana is deliberately disabled pending a trusted tunnel.
See [deployment evidence](evidence/render-rehearsal.md) for exact SHA, readiness and limitations.

Before deployment:
- verify secrets in Render rather than copying local env wholesale;
- use internal Render DATABASE_URL;
- set final PUBLIC_BASE_URL;
- verify Chromium runtime;
- verify provider/token readiness;
- never put Cardano/Solana signer private material on Render.
