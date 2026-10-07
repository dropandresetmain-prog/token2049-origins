# Capsule architecture

## A common transaction layer between different worlds

Capsule connects agents, payment networks and commerce providers that each describe a purchase differently. An assistant works with a user's request. A blockchain works with signed transfers. A merchant works with orders, reservations and payments in its own system.

The architecture puts a common transaction core between them. Agent integrations express intent and approval. Funding adapters establish whether the approved payment arrived. Commerce adapters carry out the provider-specific operation. The core ties those events to one purchase and gives the agent and console a consistent result.

That separation is what makes buyer-side integration possible: a provider adapter can serve purchases funded through different supported networks, while the agent keeps the same interface.

```text
                          USER / AI AGENT
                                |
                             MCP / HTTP
                                |
                   +------------v-------------+
                   |  CAPSULE COMMERCE GATEWAY|
                   | quote / approval / state |
                   +------+-----------+--------+
                          |           |
                CUSTOMER PURCHASE     |        COMMERCE
                    FUNDING            |        PROVIDERS
                 Cardano Preprod       |     Shopify / Atlas /
                 Solana Devnet         |     Nuitee / LiteAPI
                          \            |            /
                           \           |           /
                            +----------v----------+
                            | Capsule Journal /  |
                            | Evidence / Proof   |
                            +-----+---------+----+
                                  |         |
                             Console     Chainlink CRE
                                          + Koios

                    TREASURY / OPERATIONS
                    +-------------------------------+
                    | Coinbase CDP                  |
                    | Base Sepolia Server Wallet    |
                    | operational crypto treasury   |
                    |                               |
                    | OCBC                          |
                    | read-only fiat observations   |
                    +---------------+---------------+
                                    |
                         manual reconciliation /
                              rebalancing view

Frankfurter supplies SGD/USD reference rates for search and display.
Masumi coordinates paid agent tasks linked to the transaction core.
```

CRE's demonstrated verification runs in the CLI simulator against a retained purchase record and a public-chain read. The purchasing flow itself runs through Capsule's core and provider adapters.

For the product argument and partner write-ups, read [PROJECT_SUBMISSION.md](PROJECT_SUBMISSION.md). This document follows the decisions that make that product work.

<a id="agent-interface"></a>
## Let the agent reason; let the gateway transact

The assistant is responsible for understanding what the user wants, discussing options and obtaining approval. Capsule receives typed requests through an HTTP contract. MCP translates the assistant's tool calls into that contract, so changing the conversational host does not change how a purchase is recorded or executed.

The agent uses four operations:

| Tool | What it does |
| --- | --- |
| `find_offers` | Searches the selected commerce category and returns options. |
| `create_quote` | Obtains exact terms for the chosen offer. |
| `buy` | Creates the approved purchase and invokes its connected payer where configured. |
| `get_purchase` | Returns progress, confirmation and receipt information. |

An incomplete request produces a structured request for the missing information. This keeps interpretation in the conversation while preserving a consistent transaction contract. Traveller and shipping details are supplied during fulfilment, separately from public purchase summaries.

Each authenticated client is bound to a customer and a set of permissions. Hosted MCP uses OAuth with PKCE; local MCP uses the same gateway operations. Both paths reach the same purchase core. The [channel contract](docs/contracts/CHANNEL_CONTRACT.md) describes the request and response shapes, and [src/contracts](src/contracts/) contains their executable schemas.

## Turn a recommendation into an agreement

A search result is an option. Before it becomes a purchase, Capsule obtains the provider's exact terms, including the commercial amount and expiry. The quote also records its available funding options: network, asset, recipient and amount.

Approval binds the selected funding option and maximum commercial amount to the quote's digest. The core reads the payment details from that stored quote instead of accepting a new amount or destination from the model. A change in price therefore becomes a new agreement to approve, rather than a silent adjustment inside checkout.

This gives every later step a stable reference. The payer checks the same purchase the user approved. The provider executor works against the quoted terms. The final receipt can connect the payment and result to that agreement.

