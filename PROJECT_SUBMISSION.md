# Capsule

**Any agent. Agent-native money in. Ordinary commerce out.**

<a id="main-track"></a>
## Web3 should not have to rebuild commerce to participate in it

The goods and services people want are already out there. Merchants have inventories, airlines have reservation systems, and hotels have booking platforms. The economy does not need to start again on a blockchain for Web3 to become useful within it.

Yet holding an asset onchain and using it to buy something are still different experiences. A merchant's checkout expects its own payment methods and processes. A wallet speaks another language. An AI agent, acting for the buyer, has to navigate both.

We built Capsule to connect those worlds from the buyer's side.

**Capsule is a commerce gateway for AI agents: one interface connecting onchain funding to existing commerce providers.** The agent brings the user's intent. The user chooses the purchase and approves its terms. Capsule coordinates funding, executes the provider's purchase workflow and brings back the confirmation.

Our ambition is straightforward: make existing commerce accessible to the emerging agent economy, with Web3 as a practical way to fund it—not something every merchant has to adopt first.

[Try Capsule](README.md#judge-quick-start) · [Cardano](#cardano) · [Solana](#solana) · [Chainlink](#chainlink) · [Architecture](ARCHITECTURE.md) · [Technology stack](#stack)

<a id="why-now"></a>
## Agentic commerce is becoming infrastructure, not just an idea

The shift is already visible in what major platforms are building. In September 2025, OpenAI and Stripe introduced the [Agentic Commerce Protocol][market-acp] alongside Instant Checkout in ChatGPT. In January 2026, Google and Shopify introduced the [Universal Commerce Protocol][market-ucp], covering discovery, checkout and post-purchase interactions. In April, Visa announced [Intelligent Commerce Connect][market-visa] to help agent builders and businesses connect agent-initiated purchases to payment infrastructure.

These are investments in a different way of buying: people express what they need, and software carries more of the transaction on their behalf. The interface is moving from a sequence of pages and forms towards an agent that can coordinate the job.

We see two developments converging. Agents are becoming a new source of purchasing activity. Onchain assets provide programmable money that software can transfer and verify. The opportunity is to make them useful together in the existing economy.

That opportunity needs more than a better shopping conversation. It needs infrastructure that can turn an authorised request into a completed transaction across systems that were not built together. **This is the layer we are building with Capsule.**

## Move the integration to the buyer, not every merchant

One route to Web3 commerce is to persuade sellers to accept a new payment method or join a new ecosystem. That can work, but it makes the buyer's reach depend on the seller changing first. An agent faces an additional integration problem: each commerce provider has its own way to quote, charge, book and confirm.

Our approach keeps those existing commerce systems in place. Capsule integrates their interfaces and presents a common purchasing contract to the agent. Funding is handled on the other side of that contract, so the commerce provider's workflow does not have to become a blockchain workflow.

This also defines where Capsule sits alongside the emerging standards. MCP provides the agent interface; commerce protocols and provider APIs provide access to inventory and transactions; blockchain payment infrastructure provides a funding path. Capsule coordinates them around a single approved purchase. We build on those foundations rather than asking another ecosystem to form around us.

For an agent builder, that means a common way to transact across supported providers. For a Web3 ecosystem, it creates a route towards everyday purchasing utility. For merchants reached through those providers, the proposition is access to new buying activity through familiar commerce infrastructure.

**The product is access to commerce. Payment, checkout and verification make that access usable.**

## One purchasing experience, across different systems

The user stays in the assistant they already use. They ask for something, compare the options and choose. Capsule then obtains an exact quote, including the costs needed to complete the purchase, and presents the available funding options. The user approves the particular purchase and payment method—not an open-ended instruction to spend.

Once funding is confirmed, Capsule carries out the commerce operation. A retail order, a hotel booking and an issued airline ticket have different completion rules, but the agent uses the same sequence:

**Find → Quote → Approve → Fund → Purchase → Confirm.**

That consistency is the value of the gateway. The agent does not need to manage a merchant's checkout state or decide whether a timed-out booking should be sent again. Capsule keeps the transaction record and checks the provider's result.

The Capsule console makes the process visible. It shows the purchase, payment, progress and final confirmation, with transaction and receipt details available to inspect. The assistant is where the user makes decisions; the console is where they see those decisions carried through.

The [four MCP tools](ARCHITECTURE.md#agent-interface) expose this experience to agents. The same underlying HTTP contract supports other clients and our native paid-agent task integration.

## Why the transaction layer matters

An agent can produce a convincing sentence saying an order is complete. The useful question is whether the money moved and the merchant confirmed the purchase.

Capsule treats those as facts to establish. A quote fixes the price and payment terms. Approval binds the user's choice to that quote. A separate payer signs the payment. Provider readback establishes the outcome. The receipt connects the funding and commerce records so that the result can be examined afterwards.

The same discipline matters when something takes longer than expected. A network timeout is not a reliable answer to whether an order exists. Capsule records the attempt and checks the existing transaction instead of blindly creating another one. This is what makes a common agent interface practical for consequential actions, rather than just convenient for calling APIs.

[ARCHITECTURE.md](ARCHITECTURE.md) explains the design behind that transaction lifecycle, including authority, signing, persistence and recovery.

<a id="evidence"></a>
## Different purchases, the same underlying idea

Retail, flights and hotels are deliberately different tests of the gateway. Shopify involves product discovery and checkout. Atlas involves fares, orders and ticket issuance. Nuitée involves room rates, prebooking and reservation confirmation. We have brought these provider workflows behind the same Capsule contract.

A forgotten travel adapter illustrates a retail purchase. Arranging a flight and hotel for Singapore's F1 weekend illustrates an agent coordinating different services. These are examples of what the infrastructure is for, not the limits of the product. A flight and a hotel remain two separately approved transactions within the conversation.

The completed runs below demonstrate a Cardano-funded flight purchase and a Solana-funded hotel booking. They include blockchain payment, provider confirmation and receipts. CRE adds a verification workflow that checks a purchase record against public-chain data.

Our hackathon prototype uses public-testnet payments and provider sandboxes. Commercial amounts remain in USD, with a disclosed 1:1000 notional scale for the test-token payment. Shopify product discovery reads real listings; its demonstration orders execute in Capsule's own Shopify test store. This lets us exercise the purchasing workflows without charging or booking real customer inventory.

<a id="cardano"></a>
## Cardano — an economy where agents can pay and get paid

An agent economy needs both sides of a transaction: agents that can purchase what they need, and agents that can earn for the work they perform. Cardano's combination of [x402 payments and Masumi's agent-commerce infrastructure][cardano-agentic] gives Capsule a foundation for both.

What makes that combination valuable is the connection between payment and the work being purchased. The Cardano ecosystem brings together native-asset transfers, programmable payment terms and agent-service infrastructure. Capsule applies those capabilities to a concrete goal: letting an agent transact beyond a blockchain-native marketplace.

### Funding an ordinary purchase

When the user chooses Cardano, Capsule creates an x402 payment requirement for the approved purchase. The separate payer checks the amount, asset and recipient before signing. Capsule verifies the payment and releases the purchase to the commerce provider. The user experiences a purchase; the payment underneath it is a Cardano transaction.

We demonstrated this with an Atlas sandbox flight from Manila to Cebu. A payment of **0.022870 Preprod tUSDM** funded the **USD 22.87** commercial test amount. The flow continued through the provider's order, test-balance payment and ticket issuance, ending with a receipt. One approved purchase connected the onchain payment to the airline-provider result. [View the completed purchase and Cardano transaction record](docs/evidence/atlas-cardano-combined-pass-20261007.md).

The implementation uses Cardano Preprod, x402 Cardano, the Evolution SDK, Blockfrost-backed chain reads and the configured facilitator. Its [funding adapter](src/funding/cardano/) and [payer](clients/payer/) sit behind the same commerce interface used by the other providers and funding options.

### Paying for the agent's work

Masumi handles a complementary transaction: remuneration for an agent service. Capsule's native task integration includes fee escrow, result submission and independently verified seller payout. The service payment compensates the agent for its work; the purchase principal pays for the product or booking. Keeping those amounts distinct makes their commercial roles clear. [View the Masumi integration and payout evidence](docs/work/MASUMI_INTEGRATION.md).

Together, these paths show why Cardano is a strong fit for this project. Its role extends from a verifiable payment into the economics of agents working for one another. Capsule brings that foundation to ordinary purchasing workflows—the kind of practical utility that can help an agent economy grow beyond crypto-native services.

### Cardano track fit at a glance

The [BuilderBase Cardano track][builderbase-cardano] asks for a working Cardano prototype, documented source, a product demo of no more than three minutes, and a short explanation of the problem, technical approach and real-world path. Capsule answers those requirements directly:

| BuilderBase asks for | Capsule provides |
| --- | --- |
| Working prototype on Cardano | Cardano Preprod is a purchase-funding rail in Capsule. The completed Atlas run links a real Preprod transfer to provider execution, ticket issuance and a final receipt. |
| Repository with documentation | The submission repository contains the implementation plus this written pitch, [README](README.md), [ARCHITECTURE](ARCHITECTURE.md) and the retained Cardano/Masumi evidence. Judges receive repository access through the submission. |
| Demo video, maximum 3 minutes | The end-to-end Capsule Shopify recording is the product demo. The same ≤3-minute cut is embedded in the shared deck and linked directly in the Cardano submission. |
| Short write-up covering the problem, technical approach, Cardano infrastructure and real-world deployment/access | The shared problem/solution narrative, this Cardano section, the technology stack and [ARCHITECTURE](ARCHITECTURE.md) together form that write-up. |
| GitHub repository, live project/demo and presentation slides | Capsule uses the shared repository, hosted MCP/console and shared stage deck for the Main and partner-track submissions. |

<a id="solana"></a>
## Solana — making onchain payments useful in everyday commerce

A payment network becomes more useful when its assets can reach more things people want to buy. Solana's emphasis on [fast confirmation, low transaction costs and fee sponsorship][solana-payments] fits the experience agentic commerce needs: payment that software can initiate and users can follow without making the network mechanics the centre of the purchase.

Capsule connects that payments capability to the same commerce providers available through its other funding options. A user selects Solana on the quote, approves the terms and funds the purchase. The provider receives its ordinary booking or checkout operation; the agent retains the same interface.

Our implementation uses x402 SVM and Solana's existing token-program functionality. A bounded payer validates the payment, obtains sponsor preparation and submits the signed transaction. Capsule checks the transfer and its finality before completing the funding step.

We demonstrated the complete path with a Nuitée sandbox reservation at Jyu Capsule Hotel in Singapore. **0.091070 Devnet test USDC** funded the **USD 91.07** commercial test amount. The transaction reached finalized commitment, Nuitée confirmed the booking, and Capsule returned the receipt and linked proof. [View the Solana Explorer transaction](https://explorer.solana.com/tx/66jSAnq9eywGKGULpyRWYpskjTneFGcy9VJbNwg6xkHBPYiXt2Ni5HQPzW9hGur6AB4qDNDFt1TfnKMVdgemsV8L?cluster=devnet) · [View the completed booking](docs/evidence/nuitee-solana-combined-pass-20261007.md).

The significance is the connection, not simply the transfer: Solana payment infrastructure becomes part of a recognisable consumer outcome. For agent and wallet builders, Capsule's common contract offers a way to bring that capability into purchasing experiences without rebuilding the merchant integration for each funding network. The [Solana adapter](src/funding/solana/) and [payer implementation](clients/solana/) show how the two sides connect.

### Solana track fit at a glance

The [BuilderBase Solana track][builderbase-solana] asks for meaningful Solana interaction on Devnet or Mainnet Beta, a working product, and transaction proof. Capsule's Solana path is an active funding rail rather than a read-only blockchain display:

| BuilderBase asks for | Capsule provides |
| --- | --- |
| Meaningful interaction with Solana | Capsule uses Solana as purchase-principal funding through x402 SVM and existing token-program transfers. The payment gates the commerce operation. |
| Functional on Devnet or Mainnet Beta | The demonstrated flow runs on **Solana Devnet** and reached finalized commitment before the hotel purchase completed. |
| Solana Explorer or Solscan transaction | [Finalized Devnet transaction](https://explorer.solana.com/tx/66jSAnq9eywGKGULpyRWYpskjTneFGcy9VJbNwg6xkHBPYiXt2Ni5HQPzW9hGur6AB4qDNDFt1TfnKMVdgemsV8L?cluster=devnet). |
| Program ID and cluster when deploying a custom program | Capsule integrates existing Solana token-program functionality rather than deploying a custom program; the demonstrated cluster is Devnet. |
| Working demo, repository and presentation | The shared Capsule app/console demonstrates the same purchasing contract, while the completed Solana-funded Nuitée booking provides the retained end-to-end proof. The shared repository and deck carry the implementation and presentation. |
| Hackathon-built code / disclose pre-existing work | Capsule's application and submitted integrations are the hackathon build; third-party SDKs, public APIs and developer tooling are dependencies rather than claimed original work. |

<a id="chainlink"></a>
## Chainlink — connecting payment facts to commerce outcomes

Agentic commerce crosses an important boundary: payment may be recorded onchain while the purchased service is recorded in a provider's system. Trust requires a way to connect those facts. A generated success message is not enough.

This is where [Chainlink Runtime Environment][cre-docs] is particularly relevant. CRE brings blockchain data, external APIs and verification logic into an orchestrated workflow. For Capsule, that means a way to examine a commerce record against the underlying payment rather than relying only on what the agent reports.

We built an HTTP-triggered TypeScript CRE workflow for commerce verification. It reads Capsule's purchase proof and obtains the corresponding Cardano transaction through Koios. The workflow checks that the purchase, quote, funding asset, recipient and quantity agree, then checks the recorded merchant result and receipt. Selected response fields pass through identical-result consensus aggregation before the verifier returns its verdict.

The successful CRE CLI simulation compiled the workflow to WebAssembly and returned **`status: verified`**. It combined retained proof from the completed Cardano/Atlas purchase with a fresh Koios chain read during execution. The blockchain payment was checked independently; the merchant and receipt facts came from Capsule's purchase record. [View the simulation result][cre-evidence] · [Workflow source][cre-source] · [Reproduce the simulation][cre-report].

CRE's contribution is an orchestration layer for verifiable commerce: a repeatable check connecting onchain value movement with an offchain purchase record. It runs alongside purchase execution, so verification can be examined without initiating another payment or order. This is a concrete application of Chainlink's ability to connect blockchain systems to the outside world—and a useful foundation for agents that must show their work when they spend.

### Chainlink track fit at a glance

The [BuilderBase Chainlink track][builderbase-chainlink] asks for CRE to orchestrate a workflow that connects blockchain state to an external system, plus successful simulation or deployment evidence. Capsule uses CRE in its verification layer:

| BuilderBase asks for | Capsule provides |
| --- | --- |
| CRE Workflow used as an orchestration layer | Capsule's HTTP-triggered CRE commerce-verification workflow coordinates the proof checks that connect a Capsule purchase record with its public-chain payment. |
| At least one blockchain connected to an external API, system, data source, LLM or agent | The workflow combines a Cardano Preprod transaction read through Koios with Capsule's purchase-proof data. |
| Successful CRE CLI simulation or live CRE deployment | The CRE CLI simulation compiled the workflow to WebAssembly and returned **`status: verified`**. |
| Evidence of the successful simulation/deployment | [Simulation result][cre-evidence] · [Workflow source][cre-source] · [Reproduction guide][cre-report]. |
| GitHub repository, live project/demo and presentation slides | The shared Capsule repository, hosted project and deck carry the product; CRE evidence is linked directly from this section. |

<a id="treasury"></a>
## Keep customer settlement and company treasury separate

Agentic commerce creates two different financial jobs. A customer purchase needs an approved payment attached to one transaction. The company operating the gateway also needs its own treasury view across crypto liquidity, fiat observations and outstanding obligations. Capsule keeps those jobs separate.

| Financial domain | Capsule uses | Role |
| --- | --- | --- |
| Customer purchase funding | Cardano Preprod and Solana Devnet | Funds individual approved customer purchase obligations. |
| Operational crypto treasury | Coinbase CDP Server Wallets on Base Sepolia | Gives Capsule a programmable company-side crypto treasury, separate from customer purchase principal. |
| Fiat observation | OCBC sandbox APIs | Gives the operator a read-only view of fiat account/card state and activity. |
| Accounting, proof and reconciliation | Capsule's PostgreSQL journal, funding evidence, receipts, Treasury and Connections views | Keeps crypto movements, fiat observations, simulated merchant capacity and customer obligations attributable instead of collapsing them into one balance. |

### Coinbase CDP as the operational crypto treasury

Coinbase CDP gives Capsule a programmable treasury that is independent of the customer payment rails. In the completed Server Wallet proof, Capsule created the named test treasury **`capsule-treasury-test`** on Base Sepolia at **`0xa4ce927fdA1d30EfBC0CE81877e53036A75fD486`**. The CDP faucet funded it with **0.0001 ETH**, and the treasury sent **0.000001 ETH** to the named test recipient **`0x708FCca1Ff481D47782fadF6814fF61Fcc2E4570`**.

Transaction **`0xb0348248fa5166944be2db148f8d05e7d76b0f5f8e9746dcdcc8b2596a9cdb2d`** succeeded on Base Sepolia. Sender, recipient, value and resulting balances were independently read back through public RPC, and both accounts were visible through CDP.

The external proof was executed with Coinbase's official **`cdp` CLI**. That establishes the Server Wallet capability and treasury role; it does not claim that Capsule's runtime adapter executed this exact transfer. Submission evidence is recorded in the proof-closure lane at **`c74ff8b`**, with **`docs/work/COINBASE_CDP.md`** and **`docs/evidence/coinbase-cdp/server-wallet-proof.json`**.

### Fiat ↔ crypto reconciliation without pretending they are one balance

OCBC observes fiat. Coinbase CDP manages operational crypto treasury. Cardano and Solana record customer-funding positions. Capsule's journal and proof layer bring those facts into one operator view without treating them as interchangeable money.

That gives an operator enough information to decide when liquidity needs to be topped up, reconciled or manually rebalanced between fiat and crypto. The prototype does **not** automate an OCBC-to-CDP transfer or fiat conversion; the reconciliation decision remains manual.

**Customer payments and company treasury are intentionally separate: Capsule can reconcile its crypto treasury against fiat observations without pretending testnet crypto is bank cash.**

## Partner and infrastructure proof at a glance

| Integration | Status | Product role | Demonstrated proof |
| --- | --- | --- | --- |
| Cardano | **PASS** | Customer purchase funding + agent remuneration | Preprod x402-funded Atlas flight; Masumi task/escrow/result/payout evidence. |
| Solana | **PASS** | Customer purchase funding | Finalized Devnet test-USDC payment followed by confirmed Nuitée sandbox booking and receipt. |
| Chainlink CRE | **PASS** | Cross-system commerce verification | CRE CLI simulation returned `status: verified` using Capsule proof data plus a fresh Cardano chain read through Koios. |
| Coinbase CDP | **PASS** | Operational crypto treasury | Server Wallet created/funded on Base Sepolia; 0.000001 ETH treasury transfer; independent public-RPC readback. Evidence: `c74ff8b`, `server-wallet-proof.json`. The official `cdp` CLI executed this proof. |
| OCBC | **PASS — read-only** | Fiat observation | Sandbox account/card/history observations exposed to Capsule's operator-side financial view; not used as purchase-settlement proof. |

## The opportunity beyond the prototype

Our initial audience is agent builders and platforms that want purchasing capability without building a separate commerce operation for every use case. Wallet-connected assistants are a natural extension: they already have the user relationship, while Capsule can supply the transaction interface and provider integrations.

The expansion model follows the architecture. Each new commerce adapter adds a category of purchasing capability that connected agents can use. Each new funding adapter makes those capabilities accessible through another payment source. The shared quote, approval, execution and confirmation process is reused across them.

That is how this kind of infrastructure can support both agentic commerce and Web3 adoption. Agents become more useful because they can act in the existing economy. Onchain assets gain a route towards practical purchasing utility. Providers can be reached through the interfaces they already operate, rather than requiring every seller to become part of a new blockchain ecosystem.

The prototype is accessed through a hosted MCP gateway and web console. Our production path is to connect the transaction engine to production merchant permissions and a licensed conversion and settlement partner, then add customer-specific access and spending controls. Scaling the service means expanding provider coverage and isolating execution workloads while keeping purchase authority and recovery in the shared core. These are the next steps from the testnet-and-sandbox implementation demonstrated here.

**We do not think the agent economy should have to build its own inventory of the world. It should be able to transact with the world that already exists. Capsule is the commerce layer we are building to make that possible.**

<a id="stack"></a>
## Technology stack and integrations

The stack follows the product: an agent interface, a transaction engine, funding and commerce connections, and a visible result. Each technology below has a specific role in that system.

| Layer | Technology and contribution |
| --- | --- |
| Agent interface | MCP TypeScript SDK, Streamable HTTP and OAuth connect assistants to Capsule's four commerce tools. The HTTP API is the shared transaction contract. |
| Transaction engine | Node.js 24+, TypeScript, Express and Zod implement input validation, quoting, authorisation and purchase coordination. |
| State and recovery | PostgreSQL and node-postgres persist quotes, purchases, execution jobs, accounting records, payment evidence, OAuth state and hosted payer history. |
| Retail discovery | Shopify Global Catalog / UCP discovers products and retains their source-store identity. |
| Retail execution | Shopify Storefront and Admin APIs, authenticated webhooks, Playwright/Chromium and Shopify's test gateway support quoting, controlled test-store checkout and order readback. |
| Flights | Atlas provides sandbox flight search, fare verification, ordering, test-balance payment and ticket status. |
| Hotels | Nuitée / LiteAPI provides hotel rates, prebooking, sandbox reservations and booking confirmation. |
| Cardano funding | Cardano Preprod, x402 Cardano and Evolution SDK provide the native-asset payment path; Blockfrost and the Cardano facilitator support chain verification and submission. |
| Solana funding | Solana Devnet, Solana Kit, x402 SVM and RPC provide token transfers, sponsor preparation and finalized transaction checks. |
| Operational crypto treasury | Coinbase CDP Server Wallets provide a programmable company-side treasury on Base Sepolia, separate from customer purchase funding. The completed external proof used the official `cdp` CLI and was independently read back through public RPC. |
| Payment protocol | x402 v2 and the x402 SDKs supply the shared HTTP payment requirement and signed-payment exchange used by the funding integrations. |
| Agent remuneration | Masumi Payment Service and registry, with the native Sokosumi/MIP-003 task adapter, support paid agent tasks, escrow, result submission and seller payout. |
| Commerce verification | Chainlink CRE SDK and CLI orchestrate proof verification; Bun and Javy compile the TypeScript workflow to WebAssembly. Koios supplies the independent Cardano chain read. |
| Currency reference | Frankfurter v2 translates an SGD shopping budget into a USD search ceiling and preserves the reference rate used to display the final quote. |
| Fiat observation | OCBC sandbox APIs supply read-only account, card and transaction-history observations to operator views, giving the treasury side visibility into fiat state without turning those observations into purchase-settlement evidence. |
| Console | React, React DOM and Vite provide the purchase-progress, confirmation and proof interface. |
| Hosting and packaging | Render hosts the gateway and separate Cardano payer. Docker and Docker Compose package services and provide local PostgreSQL. |
| Development and verification | Vitest, TypeScript checks and tsx support contract, integration and component testing. |

Implementation details and source links are in [ARCHITECTURE.md](ARCHITECTURE.md), [package.json](package.json), the [FX reference](docs/FX.md) and the [technical documentation index](docs/DOCS_INDEX.md).

[builderbase-cardano]: https://builderbase.com/track/cardano-agentic-commerce
[builderbase-solana]: https://builderbase.com/track/solana-best-use-of-solana
[builderbase-chainlink]: https://builderbase.com/track/chainlink-best-workflow-with-cre
[market-acp]: https://openai.com/index/buy-it-in-chatgpt/
[market-ucp]: https://blog.google/products/ads-commerce/agentic-commerce-ai-tools-protocol-retailers-platforms/
[market-visa]: https://corporate.visa.com/en/sites/visa-perspectives/newsroom/visa-intelligent-commerce-connect-ai-shopping-for-businesses.html
[cardano-agentic]: https://developers.cardano.org/x402/
[solana-payments]: https://solana.com/docs/payments
[cre-docs]: https://docs.chain.link/cre
[cre-report]: https://github.com/dropandresetmain-prog/token2049-origins/blob/2695d6bd1110de4effa56e1b6e21232700025454/docs/work/CHAINLINK_CRE.md
[cre-source]: https://github.com/dropandresetmain-prog/token2049-origins/blob/2695d6bd1110de4effa56e1b6e21232700025454/chainlink/capsule-chainlink/commerce-verification/main.ts
[cre-evidence]: https://github.com/dropandresetmain-prog/token2049-origins/blob/2695d6bd1110de4effa56e1b6e21232700025454/docs/evidence/chainlink-cre/commerce-verification-simulation.json
