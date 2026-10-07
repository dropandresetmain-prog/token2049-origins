# Hosted MCP + ChatGPT purchase path

Capsule's MCP is served from the gateway's own public origin so ChatGPT can connect to it directly:

```
https://token2049-origins.onrender.com/mcp      (Streamable HTTP, POST only, stateless)
```

No tunnel, no local MCP process, no second public listener: the MCP handler and its OAuth server are routers on the
existing gateway Express app (`src/channels/hosted-mcp/`), so Render keeps one public `PORT`. It is **opt-in**
(`MCP_HOSTED_ENABLED=true`); with it unset, no `/mcp` or OAuth route exists. The local stdio and loopback-HTTP modes
(`src/channels/mcp/main.ts`, `http.ts`) are unchanged.

## Request path (all free Render services + the existing Render Postgres)

```
ChatGPT ──HTTPS──> token2049-origins /mcp (Host/Origin check → OAuth bearer → stateless MCP server per request)
                      │  tool call → gateway contract (zod-validated) over 127.0.0.1 with the caller's own scoped token
                      │  buy       → HTTPS + bearer → t2o-cardano-payer /pay {purchaseId}   (second FREE web service)
                      ▼
          payer → public gateway /v1/purchases/{id}/fund (x402, payer-scoped token) → Cardano Preprod
          payer ledger → Render Postgres (hosted_payer_ledger; no disk, no files)
```

## Authentication (OAuth 2.1 / MCP authorization)

Follows OpenAI's Apps SDK authentication guide and the MCP authorization spec.

| Piece | Implementation |
| --- | --- |
| Challenge | Any unauthenticated or invalid `POST /mcp` → `401` + `WWW-Authenticate: Bearer resource_metadata="…/.well-known/oauth-protected-resource/mcp"` |
| Protected-resource metadata (RFC 9728) | `/.well-known/oauth-protected-resource/mcp` and the unsuffixed path; `resource` = `https://…/mcp` |
| Authorization-server metadata (RFC 8414) | `/.well-known/oauth-authorization-server`; `code_challenge_methods_supported: ["S256"]`, DCR enabled |
| Client registration | Dynamic Client Registration (`/register`), public PKCE clients only, **redirect URIs allowlisted** to ChatGPT/OpenAI (`https://chatgpt.com/connector_platform_oauth_redirect`, `https://chatgpt.com/connector/oauth/{id}`, `https://platform.openai.com/apps-manage/oauth`) plus `MCP_OAUTH_EXTRA_REDIRECT_URIS` |
| Flow | Authorization code + PKCE S256, `resource` indicator enforced (must equal the MCP URL), `iss` returned (RFC 9207), single-use codes (replay revokes the grant), rotating refresh tokens (replay revokes the grant) |
| User approval | Consent page asks for the **owner passcode** (Render secret file `MCP_OAUTH_OWNER_PASSCODE_FILE`, ≥16 chars). 5 wrong attempts per 15 min lock consent. This single-owner gate is the root of trust: whoever completes it can spend through the bounded payer. |
| Tokens | Opaque, stored only as SHA-256 hashes (`oauth_clients/oauth_codes/oauth_tokens`, migration `0004`). Access 1 h, refresh 30 d. |
| Tool metadata | Every tool carries `_meta.securitySchemes: [{type:"oauth2", scopes:[…]}]`; insufficient scope returns `_meta["mcp/www_authenticate"]` so ChatGPT re-links |

**Identity reuse.** An OAuth grant resolves to one existing Capsule customer + `api_clients` row
(`cus_HOSTEDMCPDEMO` / `cli_HOSTEDMCPDEMO`, created lazily on first consent, `channel=mcp`). A token's scopes are the intersection of what was
requested and what that `api_clients` row holds, and are limited to `offers:read quotes:write purchases:write purchases:read`.
**`purchases:fund` and `evidence:read` are never grantable**, so ChatGPT cannot call `/fund` itself. The raw gateway access key is not used or exposed:
the tools forward the caller's own OAuth token to the gateway, which accepts it through `authenticate()` (same scope checks as any client).
**Kill switch:** `UPDATE api_clients SET revoked_at = now()::text WHERE id = 'cli_HOSTEDMCPDEMO'` revokes every token immediately and blocks new consent.