## Confirm funding before commerce execution

Both Cardano and Solana use Capsule's x402 funding boundary. An unsigned request receives the payment requirement. A separate payer validates it and signs under its own policy. The gateway verifies the resulting transfer, persists the funding evidence and queues commerce execution when that funding is applied.

The separation between gateway and signer is deliberate. The gateway coordinates purchases; the payer controls the signing key and enforces its configured recipient, asset and spend limits. The assistant never needs a wallet key to request a purchase.

### Cardano funding

The Cardano adapter uses Preprod native-asset payments through x402 Cardano, with Evolution SDK signing in the payer, the configured facilitator and Blockfrost-backed chain reads. A payment commitment links the transaction to the approved purchase and quote.

The hosted Cardano payer runs as a separate service. Its PostgreSQL-backed history records spend reservations and signed transactions, so a restart retains the relationship between the purchase and its payment. The gateway can reconcile a submitted transfer using that record.

[Cardano adapter](src/funding/cardano/) · [Payer](clients/payer/) · [Payment protocol](docs/evidence/cardano-protocol.md)

### Solana funding

The Solana adapter uses Devnet, x402 SVM and existing token-program transfers. The supplied payer validates the mint, accounts and payment requirement, preserves its signed candidate and obtains authenticated sponsor preparation. The gateway checks the transfer and finality through RPC before applying funding.

Sponsor preparation is part of this payer's transaction path: it separates the token payment from the network-fee signature while retaining a single candidate for submission and recovery. The hosted judge walkthrough connects the Cardano payer; the demonstrated Solana path uses its supplied payer and facilitator.

[Solana adapter](src/funding/solana/) · [Payer and facilitator](clients/solana/) · [Completed hotel run](docs/evidence/nuitee-solana-combined-pass-20261007.md)

### Paying an agent is a separate commercial relationship

Masumi handles payment for an agent's work. Its native task runtime correlates the external task with Capsule's purchase, manages the service-fee escrow and submits the result. The recorded integration includes seller payout verification.

The price of the agent service and the price of the goods are separate obligations. A fee paid for arranging a booking does not settle the booking's principal. That distinction is preserved in the payment model and task result, allowing paid agent work to coexist with ordinary commerce behind the same core.

[Native task runtime](src/channels/sokosumi/) · [Masumi integration](docs/work/MASUMI_INTEGRATION.md)

## Separate customer purchase funding from operational treasury

Capsule treats customer settlement, company treasury and fiat observation as different financial domains because they answer different questions.

**Customer purchase funding** is transaction-specific. Cardano Preprod and Solana Devnet prove that the approved customer obligation was funded before merchant execution.

**Operational crypto treasury** is company-side. Coinbase CDP Server Wallets give Capsule a programmable treasury on Base Sepolia that is not used as a substitute for Cardano/Solana purchase principal. In the completed external proof, the named treasury wallet received 0.0001 ETH from the CDP faucet and sent 0.000001 ETH to the named recipient. The transaction and resulting balances were independently verified through public Base Sepolia RPC.

That proof was executed with Coinbase's official `cdp` CLI. It establishes the external Server Wallet capability; Capsule's runtime adapter did not execute that exact transfer. The retained proof is recorded in the proof-closure lane as `docs/evidence/coinbase-cdp/server-wallet-proof.json` with the accompanying `docs/work/COINBASE_CDP.md`.

**Fiat observation** is read-only. OCBC sandbox data gives the operator visibility into fiat account/card state and activity. It is not a purchase-funding rail and does not prove that a Capsule purchase settled through the bank.

**Reconciliation** happens in Capsule's own accounting and evidence layer. PostgreSQL journal entries, funding evidence, receipts and the Treasury/Connections views keep observed crypto movements, simulated merchant capacity, fiat observations and customer obligations attributable. An operator can use those views to decide whether fiat and crypto liquidity need to be manually topped up, reconciled or rebalanced.

