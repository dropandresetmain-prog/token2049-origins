# Multiwallet owner acceptance

**BLOCKED_TECHNICAL — do not start purchases.** Two cold wakes succeeded, but the second integrated check failed at the75s timeout without observed payer startup. The owner-required repeated acceptance gate has failed; activation is stopped. Signing/wallet grants/customer writes remain disabled. All nine live rows are NOT RUN. The sheet below is prepared for a future verified release, not current permission to test.

Use the existing `https://token2049-origins.onrender.com/mcp` with its existing OAuth implementation. Consult [current official connection instructions](https://developers.openai.com/plugins/deploy/connect-chatgpt); account/workspace controls and UI wording may differ. Copy the exact redirect URI from the host's MCP/OAuth setup interface into the allowed configuration when needed. Retrieve the existing access code through its protected owner method; do not paste it into chat, logs or proof artifacts. No new OAuth provider is required. Console: [Capsule](https://token2049-origins.onrender.com/console/).

### Owner connection preflight

The [official OpenAI setup guide](https://developers.openai.com/plugins/deploy/connect-chatgpt), fetched 11 October 2026, gives this flow:

1. Open [ChatGPT Plugins](https://chatgpt.com/plugins) in the intended account/workspace; select the plus button, then **Add custom MCP server**.
2. Name it Capsule, describe it as sandbox/testnet commerce, and use public connection URL `https://token2049-origins.onrender.com/mcp`. Choose OAuth. Existing metadata supports dynamic client registration; leave manual client ID/secret blank when using that option.
3. Review the host warning, select **I understand and want to continue**, then **Create as a plugin**. Review discovered tools: find_offers, create_quote, buy, get_purchase. Install the result in that same context.
4. If Capsule is already installed, open its connection and **Refresh**, then start a new conversation. Reconnect OAuth if cached permission remains read-only from cutover; the current customer grant allows search/quote/buy/read, never direct funding.
5. Type `@` and select Capsule. Complete Capsule's OAuth consent using the existing code, only on its consent page. If the host requires a redirect allowlist update, copy its exact production URI; do not guess it. Account/workspace/Lockdown policy may block custom MCP access and needs the owner's/admin's browser action.

Owner-only local code retrieval (copies directly to the clipboard; does not print or put the code in chat):

```powershell
Get-Content -Raw -LiteralPath 'C:/Dev/token2049-setup/secrets/hosted-demo/mcp-owner-passcode' | Set-Clipboard
```

Paste only into Capsule's consent screen, then clear the clipboard. The [console](https://token2049-origins.onrender.com/console/) is public read-only and needs no key. The local console-access-key copy is stale against the unchanged deployed reader hash; it is not needed for this demo view.

## Preparation and explicit approval

The account links to the hosted demo customer and protected test wallets, not each visitor's personal wallet. Confirm the displayed registered source label/ID/public identity. Listing is configuration capability only; current balance is checked for the selected source when preparing payment. Never assume readiness from another wallet.

Use fresh dates and offers. Search presents up to three options and one grounded recommendation; choose an offer before quoting. Saved demo details fill allowed fields; supply only missing canonical details. Exact quote must show expiry, digest, merchant amount/fee/total, notional disclosure, funding option, network/asset/recipient and test-asset quantity.

Say explicitly: “I approve quote [ID/digest], total at most [amount/currency], funding option [ID], from registered wallet [selectedSourceId].” The assistant passes the exact funding option and `selectedSourceId` to `buy`. A changed source/quote requires fresh authorization and cannot override an ambiguous prior attempt.

The existing testnet scale is **1:1000**, not exchange-rate or production-money settlement. Keep per-rail policies separate:

| Source | Verified hosted policy; retained exposure |
|---|---|
| Cardano Preprod demo wallet | Per-payment/daily/cumulative 5,100,000 token base units; fee cap 2,500,000,000 lovelace; ADA output cap 10,000,000,000 lovelace. Retained 5 entries/94,820 committed; cumulative headroom 5,005,180. Balance/fee availability is not established by those counters. |
| Solana Devnet demo wallet | 5,100,000 base units per-payment/daily/cumulative; USD5,100 commercial cap; shared sponsor fee cap 100,000 lamports. Retained 7 entries/2 blocked,94,220 committed; cumulative headroom 5,005,780 and sponsor headroom 74,998 lamports. Read-only finalized balance check passed at 19:27 UTC 10 Oct; balances can change. Payer token funds and sponsor fees are separate. |
| Sui Testnet demo wallet | 5,100,000 base units per-payment/daily/cumulative; USD5,100 commercial cap; 10,000,000 MIST gas/payment and 500,000,000 MIST cumulative gas. Retained history counts 35,900 token units and 20,000,000 MIST, including two signed records. |

Daily windows retain their existing semantics: Cardano and Solana use UTC days; Sui uses a rolling24hours. Numeric token caps match, and prior exposure is retained. No test may silently raise token, gas or sponsor limits.

Use these exact registered source IDs (the same ID applies to that rail in every row):

| Rail | Registered source ID | Public identity to check |
|---|---|---|
| Cardano Preprod | `src_21f098873f368133fc671af8b3716703` | `addr_test1qrwg…tthyxm` |
| Solana Devnet | `src_5f44db62376459a75a564e4d3bc8099a` | `5iSWoZSucVSaNj…2X5MZ6` |
| Sui Testnet | `src_fb5d190ec0b7abf66d5ff65f2e37af86` | `0x99eb4437d493…86d20b` |

Select legitimate fresh offers within exact quote and remaining caps; do not increase caps or pretend an expensive itinerary is affordable. If no suitable offer/balance exists, mark the row **BLOCKED** with evidence. Dates below are relative to the actual test date.

## Nine live rows

Select the registered source matching the named rail; record its exact ID for each row. Same-chain wallets are distinguishable source IDs, never an implicit fallback.

| Provider + rail | Realistic fresh search request | Required environment/source | Expected headline and independent proof | Status |
|---|---|---|---|---|
| Shopify + Cardano | “Find a universal travel adapter around SGD 40.” | Controlled Shopify test-store execution; Cardano Preprod source | ORDER CONFIRMED; paid sandbox order readback + Preprod transfer + receipt | NOT RUN |
| Shopify + Solana | “Find a useful USB cable under USD 20.” | Controlled Shopify test-store execution; Solana Devnet source | ORDER CONFIRMED; paid sandbox order readback + finalized Devnet transfer + receipt | NOT RUN |
| Shopify + Sui | “Find a small travel accessory under USD 25.” | Controlled Shopify test-store execution; Sui Testnet source | ORDER CONFIRMED; paid sandbox order readback + successful Testnet effects + receipt | NOT RUN |
| Nuitée + Cardano | “Find one night in Bangkok for one adult, about two weeks from today, under USD 100 total.” | Nuitée sandbox; Cardano Preprod source | BOOKING CONFIRMED; booking readback + Preprod transfer + receipt | NOT RUN |
| Nuitée + Solana | “Find one night in Bangkok for one adult, about two weeks from today, under USD 100 total.” | Nuitée sandbox; Solana Devnet source | BOOKING CONFIRMED; booking readback + finalized Devnet transfer + receipt | NOT RUN |
| Nuitée + Sui | “Find one night in Bangkok for one adult, about two weeks from today, under USD 150 including fees.” | Nuitée sandbox; Sui Testnet source; fresh quote must fit remaining token/gas allowance | BOOKING CONFIRMED; booking readback + successful Testnet effects + receipt | NOT RUN |
| Atlas + Cardano | “Find a one-way Singapore–Kuala Lumpur flight for one adult, around three weeks from today, budget USD 150.” | Atlas sandbox; Cardano Preprod source | TICKET ISSUED; ticketed order readback + Preprod transfer + receipt | NOT RUN |
| Atlas + Solana | “Find a one-way Singapore–Kuala Lumpur flight for one adult, around three weeks from today, under USD 150 total.” | Atlas sandbox; Solana Devnet source | TICKET ISSUED; ticketed order readback + finalized Devnet transfer + receipt | NOT RUN |
| Atlas + Sui | “Find a one-way Singapore–Kuala Lumpur flight for one adult, flexible dates three weeks from today, under USD 150 including fees.” | Atlas sandbox; Sui Testnet source; availability and exact remaining allowance still require a fresh quote | TICKET ISSUED; ticketed order readback + successful Testnet effects + receipt | NOT RUN |

Shopify discovery may show real-store products; execution remains Capsule's sandbox merchant. No real delivery, travel reservation, mainnet transfer or production settlement is claimed.

## Record for every attempted row

- Run timestamp (UTC and Singapore); search text and chosen offer/provider observation time.
- Exact quote ID/digest/expiry; merchant amount, fee, total and testnet/notional disclosure.
- Funding option ID; registered source ID/public identity; network/asset/recipient/amount.
- Explicit approval text; purchase ID and idempotency reference.
- Payment reference and independent chain verification; actual provider reference and independent readback.
- Observed success headline, receipt ID and sanitized proof location; selected source matches approval.
- Result: PASS / FAIL / BLOCKED / UNRESOLVED. Leave untouched rows NOT RUN.
- Any host disconnect/cold-start/restart, progress observations and recovery evidence.

A PASS requires verified payment, actual final provider completion, independent provider readback and issued receipt for the same purchase. Held, ticketing, pending, unknown or receipt-less states are not success. Use the authenticated scope actually implemented when testing a second viewer; do not assume public data proves cross-customer isolation.

## Failure handling

Retain the purchase ID. Read `get_purchase`, inspect its state, payment/merchant readback and receipt/proof. Polling is read-only. Free services may cold-start; no warm-up or owner startup command is needed.

If any payment/signing/provider attempt may exist, stop new writes and reconcile that purchase. Do not repeat `buy`, switch wallets, create another order/booking or rebuild a signed candidate merely because a response was lost. Resume only through an explicitly permitted same-candidate recovery. Mark unresolved outcomes UNRESOLVED and retain their liabilities. Fresh quotes are appropriate only after the previous attempt is conclusively safe to abandon.

The previous three expired failed purchases (pur_01M4KR2NFZ98985MZE7HR8158E, pur_01M4KRG20BRKFAAN5AD4GER4PT, pur_01M4KRWP9FJJ66CQNN4C99CZSP) remain untouched. Never retry those IDs; use fresh offers/quotes for new authorized acceptance.

After the owner handoff, no autonomous live test or new feature work is implied.