## Host / Origin rules

`/mcp` answers only for exactly the configured public host (`MCP_PUBLIC_URL`, which must equal `PUBLIC_BASE_URL`). `X-Forwarded-*`
headers are never consulted (`trust proxy` is off). `Origin` must be absent (server-to-server), the public origin, or one of
`https://chatgpt.com`, `https://chat.openai.com`, `MCP_ALLOWED_ORIGINS`. Otherwise `403`. Body ≤ 1 MB, errors are generic JSON-RPC errors, outputs go through `redact()` + secret scrubbing.

## Shopping behaviour (mandatory acceptance criteria)

1. `find_offers` returns a structured **shortlist of at most 3** real offers (gateway order, never re-ranked, only fields the offer actually carries: title, description, category/route, indicative price, merchant/product URL/variant when sourced, terms, expiry) plus `interaction: { nextAction: "present_options_and_ask_user_to_choose", createQuoteAllowedNow: false, markExactlyOneRecommended: true, presentAtMost: 3 }` and text saying **Do NOT call create_quote yet**. The host model recommends exactly one from those facts (nothing hardcoded) and asks the user which they want.
2. `create_quote` only after the user explicitly chooses; `{ category }` alone is enough because the saved demo customer profile fills shipping / booking-holder / traveller details server-side → exact terms and every available funding option (Cardano and Solana, with which are "Connected wallet" vs "External payment action required").
3. The user explicitly selects a payment rail and explicitly approves the exact quote → `buy`. Missing choice or approval returns `needs_input`; a rail without a hosted payer returns `action_required` and creates nothing.
4. `get_purchase` is read-only. Polling never creates a purchase or payment (tested: purchases, funding rows and payer calls are unchanged across repeated polls).
5. `orderConfirmation` is returned (and its headline leads the text) **only** when the existing durable completion conditions hold (`state=succeeded`, paid commerce + merchant status, receipt issued) **and** the provider status proves that commerce type **and** a funding payment was verified:

| Commerce type | Headline | Proof status required | Reference shown |
| --- | --- | --- | --- |
| retail | `ORDER CONFIRMED` | `paid` | order name/number (`#1003`) or `Shopify order <id>` |
| hotel | `BOOKING CONFIRMED` | `confirmed` | booking reference |
| flight | `TICKET ISSUED` | `ticketed` | provider order / ticket reference |

Also returned: merchant, receipt id, verified payment (rail + transfer reference), amounts, evidence refs, limitations. A held, unpaid, `ticketing`, unresolved or receipt-less purchase gets no success label. The public purchase view exposes one provider reference per purchase, so a separate airline PNR/e-ticket number is **not** shown (it is not available to the MCP; nothing is invented).

## Hosted payer (Cardano only, free web service)

`t2o-cardano-payer` is a second **free Render web service** (`Dockerfile.payer`, `clients/payer/hosted.ts`): the existing bounded payer and bridge, run in public-hosted mode. No private service, no disk, no tunnel.

**Public surface (only):** `GET /health`, `GET /status`, `POST /pay {"purchaseId": "pur_…"}`. `/pay` takes nothing else (extra keys are rejected): the payer fetches the canonical purchase and 402 requirements from the gateway and checks them against its own policy (Cardano Preprod, one asset, one payee, per-payment/daily/cumulative caps). It is publicly reachable, so it additionally requires: HTTPS (proxy header), the exact configured `Host`, no `Origin`, a long random bearer token (constant-time compare), a 4 KB body limit, no redirects (outbound calls refuse them), a 120 req/min process-wide limit and a lockout after 10 failed authentications per minute. Responses and logs never contain the token, mnemonic, signed payloads or gateway token. The gateway calls exactly the configured payer origin (`CARDANO_PAYER_BRIDGE_URL`, https, bare origin, never the gateway itself) and has no fallback; Solana uses the same public HTTPS bridge/source contract with a separate bearer token and gateway client. Both rails may be connected at once; selection remains explicit.