There is intentionally no automatic `OCBC → Coinbase CDP` transfer path in this prototype. The architecture provides the information needed for manual treasury decisions without collapsing bank observations and blockchain balances into one number.

## Let providers keep their own workflows

The commerce adapters translate the common purchase contract into the operation each provider expects. They share authority, funding and recovery rules, but keep provider-specific meanings of completion.

**Retail.** Shopify Global Catalog supplies product discovery and source-store information. The selected product is represented in Capsule's controlled Shopify test store for the demonstration checkout. Storefront and browser-backed quoting establish the test-store total; Playwright carries out checkout; Admin readback establishes the order's payment status. Authenticated webhooks provide hints for that readback. The quote and receipt retain both the discovery source and execution-store identity.

**Flights.** Atlas searches fares and verifies the selected routing before order creation. Authorised sandbox test-balance payment is followed by status readback. An order can be paid while ticket issuance is still processing, so the adapter keeps those stages distinct and reports a ticket only when the provider reaches the ticketed state.

**Hotels.** Nuitée / LiteAPI supplies room rates and prebooking to establish the quote. Once funding is applied, the adapter creates the sandbox booking and reads it back. The reservation confirmation and exact amount become part of the final purchase proof.

These differences explain why a generic successful HTTP response cannot be Capsule's definition of success. The provider adapter interprets the result; the core combines it with funding and receipt state. A flight and hotel can consequently be coordinated by one assistant as two purchases, each with its own quote and approval.

[Shopify implementation](src/execution/shopify/) · [Atlas implementation](src/execution/atlas/) · [Nuitée implementation](src/execution/nuitee/)

## Keep the purchase coherent through retries and delays

Provider calls and blockchain transactions do not share a database transaction with Capsule. A timeout can happen after an external system accepts an operation. Sending it again without checking can produce a second order or payment.

Capsule records intent and execution checkpoints before irreversible work. Purchases are idempotency-keyed, so repeated calls for the same approved quote resolve to the existing transaction. Payer history preserves the signed payment candidate. Provider recovery reads the existing outcome before deciding what happened.

The core lifecycle distinguishes the important situations:

```text
awaiting_funding -> funded_queued -> executing -> succeeded
                                          |--> unresolved
                                          |--> requires_reauthorization
                                          |--> failed
awaiting_funding -> expired
```

An unresolved operation remains a transaction to reconcile, rather than an instruction to start over. A changed price returns the decision to the user. Funding that arrives after a purchase closes remains recorded as an obligation rather than triggering a new purchase. This gives recovery a defined place in the transaction lifecycle.

PostgreSQL holds quotes, purchases, funding attempts, execution checkpoints, jobs, accounting entries and evidence. Uniqueness constraints, transaction boundaries and fenced job claims coordinate the worker. The hosted arrangement uses one gateway/worker configuration, with the payment signer separated into its own service.

[Core implementation](src/core/) · [Database layer](src/infrastructure/db.ts) · [Operational recovery procedures](docs/RUNBOOK.md)

## Explain amounts in the user's currency without changing the agreement

A Singapore-dollar budget and a US-dollar merchant quote are different representations of value. Capsule uses Frankfurter to connect them at the search and display layer.

For a Shopify search with an SGD budget, the gateway obtains a USD/SGD reference rate and freezes it with the search. It rounds the USD inventory ceiling down, then checks the final quote—including shipping, tax and service fee—against the original SGD budget, rounding the displayed equivalent up. Exact integer and rational arithmetic preserve the budget constraint. The quoted conversion remains unchanged through approval and purchase.

