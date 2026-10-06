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
- SOLANA_FACILITATOR_TOKEN_FILE
- SOLANA_MAX_PAYMENT_BASE_UNITS

Separate payer/sponsor histories stay protected and outside the gateway.

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
- optional PAYER_BRIDGE_URL
- optional PAYER_BRIDGE_TOKEN_FILE
- optional MCP_HTTP_PORT

Stdio is the preferred local host mode. HTTP mode is loopback-only and unauthenticated inbound; do not expose it directly.

## Masumi/Sokosumi

Not integrated into main at this baseline. Keep its service/config separate until the lane is explicitly accepted and integrated.

## Render deployment

render.yaml points at main with auto-deploy off. Deployment has not occurred on this baseline.

Before deployment:
- verify secrets in Render rather than copying local env wholesale;
- use internal Render DATABASE_URL;
- set final PUBLIC_BASE_URL;
- verify Chromium runtime;
- verify provider/token readiness;
- never put Cardano/Solana signer private material on Render.
