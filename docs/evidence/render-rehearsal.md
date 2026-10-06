# Render rehearsal — 7 October 2026

Capsule is live on the existing Singapore Render workspace. This is a rehearsal, not a release freeze.
No provider purchase, funded quote, blockchain payment or new signing operation occurred.

## Deployment identity

- Fetched main/base: `26eabf86cc05bb7d9c1a7a4c93a638f4b561ec56`; main had not advanced.
- Branch: `codex/render-rehearsal-solana-https`; main was not changed.
- Deployed code SHA: `c2a6bf9626547bde5dde4357d9da0aa69d253a8d`.
- Service: `srv-db2jgqnavr4c73e9blrg`, free Docker web service, Singapore, one instance, auto-deploy off.
- Successful deploy: `dep-db2jjsuitv5s73c62bvg`; Render API reports `live`.
- URL and frozen `PUBLIC_BASE_URL`: `https://token2049-origins.onrender.com`.
- Live completion: 7 October 2026, 02:13 Singapore; smoke/readiness observed at 02:13–02:14.
- Subsequent evidence-only commits on the branch are not deployed code.

## Build, database and frontend

Render built the Docker image from the stated SHA. The gateway build now includes source and only
create-client, migrate, readiness and db-smoke operational scripts. Local acceptance scripts that
import test fixtures or signer clients are excluded from the gateway build. Docker context exclusions
also cover the Solana signer source and unrelated local worktrees/evidence directories.

The Docker final stage launched pinned Playwright Chromium as the runtime `node` user, opened
`about:blank` and closed successfully: `Chromium runtime-user smoke passed`. This is image-build
evidence using the final-stage OS, binary and user; a hosted checkout/browser session was not run.

Database: existing `token2049-origins-db`, `dpg-db29mujncjis73dtvf70-a`, PostgreSQL 18, Singapore,
available/free. Render environment inspection confirms DATABASE_URL uses the internal host
`dpg-db29mujncjis73dtvf70-a` and database `token2049_origins_db`. The external IP allowlist remains
`127.0.0.1/32`. No external database access was opened. Current migration files are
`0001_initial.sql`, `0002_journal_truncate_guard.sql`, `0003_shopify_shadows.sql`; no migration changed.
Successful gateway startup establishes completion of awaited database initialization, migration
history/checksum validation and startup schema work. Applied SQL rows were not separately queried.

Live HTTP results: `/health` 200, `/console/` 200, `/v1/capabilities` 200. Bundled JS/CSS served 200;
the browser rendered the Capsule access-key screen. This verifies the public console shell, not an
authenticated customer's data session. `HOST=0.0.0.0`, `PORT=8787`, `APP_ENV=sandbox`.

## Provider and rail readiness from the hosted gateway

| Integration | Observed result | Limit |
|---|---|---|
| Shopify | CONFIGURED_UNVERIFIED; missing=[] | Public Storefront credentials, Admin client credentials, browser path, dev-store/Bogus flags and Global publication `gid://shopify/Publication/230951092281` provisioned. Hosted catalog/exact checkout/paid readback not exercised. |
| Nuitée | EXTERNAL_CHECK_PASSED | Sandbox key accepted by read-only currencies probe; search/prebook/book not exercised. |
| Atlas | EXTERNAL_CHECK_PASSED | Sandbox search probe; payment gate explicitly false, so executable quotes and provider writes stay blocked. |
| Cardano | EXTERNAL_CHECK_PASSED | Hosted facilitator lists exact Preprod; independent Blockfrost Preprod reachable. No signing/payment. |
| OCBC | EXTERNAL_CHECK_PASSED | Token mint and corporate-account listing read passed; historical sandbox observations only. Card/transaction APIs not checked. |
| Solana | MISSING_CONFIG, intentionally disabled | No approved remote tunnel installed. |
| Masumi | MISSING_CONFIG, intentionally separate | Native task/service-fee runtime was not provisioned on the gateway. |

