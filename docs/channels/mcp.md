# MCP channel

A thin Model Context Protocol server over the canonical HTTP gateway (`src/channels/mcp/`). It follows
[`docs/contracts/CHANNEL_CONTRACT.md`](../contracts/CHANNEL_CONTRACT.md): authenticate, translate, call core.

## What it is

- A **separate process** that calls the gateway's `/v1/*` HTTP API as one authenticated API client (one customer,
  one scope set). Four tools map onto the canonical operations:

| Tool | Gateway call |
|---|---|
| `find_offers({intent})` | `POST /v1/offers/search` |
| `create_quote({offerId, fulfillment})` | `POST /v1/quotes` |
| `buy({quoteId, maxTotal, quoteDigest, idempotencyKey?})` | `POST /v1/purchases` (header `Idempotency-Key`, default `mcp:<quoteId>`), then optionally the payer bridge, then `GET /v1/purchases/:id` |
| `get_purchase({purchaseId, includeEvents?})` | `GET /v1/purchases/:id` (+ `/events`, last 10) |

- Inputs are validated with the same zod contracts as the HTTP API before any request is made. Every output
  (structured and text) passes through `redact()` and a scrub of the configured tokens; gateway errors become MCP
  tool errors (`isError: true`) carrying `code`, `message` and `requestId`.
- Status text is deliberately conservative: "succeeded" appears only for `state === 'succeeded'`; `held` /
  `order_created_unpaid` are never called complete; `unresolved` is described as "outcome being reconciled".

## What it is not

- No database, no core, no payer keys, no funding logic. There is no mark-paid tool.
- It does **not** turn a chat model into an x402 signer. Without a bridge, `buy` creates the purchase and returns
  `status: "action_required"` plus the funding instructions.
- It is not a ChatGPT connector. ChatGPT connection configuration (and any OAuth in front of HTTP mode) is owned
  by the client/console lane.

## Environment

| Variable | Required | Meaning |
|---|---|---|
| `GATEWAY_URL` | yes | Gateway base URL, e.g. `http://127.0.0.1:8787` |
| `GATEWAY_TOKEN_FILE` | yes | Path to a file holding the gateway bearer token (whitespace trimmed). Never pass the token in env or argv. |
| `PAYER_BRIDGE_URL` | no | Base URL of the bounded payer process. Must be set together with the token file. |
| `PAYER_BRIDGE_TOKEN_FILE` | no | File holding the bridge bearer token. |
| `MCP_HTTP_PORT` | no | Serve streamable HTTP on `127.0.0.1:<port>/mcp` instead of stdio (`0` = ephemeral). |

## Running

Entrypoint: `src/channels/mcp/main.ts`; `npm run mcp` uses the process environment. For an explicit environment file on Windows:

```powershell
Set-Location C:\Dev\token2049-origins-core
# stdio (default)
node --env-file=.env.mcp --import tsx src/channels/mcp/main.ts
# Optional HTTP mode uses MCP_HTTP_PORT=8789 in .env.mcp; gateway and bridge keep their own ports.
```

Use absolute token-file paths when a desktop client starts the process from another directory. Remote gateway URLs require HTTPS; payer bridges require exact loopback hosts. Query/fragment/userinfo and redirects are refused. See the [runbook](../RUNBOOK.md) and `.env.mcp.example`.

stdout is the protocol channel in stdio mode; diagnostics go to stderr and never include token values.

HTTP mode is stateless (a fresh server per POST), binds `127.0.0.1` only and rejects non-loopback `Host`/`Origin`
headers. It has **no inbound authentication**: anyone who can reach the port acts as the configured customer.
Do not expose it beyond loopback without a front proxy that authenticates callers.

Create the gateway token with the existing client tooling (`npm run client:create`), channel `mcp`, and give it
only the scopes it needs (`offers:read`, `quotes:write`, `purchases:write`, `purchases:read`; the MCP process itself
never calls `/fund`, so `purchases:fund` belongs to the payer bridge's client, not this one).

## Claude Desktop / Cursor

```json
{
  "mcpServers": {
    "commerce-gateway": {
      "command": "npx",
      "args": ["tsx", "src/channels/mcp/main.ts"],
      "cwd": "/path/to/token2049-origins",
      "env": {
        "GATEWAY_URL": "http://127.0.0.1:8787",
        "GATEWAY_TOKEN_FILE": "/path/to/secrets/mcp.token"
      }
    }
  }
}
```

Add `PAYER_BRIDGE_URL` / `PAYER_BRIDGE_TOKEN_FILE` only when a payer bridge is running.

## Payment boundary

`buy` first creates the purchase (idempotent; no spend). Then:

1. **No bridge configured** -> `status: "action_required"`, `purchase.state` stays `awaiting_funding`, with
   `fundingInstructions` and `message: "Payment required: fund via a bounded payer client; no purchase has been made yet."`
2. **Bridge configured and purchase is `awaiting_funding`** -> `POST {PAYER_BRIDGE_URL}/pay` with
   `Authorization: Bearer <bridge token>` and `{purchaseId}`. Expected reply: `200 {ok:true, purchase, payment:{transferReference}}`
   or `4xx/5xx {ok:false, error:{code,message}}`. The bridge's own purchase echo is ignored: the gateway is always
   re-read afterwards, because a bridge timeout may hide a payment that did land.
   - state `funded_queued`/`executing` -> `status: "execution_pending"` (funded, not yet ordered; use `get_purchase`)
   - still `awaiting_funding` after a failed attempt -> `status: "payment_failed"`, `isError: true`
3. A replay of `buy` for an already-funded purchase is never re-paid; it simply reports the current state.

The worker executes funded purchases inside the gateway; the MCP process only observes the result via `get_purchase`.