**History durability (PostgreSQL ledger, migration `0005`).** `hosted_payer_ledger` holds one row per purchase with the same semantics as the file ledger: spend is reserved (`signing`) before signing, the exact signed header is stored (`signed`) before it can be sent and resent identically on retry, then `accepted`. Caps are summed from the table, so they survive sleeping, restarts and redeploys. Concurrency uses a session advisory lock (overlapping deploys serialize; a crashed holder releases automatically) plus table triggers: facts and signed headers are immutable, status never moves backwards, signed rows cannot be deleted, the identity row is permanent. A `signing` row left by a crash is ambiguous, so that purchase is **refused** (operator reconciliation), never re-signed; in-process signing failures release only their own unsent reservation.

**Identity and canonical history.** The hosted payer reuses the EXISTING canonical Cardano payer wallet (fingerprint `a2e66045653afe62`, `sha256(address)[:16]`); no new wallet exists. The mnemonic stays in its protected setup directory and is uploaded only as a Render secret file. The PostgreSQL ledger is bound to the wallet's derived address: start-up derives the address from the mnemonic and refuses if it differs from `PAYER_WALLET_ADDRESS`, if the database already belongs to a different wallet, or if imported history disagrees; every signer is re-checked the same way.

**One-time history import (migration `0006` + `clients/payer/ledger-import.ts`).** The complete legacy file ledger is shipped as the secret file `legacy-ledger` and pinned by SHA-256 (`PAYER_LEGACY_LEDGER_SHA256`). On start the payer proves every entry on-chain (each transaction must spend from the wallet and pay the recorded payee), then imports all entries verbatim (status, signed header, transfer reference, timestamps) in one transaction together with the wallet identity and a permanent marker (wallet, network, source hash, entry count, committed base units). The rows are re-hashed and compared with the source before commit. A rerun only verifies; a non-empty destination, a different history, a hash mismatch or a different wallet is refused and leaves the database untouched. Nothing is inferred or dropped, and the cumulative/daily caps are computed from the imported spend, so the existing history keeps counting.

**Retiring the legacy signer.** Before anything is deployed the provisioner writes `<ledger>.retired` next to the old ledger. Every `PayerLedger` on that path (CLI payer, local bridge, e2e harness) then refuses to sign, so the hosted PostgreSQL ledger is the only place this wallet can spend from. The old file is left in place, readable and unchanged, as the archival record. (Removing the marker would re-enable the old signer against stale history; do not.)

**Caps.** Policy is copied from the most recent protected payer configuration that references the wallet's ledger and mnemonic (including `.env.hosted-policy` in the protected payer directory), never from older docs or defaults, and is never raised by tooling. The current values were raised 50x by the owner's explicit authorisation on 2026-10-07 (see KNOWN_ISSUES). The payer reports `ledger` in `GET /status`: committed history, imported marker, caps and `headroomBaseUnits` (the largest single payment still allowed).

