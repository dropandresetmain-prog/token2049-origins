# MCP channel

Capsule's MCP server is a thin client over the canonical authenticated HTTP gateway. It owns no database, commerce logic, funding truth or payer keys.

Current baseline: main @ 8a76225364bf3b56fe2bf192297ee17b86d8f540

Protocol/local MCP tests pass. Actual ChatGPT host connection is not yet verified.

## Tools

| Tool | Meaning |
| --- | --- |
| find_offers | assess/validate intent and search normalized commerce offers |
| create_quote | collect/validate fulfillment and create exact immutable quote |
| buy | collect explicit funding selection + approval, create/follow purchase, optionally invoke bounded payer bridge |
| get_purchase | read current purchase/progress/receipt |

The public tool surface remains provider-neutral. Shopify Global Catalog is behind retail discovery; it does not add a Shopify-specific MCP.

## Progressive input

Incomplete known input returns structured needs_input rather than forcing the model to invent values. The host asks the user for the listed canonical fields, merges the answer and retries.

## Buy contract

buy accepts:
- quoteId
- selectedFundingOptionId
- maxTotal
- quoteDigest
- optional idempotencyKey

selectedFundingOptionId, maxTotal and quoteDigest may be omitted by the host only so Capsule can return needs_input. No rail is inferred.

The tool:
1. reloads the exact stored quote;
2. validates the selected funding option;
3. collects explicit approval of exact terms/payment choice;
4. checks whether a purchase already exists for that quote;
5. follows matching existing approval rather than creating a duplicate;
6. resolves the ONE connected payer whose source matches the selected option's rail + network + asset, then invokes only that payer's bridge and only for a newly created not_received purchase (never another rail, no fallback; if two bridges claim the same identity it fails without paying);
7. rereads gateway state after payer response.

If an existing purchase already has payment or merchant activity, conflicting retry copy tells the host to follow it with get_purchase, not create another purchase.

## Idempotency

Default MCP idempotency derives from quoteId + selectedFundingOptionId. Backend quote uniqueness, purchase idempotency and payer histories remain authoritative across retries/processes. The user is never responsible for avoiding duplicate clicks.

## Payer bridges

Optional bounded payer bridges are separate and loopback-only. At most one per rail: Cardano Preprod (`clients/payer/bridge.ts`) and Solana Devnet (`clients/solana/bridge.ts`). Both may be connected at once. `create_quote` returns `fundingSources` (all reachable sources) and marks each quote option connected only when a source matches its rail/network/asset; the user still selects the option explicitly.

Public status may expose:
- stable source ID
- rail/network
- public/masked address
- asset
- configured readiness

It never exposes private signing material.

Without a compatible bridge, buy returns action_required/external payment instructions.

## Process modes

Default: stdio.

Optional HTTP transport binds loopback only. It has no inbound auth of its own and must never be exposed directly to a network.

Environment:
- GATEWAY_URL
- GATEWAY_TOKEN_FILE
- optional CARDANO_PAYER_BRIDGE_URL + CARDANO_PAYER_BRIDGE_TOKEN_FILE (legacy alias: PAYER_BRIDGE_URL + PAYER_BRIDGE_TOKEN_FILE, always Cardano; do not set both spellings)
- optional SOLANA_PAYER_BRIDGE_URL + SOLANA_PAYER_BRIDGE_TOKEN_FILE
- optional MCP_HTTP_PORT

Remote gateway URL must use HTTPS; token files should be absolute/protected when launched from desktop clients.

## Current evidence and limitation

Verified:
- MCP initialization/tool listing
- stdio and HTTP protocol journeys against real local core/PostgreSQL
- needs_input
- explicit funding selection
- duplicate/F-1 behavior
- purchase-to-receipt journeys with merchant/funding fixtures

Not verified:
- actual ChatGPT host connection
- production/deployed host auth
- host-specific UX/reconnect behavior

Do not claim those until tested.
