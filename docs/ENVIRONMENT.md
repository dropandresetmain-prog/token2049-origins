# Capsule environment and external services

## Consolidated payer candidate configuration — 10 October 2026

Owner-authorized database migration: existing Render Free gateway and consolidated payer now use Neon Free PostgreSQL18.6, AWS Singapore, project `cool-paper-95079645`, authoritative branch `br-royal-leaf-b32j7xx6`. `DATABASE_URL` must use the direct endpoint (no `-pooler`) with `sslmode=verify-full`. Gateway origin, OAuth issuer/passcode, provider credentials, keys and Playwright remain unchanged. Gateway deployed consolidated revision `cb7b96e` (retaining the reviewed idle-aware worker) wakes committed local work immediately and polls an empty queue every30min; explicit `WORKER_INTERVAL_MS=1000` would defeat the Free budget. See [database migration record](architecture/NEON_DATABASE_MIGRATION.md).

Gateway: `MULTIWALLET_PAYER_URL`, `MULTIWALLET_PAYER_TOKEN_FILE`, `MCP_MULTIWALLET_GATEWAY_TOKEN_SHA256`. Consolidated mode rejects legacy bridge and payer-client hash configuration; remove `CARDANO_PAYER_BRIDGE_*`, `SOLANA_PAYER_BRIDGE_*`, `MCP_PAYER_GATEWAY_TOKEN_SHA256` and `MCP_SOLANA_PAYER_GATEWAY_TOKEN_SHA256` only during approved replacement. The dedicated funding client is `cli_HOSTEDMULTIWALLETPAYER`; revoked legacy client rows stay revoked.

Payer: `DATABASE_URL`, `MULTIWALLET_INSTANCE_ID`, `MULTIWALLET_ALLOWED_HOSTS`, `MULTIWALLET_PAYER_TOKEN_FILE`, `MULTIWALLET_SIGNING_ENABLED=false` is the release default. Approved deployed activation now uses `true` with exact instance `capsule_cb7b96e9e43a` and three matching canonical grants. Every registered private `signerRef` is an environment prefix: e.g. `DEMO_CARDANO_PAYER_CARDANO_MNEMONIC_FILE` supplies `PAYER_CARDANO_MNEMONIC_FILE` to that selected module. Preserve every module's existing public identity, policy and protected key-file configuration. Solana payer and gas sponsor keys remain separate. No gateway signer key.

Render-only `MULTIWALLET_RENDER_SECRET_FILES=true` stages only selected module signer files from controlled consolidated mounts into private runtime files while retaining identity/permission guards. Normal startup never runs the operator source list. Build uses `Dockerfile.multiwallet`; entrypoint is `dist/clients/multiwallet/hosted.js`. Migrations/imports/registration are explicit approved steps, never startup history replacement. Registration defaults to verification and inserts disabled sources only under `CAPSULE_APPROVED_REGISTRATION=true` plus `--apply`. Sui import defaults to offline verification; `--apply` also requires `CAPSULE_APPROVED_SUI_IMPORT=true` and a pinned protected manifest plus verified permanent Sui .retired/.lock fences before DB connection. scripts/sui/retire-history.ts defaults to offline verification; --retire requires CAPSULE_APPROVED_SUI_RETIREMENT=true and CAPSULE_BACKUP_RESTORE_VERIFIED=true after actual gate completion/quiescence. These flags do not replace owner authorization.

Retained source database expiry: `2026-11-05T06:55:54.699333Z` (5 Nov14:55:54 Singapore). Full protected initial/final backups and PG18 restore/hash verification passed. Original external restriction restored; source app role read-only. Source is retained, never a stale-history rollback destination. [Runbook](architecture/CONSOLIDATED_PAYER.md) owns cutover and retention. Historical environment notes below do not authorize redeployment or secret copying.


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

Migrations are the ordered immutable files in `src/migrations/`. The consolidated candidate adds `0011_registered_wallets.sql` and `0012_wallet_ledgers.sql` after the integrated Sui `0010_sui_funding_recovery.sql`. Existing deployed history must remain intact; authoritative migration execution requires owner approval.

Retained former Render DB (historical; Neon is authoritative):
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

Read-only 10 October metadata verifies the live gateway at known-good main
7c09b37eaaeda2bf3eec94fc1e3456118962f636, alongside separate Free Cardano/Solana services.
The consolidated branch remains undeployed; existing origin and provider/browser configuration stay fixed.
See [runtime/account evidence](architecture/RENDER_MULTIWALLET_RUNTIME_EVIDENCE.md).

Before deployment:
- verify secrets in Render rather than copying local env wholesale;
- use internal Render DATABASE_URL;
- set final PUBLIC_BASE_URL;
- verify Chromium runtime;
- verify provider/token readiness;
- never relocate existing signing material without explicit custody authorization; gateway must never hold payer keys.

## Owner-authorized cap alignment (11 October 2026)

Solana/Sui token per-payment/daily/cumulative caps match Cardano at5,100,000 base units; keep the1:1000 notional policy. Set gateway SOLANA_MAX_PAYMENT_BASE_UNITS/SUI_MAX_PAYMENT_BASE_UNITS accordingly. Selected payer prefixes DEMO_SOLANA/DEMO_SUI require matching per-payment, total, daily and commercial510,000minor-unit settings. SOLANA_PAYER_MAX_DAILY_BASE_UNITS is optional for historical configurations but explicitly required in this aligned demo. Gas/sponsor caps are unchanged. Apply audited0013 amendments with authority fenced; an env edit alone is rejected. See docs/architecture/PAYER_READINESS_REPAIR.md.
