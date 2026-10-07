# Sokosumi marketplace lane

Base: `0234d20a11e80285318c88511195c5f2d51c0df8` (`feat/sokosumi-marketplace`).

## Status

Implementation is locally testable, while live marketplace delivery remains **PARTIAL**. The current Preprod Masumi URL in the private local configuration is loopback HTTP, so the current gateway cannot reach it from Render. A fresh authenticated read against the documented `https://api.preprod.sokosumi.com` origin returned HTTP 200 and 91 entries for each `VERIFIED` and `PENDING` query. The exact public `agentIdentifier`/`agent_identifier` comparison matched none of those returned entries, while pagination reports 92 total; a `page=2` request repeated the first returned record, so the query did not establish complete discovery. Sanitized details are in `docs/evidence/sokosumi-marketplace-discovery.json`. The similarly named host in `SOKOSUMI_API_URL` returned an HTML app shell at `/v1/agents`, not the API. No task, listing submission, registration, or native payment was created by this lane.

Existing evidence remains authoritative for the already-completed Masumi work: `docs/evidence/masumi-live.json`, `docs/evidence/sokosumi-runtime-live.json`, and `docs/evidence/sokosumi-discovery.json`. The latter is the prior Oct 6 discovery snapshot (91 entries, no project match). The runtime proof labels its completed commerce result `local_fixture`; it is not marketplace delivery evidence. These files and native histories were not rewritten or refreshed.

## Implemented boundary

When `SOKOSUMI_MARKETPLACE_ENABLED=true`, the gateway mounts the MIP-003 router at `/marketplace/mip003`. The feature requires a fresh `sokosumi_marketplace_*` Postgres schema distinct from the core schema, exact Preprod tUSDM, a remotely reachable HTTPS Masumi Payment Service, one platform Bearer token, one Capsule owner, and a dedicated gateway search token. Initialization failure returns 503 for availability and task operations; input schema remains readable. The feature defaults off. `/availability` reports only that the durable task store initialized (`readinessScope: task_store_only`); it does not probe or establish Masumi or Capsule search service readiness.

The marketplace runtime uses explicit `commerce_search` task mode. It accepts a strict bounded `commerce_request`, validates it with Capsule's existing purchase-intent contracts, and calls only `POST /v1/offers/search` using the configured search token. It freezes at most three normalized results with truthful expiry timestamps and `executable: false`. Missing search fields are returned as `needs_input`. It has no quote, purchase, funding, or provider execution call in this mode. The existing Masumi payment, input/output hash, result submission, replay, and reconciliation steps remain in use. The historical approved-purchase mode remains the default and its durable terms representation is unchanged.

Public MIP metadata routes are `/availability` and `/input_schema`; `/start_job` and `/status?job_id=...` require the configured Bearer token and are owner-scoped. Official MIP-003 documentation does not define marketplace-to-agent authentication, so compatibility of this token contract with the live Sokosumi Preprod caller has not been established. The inherited native payment nonce contract accepts only 14–26 lowercase hexadecimal characters; the current platform's generated purchaser IDs still need a real task check.

## Listing metadata prepared for review

| Field | Proposed truthful value |
|---|---|
| Name | Capsule Commerce Search |
| Purpose | Return a short, read-only shortlist of Capsule commerce offers for a structured request. |
| Features | Retail, hotel, and flight search wherever the Capsule route is configured; top three results; expiry and indicative price; structured fields to request when search input is incomplete. |
| Limitations | Search results are indicative and non-executable. The Sokosumi task cannot create a quote or purchase, accept purchase-principal funds, book, order, or reserve inventory. The user must continue through Capsule's explicit offer selection and approval flow. Availability depends on configured provider routes. |
| Stack | Capsule commerce gateway and MIP-003 adapter; Masumi Preprod payment/result lifecycle; PostgreSQL durable task store. |
| EU AI Act classification | Minimal risk is the closest form option for a bounded search/recommendation service; final classification is the submitter's responsibility. |
| Price | Existing intended native task fee: `10,000` raw tUSDM = `0.01 tUSDM` at 6 decimals. Current Masumi Sokosumi developer docs also describe one Sokosumi credit as one cent/10,000 raw units, but that does not prove this listing's native fee and marketplace credit are the same charge; confirm the platform billing presentation before publishing. |
| API | `https://<approved-host>/marketplace/mip003`; `GET /availability`, `GET /input_schema`, Bearer-protected `POST /start_job`, Bearer-protected `GET /status?job_id=<uuid>`. |

Suggested terms: “Capsule Commerce Search returns up to three indicative options for the supplied request. Results can expire, are not quotes or guaranteed inventory, and do not create a reservation, purchase, or payment to a merchant. Users must review an option and continue through Capsule's separate explicit quote and approval flow. The fixed task fee is separate from any later purchase amount. Do not submit sensitive identity, payment, or booking details to this read-only search task.”

The current Sokosumi listing form also asks for a working Preprod listing link, confirmation that the agent is deployed on Masumi and tested successfully on Sokosumi Pre-Prod, agent description/features/limitations/stack, terms, EU AI Act category, and submitter contact/company/tax/registration information. Do not submit until the agent is discoverable, the live task and caller authentication are proven, and the human-only fields are supplied. No values for those identity fields are invented here.

