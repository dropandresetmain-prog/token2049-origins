# Capsule vocabulary: user-facing language

Who reads the console: a person whose AI assistant bought something for them through Capsule. They know what they asked
for, roughly what it costs and which assistant they use. They do not know how Capsule is built, and they should never
need to.

The source of truth for every on-screen string is `web/src/copy/en.ts`. This page records the rules and the mapping from
internal terms, so engineers, designers and anyone writing gateway text that customers see use the same words.

## Rules

1. **Say what happened to the person's purchase, in their words.** "Payment received", "Booking confirmed",
   "The price changed, so nothing was bought."
2. **No internal terms on screen.** If a word only makes sense to someone who has read the code, map it (table below).
   Raw enum values, event type names and IDs prefixed `pur_`, `quo_`, `rcp_` never appear in normal UI. Technical records
   are available only behind "Technical details for support".
3. **Never claim more than the data proves.** A payment is not an order. An order is not necessarily paid. A test payment
   is not money. A receipt appears only after the merchant confirms. When the outcome isn't known, say so.
4. **Test is always visible.** In sample data and test mode, a strip at the top says so, and merchant details say
   "test mode". Test funds are "test tokens" with "no cash value".
5. **Plain punctuation.** Short sentences. No em dashes or en dashes. At most one middle dot per line. Sentence case.
6. **Short IDs for people, full IDs for copying.** Show "#4K2Q9X"; the copy button copies the full purchase ID for
   support.
7. **Tell people what to do only when there is something to do.** "No action needed" when Capsule is waiting; one clear
   action ("Copy request for a new quote") when the person must act.

## Internal term to user term

| Internal (code, contracts, events) | On screen |
|---|---|
| Gateway | Capsule |
| Agent, channel, API client | Assistant (by name: "ChatGPT", "Claude"); fallback "Your assistant" |
| Channel `mcp` / `http` / `sokosumi` | AI assistant / Connected app / Agent marketplace |
| Provider, route (`shopify`, `nuitee`, `atlas`) | Merchant by name ("Shopify, online store", "Nuitée, hotel booking partner", "Atlas, flight booking partner") |
| Provider environment `sandbox`, `test`, `fixture` | Test mode |
| Offer, quote | Quote, price (a quote is the approved price) |
| Quote digest, quote version | Not shown. "Quote number" shows a short ID |
| Approval, `approval.recorded` | Approved ("ChatGPT approved this exact price and payment method") |
| Spend ceiling, `maxTotal` | Spending limit, "Approved up to $400.00" |
| Payable principal, purchase principal | Total, purchase price |
| Service fee | Capsule fee |
| Funding, funding rail, funding option | Payment, payment method ("Cardano", "Solana") |
| Network `cardano:preprod`, `solana:devnet` | Test network |
| Funding requirement, settlement, scaled testnet notional | Amount due in test tokens, "Test payments are 1/1000 of the price and have no cash value" |
| x402, payment header, facilitator, Blockfrost | Not shown. Delays read "Payment check delayed" |
| Transfer reference, tx hash | Payment reference |
| Payment state `confirmed` / `not_received` / `submitted` | Payment received / Not paid yet / Payment sent, waiting for confirmation |
| Purpose `principal_and_fee` / `service_fee` | Covers "the purchase price and Capsule's fee" / "Capsule's fee only" |
| Execution, merchant execution, attempt | Placing the order, booking the stay, booking the flight |
| Commerce status `paid` / `confirmed` / `ticketed` | Order paid / Booking confirmed / Ticket issued |
| Commerce status `held`, `order_created_unpaid` | Reserved, not confirmed yet / Order created, not paid yet |
| Merchant payment `simulated_paid` / `test_balance_paid` | Paid (simulated in test mode) / Paid from a test balance |
| State `unresolved`, reconciliation | Checking with merchant |
| State `requires_reauthorization`, terms changed | Price changed |
| State `failed` | Couldn't complete |
| State `expired` | Expired ("This quote expired, so nothing was bought") |
| Reservation, capacity, simulated ledger | Spending allowance (simulated), "set aside for this purchase", "No bank account or card is charged" |
| Evidence, evidence mode, provenance | Proof. Sample and test status shown by the strip and "test mode" labels |
| Journal, events | Activity |
| `local_fixture`, fixture | Sample data |
| Bearer token, scopes | Access key, "can view purchases and proof" |
| `requestId` | Support code |

## Statuses

Awaiting payment, Confirming payment, In progress, Checking with merchant, Completed, Price changed, Couldn't complete,
Expired. Groups: In progress, Needs attention (Price changed, Couldn't complete), Completed. Amber is reserved for
"Needs attention".

## Text the gateway writes

Some text reaches the screen from the gateway rather than from `en.ts`: receipt notes (`receipt.limitations`), item details
(`QuoteView.fulfillmentSummary`), price-line labels and merchant terms. Gateway-authored text (receipt notes especially)
should follow these rules. Merchant text is shown as the merchant wrote it, under merchant labels such as "Merchant
terms". Tracked as G7 in `docs/contracts/CONSOLE_CONTRACT.md`.