**Slow steps on free instances (verified live).** ChatGPT abandons a tool call after about 60 s, but on the 0.1-vCPU free gateway an exact Shopify quote (headless checkout) takes about 2 minutes, and a payment settles slower than a minute at times. Hosted mode therefore runs `create_quote` and the payer call as in-process background jobs: the tool answers after 45 s with `quote_pending` / `payment_in_progress`, and repeating the same call (same arguments) joins the running job (no second quote, no second payment; the payer's durable history is the guard). The browser runs in low-memory mode (`SHOPIFY_BROWSER_LOW_MEMORY=true`: lean Chromium flags, no images/media/fonts, one browser at a time, step timeouts x4) at the lowest CPU priority (`nice -n 19` wrapper), because without that the 512 MB instance was OOM-killed and then health-check-killed mid-quote. The agent is told to wait ~20 s and call again.

**Retail discovery.** Open retail requests search the live Shopify catalog by default (`discovery: live`), with the controlled test catalog only as a fallback.

**Spend headroom is checked up front.** The payer reports its remaining headroom in `/status`; the quote lists the wallet as connected but flags a payment above the headroom ("would be refused"), and `buy` refuses before creating a purchase.

**Cold starts.** Free services sleep. The gateway allows up to 60 s for the payer's `/status` (a wake-up) and up to 100 s for `/pay`. A timeout never causes a second payment: the outcome is ambiguous, `buy` reports the payment attempt as unconfirmed, and durable payer history plus the gateway purchase decide what is real (`get_purchase`). The no-spend smoke wakes the payer first (`/health`, `/status`); nothing keeps it awake afterwards.

**Cost / limits.** All free: two free web services + the existing Render Postgres. Render shares 750 free instance-hours per month across the workspace's free services, and the Postgres instance shown by `render postgres list` has an `expiresAt` date (OAuth state and purchase history live there).

## One-command provisioning

```
cd C:\Dev\t2o-wt-freepayer   (any checkout of main with dependencies installed)
npm run provision:hosted-mcp
```

No wallet to create and no key to paste. It uses the official Render REST API (never the CLI for configuration; never the replace-all env endpoint), authenticating with `RENDER_API_KEY` if set, otherwise the credential the Render CLI already stores for this project (`~/.render/cli.yaml`, refreshed by the CLI if expired). It:

1. discovers the protected payer (`C:\Dev\token2049-setup\secrets\cardano-payer-<fingerprint>\`), derives the wallet address from its mnemonic and fails closed unless the fingerprint matches;
2. discovers the current payer policy from the newest protected config that references that ledger and mnemonic, and refuses if the gateway's treasury/asset differ from it;
3. reads the legacy ledger (refusing if a lock file shows a payment in flight), computes its hash/committed spend/headroom, and retires the legacy file signer;
4. finds the existing `token2049-origins` service, reads its env vars (`DATABASE_URL`, `BLOCKFROST_PROJECT_ID`, treasury, asset), creates the free `t2o-cardano-payer` web service if absent (refuses a paid plan), sets each variable per key, uploads the secret files (`payer-cardano-mnemonic`, `legacy-ledger`, `cardano-payer-bridge-token`, `payer-gateway-token` for the payer; `mcp-owner-passcode`, `cardano-payer-bridge-token` for the gateway), and points the gateway at `main`;
5. deploys both and waits for `live`; the payer imports the history on start-up;
6. verifies `/health`, `/console/`, the payer's `/health` and `/status` (imported hash, entry count, committed spend and caps must equal the local snapshot), the `/mcp` challenge, the wallet's on-chain balances, that the legacy file signer is disabled, and runs the no-spend smoke (`scripts/hosted-mcp-smoke.mjs --payer-url … --quote`).

It prints a pre-spend report (wallet, balances, imported entries, committed history, caps, headroom, legacy signer state, smoke result) and ends with `Hosted MCP: PASS`, `Payer: READY`, `MCP URL: …`. `--dry-run` reads only. Secrets are never printed. The gateway registers the payer's gateway client itself on boot from `MCP_PAYER_GATEWAY_TOKEN_SHA256` (hash only); both services run the append-only migrations.

Reference only: `deploy/render-payer-free.yaml` (dashboard Blueprint path for the payer). Do not apply the root `render.yaml`.

## Connecting ChatGPT

ChatGPT → Settings → Connectors → Advanced → enable **Developer mode** → **Create** (custom connector):
- Name: `Capsule`; MCP server URL: `https://token2049-origins.onrender.com/mcp`; Authentication: **OAuth** (leave client ID/secret empty; ChatGPT registers itself).
- Click Connect → the Capsule consent page opens → enter the owner passcode → Approve.
- Start a chat, enable the Capsule connector, e.g. *"Find me an international travel adapter."* ChatGPT should show 3 options with one Recommended, wait for your pick, use the saved customer profile, show exact terms and both funding options, and only call `buy` after you explicitly select a rail and approve. `buy` is declared destructive, so ChatGPT will also show its own confirmation.

## Known limits

- An ambiguous payment attempt requires reconciliation of the existing purchase. Do not start another payment or purchase; only an explicit retry-safe failure permits the existing bounded retry.
- `/mcp` is stateless: no server-initiated streams or sessions. Long payments (the bridge call can take up to ~100 s) depend on the client's tool timeout; if it times out, `get_purchase` shows the outcome.
- Consent throttling is global (one owner), not per IP, because the platform proxy hides client IPs.
- Historical disk-mount notes are superseded: the free hosted Cardano payer uses PostgreSQL history and Render secret files. Current deployment source and the release checkpoint establish service state.
- Hosted Solana runs as the node user with PostgreSQL histories; no disk, private service or laptop is required. Hosted deployment and controlled restart acceptance are retained in the final activation evidence.


## Saved demo customer profile (customer-facing language)

**DEMO configuration**, `demo/demo-data.json` → `customerProfile` (schema in `src/demo/config.ts`, merge in `src/demo/profile.ts`). Realistic Singapore-format values (example.com email, no secrets); they make no claim about any real person's identity, contact details or passport.

- The hosted `/mcp` endpoint merges the profile into `create_quote` fulfillment **before** canonical validation (`MCP_DEMO_PROFILE=off` disables it; stdio/local MCP uses it only when a profile is passed explicitly). Retail → shipping + email; hotel → holder + first guest; flight → contact + passenger (+ demo passport). Core, HTTP and the provider contracts are unchanged.
- An explicit user value is never overwritten. A user-named different person does not inherit the saved customer's DOB, gender, nationality or passport; overriding any delivery-location field means the rest of the location is asked for. Anything a provider still reports as required comes back as `needs_input` for that field only.
- Customer wording: offers, quotes, progress and the final confirmation use normal commerce language (no "fake/synthetic/sandbox" copy, no "(test environment)" suffix). The environment is disclosed **once**, immediately before approval, with the exact line from the quote result (`demoDisclosure`): "Demo transaction: payment uses testnet funds and the merchant checkout runs in a sandbox. No real money will be charged." Shopify Global source-store boundaries remain in structured quote evidence.
- Environment, testnet and sandbox facts are unchanged in structured results, receipts, proof and evidence (`providerEnvironment`, `terms`, `orderConfirmation.environment`, `limitations`).
- The text shows only a delivery line ("Delivering to Marina Bay Sands, Singapore"); DOB, passport, phone and email are never emitted in text, logs or proof.
- The Shopify executor's buyer guard accepts exactly two identities: the legacy Test Buyer (no phone) or the saved demo customer (its own phone); the email must stay on example.com.

## Free hosted Solana and shared readiness

`Dockerfile.solana` / `clients/solana/hosted.ts` run a third free public web service. Its only HTTP routes are `GET /health`, authenticated `GET /status`, and authenticated `POST /pay {purchaseId}` under the same HTTPS/Host/Origin/rate-limit guards as Cardano. The gateway holds no payer or sponsor key. Internal sponsor preparation is not exposed as an HTTP signing API.

The payer validates the exact gateway 402 requirement, Devnet genesis, test USDC mint, both token accounts, purchase/quote commitment, expiry, commercial cap and cumulative policy. PostgreSQL reserves payer spend and sponsor fees before their respective signatures. It retains the exact fully signed transaction before broadcasting and never invokes SDK settlement that signs again. Gateway mode `SOLANA_SETTLEMENT_MODE=payer_broadcast` independently verifies finalized transaction bytes, exact source debit and destination credit; it neither signs nor broadcasts.

Migration `0008_hosted_solana_ledger.sql` separates payer and sponsor roles. Startup requires both pinned imports. Each frozen source hash, entry count, exact fields, committed amount and fee total is permanent. Conflicts abort the combined transaction; missing finalized history aborts first import. Pending legacy reservations remain liabilities and make the source unavailable until reconciled. Retirement retains both `.retired` markers and permanent `.lock` files so older file signers also refuse signing. Do not remove them or run setup to initialize another ledger.

Provisioning reuses the existing Render CLI credential and gateway PostgreSQL. `npm run provision:hosted-solana -- --dry-run --policy-file <protected policy> --payer-ledger <preserved payer file> --sponsor-ledger <preserved sponsor file>` reads only and never generates wallets. `--apply` is the final approved migration/configuration checkpoint and may trigger Render deploys; do not run it before approval. It refuses unprotected keys, incomplete history, exhausted caps, a paid/private service or disk, and reused rail credentials. No payment is part of provisioning. Verify deployed imports, both sources and restart behavior before authorizing one funding-only proof.

Both rails use `BridgeClient.status()`: one in-flight probe, fixed safe diagnostics, one awaited health request only after a classified transient status failure, and at most two retries within the original status budget. Authentication, malformed JSON/schema and rail errors never trigger recovery; `/pay` is never retried by this flow. Old fire-and-forget `wake()` is removed. MCP background collection retains the same operation. The smoke uses `{category:'retail'}` and Singapore shipping; optional payer probes run after the MCP flow to avoid pre-warming acceptance.