The MIP-003 implementation uses the documented HTTP contract directly; no Masumi SDK or Sokosumi CLI is required in the deployed runtime. Current official Sokosumi CLI docs advertise Node.js 18+, `npx sokosumi`, headless API-key/Bearer use, and `--preprod`, but do not pin a CLI package version. The CLI can help with later agent/job interaction; it does not remove the need to verify the deployed MIP endpoint and platform caller authentication. The official agents API documents `page` and `limit`; its observed Preprod responses were inconsistent (page 2 repeated page 1 at limit 100, while page 92 at limit 1 still returned a `nextCursor`). The bounded discovery read therefore remains incomplete. No numeric rate-limit/quota figure was documented for the listing or MIP endpoints in the sources reviewed, and no quota claim is made here.

## Deployment and external blockers

The existing Render gateway is the intended public HTTPS origin and already hosts optional routers on its web service. This lane adds no Render resources and does not expose the Masumi Payment Service. To enable it, provision the task schema and dedicated credentials on the same database, provide an externally reachable HTTPS Masumi Payment Service with its existing Preprod identity, then set the opt-in variables below. The present MPS loopback URL cannot satisfy this. Do not proxy MPS admin, API credentials, signer files, or payment-service endpoints publicly.

The required runtime configuration names are `SOKOSUMI_MARKETPLACE_ENABLED`, `SOKOSUMI_DATABASE_URL`, `SOKOSUMI_DATABASE_SCHEMA`, `SOKOSUMI_CUSTOMER_ID`, `MASUMI_CHANNEL_AUTH_TOKEN` or `MASUMI_CHANNEL_AUTH_TOKEN_FILE`, `SOKOSUMI_GATEWAY_SEARCH_TOKEN` or `SOKOSUMI_GATEWAY_SEARCH_TOKEN_FILE`, `MASUMI_NETWORK`, `MASUMI_PAYMENT_SERVICE_URL`, `MASUMI_PAYMENT_API_KEY` or `MASUMI_PAYMENT_API_KEY_FILE`, `MASUMI_AGENT_ID`, `MASUMI_SELLER_VKEY` or `MASUMI_SELLER_VKEY_FILE`, `MASUMI_SELLER_ADDRESS`, `MASUMI_CONTRACT_ADDRESS`, `MASUMI_PAYMENT_ASSET_UNIT`, `MASUMI_SERVICE_FEE_BASE_UNITS`, and `MASUMI_BLOCKFROST_PROJECT_ID` or `MASUMI_BLOCKFROST_PROJECT_ID_FILE`. Do not print or commit their values. The gateway search token must be a dedicated least-privilege credential with only `offers:read`.

## Official sources checked

- [TOKEN2049 Origins official track page](https://www.token2049.com/singapore/2049-origins): named tracks include Cardano Agentic Commerce and Best Workflow with CRE; Sokosumi is not a separately named prize track.
- [MIP-003 API standard](https://www.masumi.network/dev/masumi/mips/_mip-003): required task, status, availability, and schema routes.
- [Masumi registration guide](https://www.masumi.network/dev/masumi/documentation/get-started/register-agent): Preprod registration, public API endpoint, ADA registration fee, and tUSDM guidance.
- [Masumi Sokosumi listing guide](https://www.masumi.network/dev/masumi/documentation/how-to-guides/list-agent-on-sokosumi): registered MIP-003 agent, full exact Preprod tUSDM asset, and listing form.
- [Sokosumi API reference](https://www.masumi.network/dev/sokosumi/api-reference) and [CLI docs](https://www.masumi.network/dev/sokosumi/cli_docs): account API Bearer auth and separate mainnet/Preprod API origins; current CLI docs specify Node.js 18+ and `--preprod` without pinning a CLI version.
- [Masumi Pi Sokosumi docs](https://www.masumi.network/dev/sokosumi/documentation/pysokosumi): currently state one Sokosumi credit equals one cent/10,000 raw USDM/tUSDM units; applicability to the Marketplace listing's native service fee remains unverified.
- [Current Sokosumi listing form](https://tally.so/r/nPLBaV): form asks for a Preprod listing URL, agent deployment/test readiness, listing copy, terms, risk classification, and human submitter details.

## Review classifications

| Classification | Finding | Why it matters / action | Risk if deferred |
|---|---|---|---|
| Act Now | Do not enable hosted task ingress while MPS resolves to loopback or no dedicated task schema/search credential exists. | Startup validation fails closed; provision the existing remote Preprod MPS and dedicated schema/token before enablement. | No marketplace task can safely complete; a local URL cannot work from Render. |
| Investigate Now | Sokosumi-to-agent Bearer support and purchaser nonce format remain unverified. | Verify with a real Preprod task before listing or claiming platform delivery. | Platform may be unable to authenticate or generate an identifier accepted by the native payment contract. |
| Investigate Now | No exact agent identifier match appeared in the 91 returned records; pagination says 92 total and `page=2` repeated the first record, so full discovery remains unresolved. The listing form requires proof of a working Preprod task. | Reconcile the exact public agent identifier/metadata and pagination method, then submit the official form only after deployment and platform task proof. | A working local MIP runtime may remain undiscoverable in Sokosumi. |
| Park for Later | Marketplace-credit billing may be separate from Masumi tUSDM task remuneration. | Confirm the two price surfaces before publishing a fee. | Users may see duplicate or unclear charges. |
| Park for Later | A read-only offer-search failure is retained as `search_attempt` and is not retried because the HTTP outcome is ambiguous. | If experience justifies it later, add a separately bounded retry design for this no-spend read operation; never reuse purchase retry semantics. | A transient search failure may leave that task needing operator reconciliation. |
| Ignore / Accept Risk | Read-only offers can expire or differ before a user selects them. | Output marks results indicative, non-executable, and includes `expiresAt`. | Users may need a fresh search before a quote. |
