# Hosted MCP + ChatGPT purchase path

Capsule's MCP is served from the gateway's own public origin so ChatGPT can connect to it directly:

```
https://token2049-origins.onrender.com/mcp      (Streamable HTTP, POST only, stateless)
```

No tunnel, no local MCP process, no second public listener: the MCP handler and its OAuth server are routers on the
existing gateway Express app (`src/channels/hosted-mcp/`), so Render keeps one public `PORT`. It is **opt-in**
(`MCP_HOSTED_ENABLED=true`); with it unset, no `/mcp` or OAuth route exists. The local stdio and loopback-HTTP modes
(`src/channels/mcp/main.ts`, `http.ts`) are unchanged.

## Request path

```
ChatGPT ──HTTPS──> /mcp (Host/Origin check → OAuth bearer → stateless MCP server per request)
                      │  tool call → gateway contract (zod-validated) over 127.0.0.1 with the caller's own scoped token
                      │  buy       → Render PRIVATE network → t2o-cardano-payer /pay {purchaseId}
                      ▼
          payer → public gateway /v1/purchases/{id}/fund (x402, payer-scoped token) → Cardano Preprod
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
2. `create_quote` only after the user explicitly chooses (needs real shipping details) → exact terms and every available funding option (Cardano and Solana, with which are "Connected wallet" vs "External payment action required").
3. The user explicitly selects a payment rail and explicitly approves the exact quote → `buy`. Missing choice or approval returns `needs_input`; a rail without a hosted payer returns `action_required` and creates nothing.
4. `get_purchase` is read-only. Polling never creates a purchase or payment (tested: purchases, funding rows and payer calls are unchanged across repeated polls).
5. `orderConfirmation` is returned (and its headline leads the text) **only** when the existing durable completion conditions hold (`state=succeeded`, paid commerce + merchant status, receipt issued) **and** the provider status proves that commerce type **and** a funding payment was verified:

| Commerce type | Headline | Proof status required | Reference shown |
| --- | --- | --- | --- |
| retail | `ORDER CONFIRMED` | `paid` | order name/number (`#1003`) or `Shopify order <id>` |
| hotel | `BOOKING CONFIRMED` | `confirmed` | booking reference |
| flight | `TICKET ISSUED` | `ticketed` | provider order / ticket reference |

Also returned: merchant, receipt id, verified payment (rail + transfer reference), amounts, evidence refs, limitations. A held, unpaid, `ticketing`, unresolved or receipt-less purchase gets no success label. The public purchase view exposes one provider reference per purchase, so a separate airline PNR/e-ticket number is **not** shown (it is not available to the MCP; nothing is invented).

## Hosted payer (Cardano only)

`t2o-cardano-payer` is a Render **private service** (`Dockerfile.payer`, `clients/payer/hosted.ts`): the existing bounded payer + bridge behind private-network access (private peers only, exact `Host` allowlist, bearer token, no `Origin`). It accepts only `{purchaseId}` and takes rail/network/asset/payee/amount from the purchase and its own caps (`PAYER_*`: 0.5 / 1.5 cumulative / 1.0 daily in asset units; edit in `render.yaml`). The MCP calls it over `http://t2o-cardano-payer:8788`; Solana has no hosted payer, so a Solana choice returns `action_required` (no fallback; a Solana bridge in hosted config is a startup error).

**History durability.** The ledger (`PAYER_LEDGER_FILE=/var/data/payer-ledger.json`) lives on a Render persistent disk. Every payment is reserved before signing and the identical signed header is resent on retry, so history, caps and at-most-once behaviour survive restarts and redeploys. A missing ledger stops the service (never silently recreated); a crash lock is logged and left for the operator (never auto-cleared), per `docs/evidence/cardano-protocol.md`. Render also takes daily disk snapshots, but never restore one without reconciling payments made since.

**Cost.** A private service and a disk both require a paid plan: Starter instance **$7/mo** + 1 GB disk **$0.25/mo** ≈ **$7.25/mo** (Render list prices; confirm in the dashboard). The workspace currently has no payment info on file (`render blueprints validate` → `need_payment_info`), so this cannot be provisioned until you add it. The existing free web service can send private-network requests to the payer.

## Provisioning checklist (operator, once)

1. Render dashboard → add payment info; apply `render.yaml` (new `t2o-cardano-payer` + web env vars). Keep `autoDeployTrigger: off`.
2. Create a NEW wallet locally and keep it separate from every historical payer: `PAYER_CARDANO_MNEMONIC_FILE=wallets/hosted-demo.mnemonic PAYER_LEDGER_FILE=<absolute scratch path> npm run wallet` (prints the address only; discard the scratch ledger). Fund the printed address with tADA + the test stablecoin from the faucets. Set `PAYER_EXPECTED_PAY_TO` (treasury) and `PAYER_ALLOWED_ASSET_UNIT` on the payer service.
3. Secret files — web service: `mcp-owner-passcode` (you choose, ≥16 chars), `cardano-payer-bridge-token`. Payer service: `payer-cardano-mnemonic` (file from step 2), `cardano-payer-bridge-token` (same value), `payer-gateway-token`. Generate tokens with `openssl rand -base64 36`.
4. Payer gateway token must belong to the hosted customer: against the production DB run `npm run client:create -- --name "hosted payer" --channel http --customer cus_HOSTEDMCPDEMO --role payer` and put the token it writes into `payer-gateway-token`.
5. On the payer service shell, once: `npm run payer:hosted:init-ledger` (refuses to overwrite). Start the service; `PAYER_BRIDGE_ALLOWED_HOSTS` must equal `t2o-cardano-payer:8788`.
6. Deploy the web service from this branch. Verify publicly with no spend: `HOSTED_MCP_PASSCODE=… node scripts/hosted-mcp-smoke.mjs --base https://token2049-origins.onrender.com --quote`.

## Connecting ChatGPT

ChatGPT → Settings → Connectors → Advanced → enable **Developer mode** → **Create** (custom connector):
- Name: `Capsule`; MCP server URL: `https://token2049-origins.onrender.com/mcp`; Authentication: **OAuth** (leave client ID/secret empty; ChatGPT registers itself).
- Click Connect → the Capsule consent page opens → enter the owner passcode → Approve.
- Start a chat, enable the Capsule connector, e.g. *"Find me an international travel adapter."* ChatGPT should show 3 options with one Recommended, wait for your pick, ask for shipping details, show the quote and payment options, and only call `buy` after you select Cardano and approve. `buy` is declared destructive, so ChatGPT will also show its own confirmation.

## Known limits

- A failed or ambiguous first payment attempt is not re-sent by the same `buy` (the existing "never resend unknown payments" rule); request a fresh quote.
- `/mcp` is stateless: no server-initiated streams or sessions. Long payments (the bridge call can take up to ~100 s) depend on the client's tool timeout; if it times out, `get_purchase` shows the outcome.
- Consent throttling is global (one owner), not per IP, because the platform proxy hides client IPs.
- Payer container runs as root so it can write the root-owned disk mount (untested on Render; see report).