Commercial amounts and blockchain asset quantities also have distinct units. The hackathon uses a 1:1000 test notional: USD 91.07 corresponds to 0.091070 six-decimal test tokens, while the provider sandbox uses USD 91.07. The Frankfurter reference explains the user's budget; the test scale determines the demonstration payment quantity. Production currency conversion and merchant settlement are the next integration layer described in the [project's development path](PROJECT_SUBMISSION.md#the-opportunity-beyond-the-prototype).

OCBC supplies read-only sandbox observations of accounts, cards and transaction history. Those observations feed the operator-side treasury view described above, where they remain separate from customer funding, Coinbase CDP crypto treasury and simulated purchasing capacity.

[FX design](docs/FX.md) · [Frankfurter client](src/integrations/frankfurter/client.ts) · [OCBC adapter](src/banking/ocbc/adapter.ts)

## Make the result visible and inspectable

The console reads the gateway's purchase and evidence APIs. It displays payment progress, provider execution and the final result from the stored transaction state. A confirmed transfer alone is not an order confirmation; the completion view also needs the provider outcome and receipt.

This produces meaningful endings for different categories: **Order confirmed**, **Booking confirmed** or **Ticket issued**. The receipt and proof connect the commercial amount, selected funding method, transaction reference and provider result. Technical records remain available behind inspection rather than dominating the customer view.

The React console is read-only. Approvals stay in the assistant, and access keys stay in the browser tab's memory. Customer ownership and API permissions control data access; operator treasury and connection views require additional server-side permission. Traveller details and privileged bank information are kept out of the customer proof projection.

[Console contract](docs/contracts/CONSOLE_CONTRACT.md) · [Console implementation](web/) · [Evidence APIs](src/evidence/)

## Use CRE to connect the commerce record to public-chain evidence

Capsule's CRE workflow asks a specific question: does the payment behind this purchase agree with the recorded quote and outcome?

An HTTP trigger starts the TypeScript workflow. CRE's HTTP capability reads the bounded purchase proof and the Cardano transaction through Koios. Response projections select the relevant fields for identical-result consensus aggregation. The verifier checks the purchase and quote identity, funding status, exact recipient, asset and quantity, then the recorded merchant result and receipt.

The demonstrated CLI simulation targets one configured purchase. It serves that purchase's retained proof from a local read-only source and reads the Cardano transaction afresh from Koios. This gives the verification two explicit sources: Capsule for its purchase and merchant record, and public-chain data for the payment. The workflow compiled to WebAssembly and returned `verified`.

Keeping this check alongside the purchasing path has a useful property: verification can be repeated without recreating a payment or order. The live-proof configuration uses a dedicated evidence-read credential; the demonstrated run uses the retained-proof configuration.

[CRE workflow][cre-source] · [Simulation result][cre-evidence] · [Setup and reproduction][cre-report]

## An architecture that can expand with the agent economy

An additional provider implements commerce operations without taking over funding or customer approval. An additional funding adapter implements payment verification without changing the merchant's booking process. An additional agent channel translates its interaction into the same core contract.

That is the reuse Capsule is designed around. Expanding from one provider or network does not require rebuilding each possible pairing. The shared transaction layer carries the agreed terms and result between them.

The gateway, hosted MCP and console share an Express service. PostgreSQL holds durable state, and signing remains in a separate payer process. [Runtime assembly](src/wiring.ts), the [environment reference](docs/ENVIRONMENT.md) and [hosted MCP guide](docs/channels/hosted-mcp.md) describe the implementation and operation of this arrangement. The complete stack is in [PROJECT_SUBMISSION.md](PROJECT_SUBMISSION.md#stack).

[cre-source]: https://github.com/dropandresetmain-prog/token2049-origins/blob/2695d6bd1110de4effa56e1b6e21232700025454/chainlink/capsule-chainlink/commerce-verification/main.ts
[cre-evidence]: https://github.com/dropandresetmain-prog/token2049-origins/blob/2695d6bd1110de4effa56e1b6e21232700025454/docs/evidence/chainlink-cre/commerce-verification-simulation.json
[cre-report]: https://github.com/dropandresetmain-prog/token2049-origins/blob/2695d6bd1110de4effa56e1b6e21232700025454/docs/work/CHAINLINK_CRE.md