## Secrets and Solana topology

Only 34 explicitly selected gateway/core/provider environment variables were provisioned privately.
No local env file was uploaded. Legacy Blockfrost naming was reconciled using the already verified
Cardano gateway configuration. No Cardano/Solana payer key, sponsor key, mnemonic, ledger, payer
token or signer path was provisioned. Render environment inspection found no payer/sponsor/key-file/
mnemonic/ledger variable names. No Solana bearer token was uploaded because the rail remains disabled.

The implemented supported architecture is Render gateway → one explicitly pinned HTTPS origin →
authenticated tunnel → local 127.0.0.1 facilitator → Devnet. Remote HTTP, arbitrary HTTPS origins,
URL credentials/path/query/fragment and redirects are rejected. Bearer authentication and x402
prepare/verify/settle bodies remain intact. The sponsor still binds only to 127.0.0.1; an optional
SOLANA_FACILITATOR_LISTEN_PORT separates its local port from its advertised HTTPS URL.
Payer/sponsor policy, cryptographic checks, network/mint/payee rules and protected histories are unchanged.

Actual rehearsal topology: no hosted Solana connection and no new facilitator/tunnel process.
The existing unrelated named Cloudflare tunnel serves other applications and was not changed.
Automatic approval review rejected a separate Cloudflare quick tunnel because its random public
origin would exist before exact-origin trust was configured. The rejected action was not executed
or bypassed. Thus Render-to-authenticated-Solana-facilitator reachability is NOT_VERIFIED.
A dedicated stable HTTPS endpoint pinned before exposure remains the exact blocker.

## Checks and corrections

- Focused Solana funding/ledger/sponsor/transport checks initially passed 34 tests in four files.
- Full suite after final transport response validation: 793/793 tests, 39/39 files passed on local PostgreSQL only.
- Expanded real-redirect coverage for all three routes: final transport suite 16/16 passed.
- Final npm run typecheck, npm run build and git diff --check passed.
- Render Docker build and final-stage Chromium launch passed; final deployment is live.
- Initial stale Docker build failure was fixed by narrowing tsconfig.build.json.
- A first-page-only environment replacement temporarily omitted core variables; restored the complete
  allowlist and verified all 34 entries with explicit pagination limit. Startup failed before DB work.
- A local HOST override was corrected to 0.0.0.0; the superseded loopback deployment was canceled.
- Pre-existing untracked integration-e2e work was left untouched; code/config changes were committed
  and pushed before deployment. No provider purchase or blockchain transaction was used as a retry.

## Issue triage and next work

| Classification | Issue / action | Risk of deferring |
|---|---|---|
| Act Now — completed | Docker build boundary, complete environment provisioning, correct hosted bind; fixes verified above. | Service cannot start or serve traffic if regressed. |
| Investigate Now | Establish a dedicated stable HTTPS facilitator endpoint; pin it in gateway/payer/facilitator config before exposure; privately mount existing bearer token and verify 401 unauthenticated / authenticated supported response from Render. | Hosted Solana funding remains unavailable; do not create Solana-funded hosted quotes. |
| Investigate Now | Verify Shopify hosted read-only catalog/quote/browser behavior in a separately scoped lane. | Configuration status does not prove hosted checkout acceptance. |
| Ignore / Accept Risk | Atlas payment gate false and Masumi separate are intentional rehearsal limits. | No Atlas funded purchase or native Masumi task flow through this deployment. |
| Park for Later | Export/upgrade free DB before 5 November 2026 at 14:55 Singapore; free gateway can sleep. | Database expiry/data loss and cold-start delays. |

Use a fresh chat for the distinct fixed-origin Solana exposure lane, with this evidence and the
Solana config/transport/facilitator files as the compact handoff. Preserve signing histories and the
frozen public origin. No spending, signer migration, main merge or release freeze is authorized by
this rehearsal's readiness evidence.
