# Capsule architecture

Technical reference for the source inspected at `5343235ebe6c341abdda95450065950a3d1051b7`. This describes implementation and boundaries, not a fresh runtime acceptance result. Chainlink is explicitly identified as separate-branch work.

For the product narrative, complete stack and partner write-ups, use [PROJECT_SUBMISSION.md](PROJECT_SUBMISSION.md). For judge access, use [README.md](README.md). Executable contracts and current code win over prose when they differ.

## System shape

```text
User <-> existing AI assistant
                  |
            MCP / HTTP
                  |
       Capsule authenticated gateway
       + input and offer validation
       + immutable quote and approval
       + funding verification
       + durable purchase / jobs / journal
       + provider execution and readback
       + customer proof and receipts
          |          |           |
     PostgreSQL   funding     commerce
                  adapters    adapters
                     |           |
       separate bounded payers   + Shopify
       + Cardano Preprod         + Atlas
       + Solana Devnet           + Nuitee / LiteAPI

Read-only console <-> authenticated Capsule evidence API
Frankfurter -> SGD budget/reference display (not settlement)
OCBC -> read-only bank observations (not settlement)
Masumi runtime -> separate task remuneration + core correlation
CRE verification -> retained Capsule proof + Koios Cardano read
                    [separate branch; not in purchase critical path]
```

Runtime assembly is in [src/main.ts](src/main.ts), [src/composition.ts](src/composition.ts) and [src/wiring.ts](src/wiring.ts). Test adapters are injected through the composition boundary; deployed composition does not silently replace unavailable providers with fixtures.

## Channels, identity and authority

The HTTP API is the canonical commerce boundary. Local MCP and hosted MCP translate tool calls to that contract. The native Masumi MIP-003 runtime is another authenticated channel; it does not bypass core funding or execution.

| MCP tool | Core operation | Important boundary |
| --- | --- | --- |
| `find_offers` | `POST /v1/offers/search` | Indicative offers, not purchases. |
| `create_quote` | `POST /v1/quotes` | Provider-backed exact terms after an offer is chosen. |
| `buy` | Create approved purchase; invoke authorised payer where available | Explicit quote approval and funding choice; never an unrestricted wallet instruction. |
| `get_purchase` | `GET /v1/purchases/:id` | Read-only status; polling cannot create a payment or purchase. |

API clients are scoped and bound server-side to a customer. Channels submit an approval containing `quoteDigest`, `maxTotal` and `selectedFundingOptionId`; the core derives payment facts from the stored option. Approval records are evidence of channel-submitted authority, not cryptographic proof of which physical person clicked.

Missing canonical information returns structured `needs_input`. Hosted demo fulfilment can be filled from the saved customer profile; the model must not invent customer details. Fulfilment data is kept out of public purchase/proof projections.

The hosted `/mcp` endpoint shares the gateway's Express origin and uses OAuth authorization-code/PKCE, dynamic client registration, scoped tokens and passcode-gated consent. Tokens are stored as hashes. The owner consent gate is a restricted prototype access model, not public multi-tenant onboarding. See [hosted implementation](src/channels/hosted-mcp/), [channel contract](docs/contracts/CHANNEL_CONTRACT.md) and [hosted operations](docs/channels/hosted-mcp.md).

**Hosted versus local funding:** current hosted configuration permits the separate hosted Cardano payer and rejects a hosted Solana bridge. Solana's supplied payer/facilitator remains a separate evaluation path. Protocol support, branch implementation and deployed readiness are different facts. [Configuration](src/channels/hosted-mcp/config.ts)

## Quote, approval and purchase lifecycle

An offer is temporary discovery evidence. An exact quote binds provider terms, amounts, expiry, fulfilment and available funding options. Changing financial terms requires a new quote and approval, even when a budget would still cover them. Selection of a funding option is explicit; the first available rail is not selected silently.

Purchase states follow the [channel contract](docs/contracts/CHANNEL_CONTRACT.md):

```text
awaiting_funding -> funded_queued -> executing
                                       |-> succeeded
                                       |-> failed
                                       |-> unresolved
                                       |-> requires_reauthorization
awaiting_funding -> expired
```

Separate fields track funding, commerce and merchant-payment status. A created order, held booking or ticketing flight is not necessarily a completed purchase. The receipt/progress projection requires the corresponding durable completion facts. A confirmed chain transfer alone cannot make the console show a purchased product.

`POST /v1/purchases` is idempotency-keyed; the same key with a different request conflicts. MCP reuses the matching purchase for the same quote/funding choice. Payer history and core uniqueness constraints persist protection beyond a single tool invocation.

## Funding and signer boundaries

### Shared x402 contract

The selected rail's funding endpoint returns an x402 v2 payment requirement. The separate payer validates the frozen resource, network, asset, amount, recipient and policy before signing. The gateway records/reconciles funding through its adapter; execution is queued only after confirmed evidence is applied.

The gateway owns no payer private keys. Prepared funding references and irreversible-attempt checkpoints are persisted before external submission. Ambiguous payment outcomes retain their history and recovery obligations rather than authorising a newly constructed transfer.

### Cardano

[Cardano funding](src/funding/cardano/) and the [bounded payer](clients/payer/) use the configured facilitator, Blockfrost reads, x402 Cardano and Evolution SDK. The demonstrated network is Preprod and the demonstrated asset is six-decimal tUSDM. Application commitments bind the payment to the purchase and quote; the frozen public resource URL remains important during recovery. [Protocol and evidence](docs/evidence/cardano-protocol.md)

The hosted payer is a separate process/service, with protected signing material and a PostgreSQL-backed history bound to its wallet identity. Legacy history import preserves previous exposure; it is not a budget reset. Do not run the legacy signer in parallel or reset caps/history to make a demo succeed. The hosted consent passcode and console key are not payer keys.

### Solana

[Solana funding](src/funding/solana/) and [payer/facilitator](clients/solana/) implement the Devnet path using x402 SVM. The payer validates the challenge and token accounts, preserves its signed candidate, and calls authenticated `/prepare` for sponsor co-signing before submitting that candidate. Readback validates the transfer and finality; ledger state survives uncertainty. This additional preparation means universal stock-client interoperability is not claimed. [Payer source](clients/solana/pay.ts)

### Masumi is remuneration, not merchant principal

The [native task runtime](src/channels/sokosumi/) and [Masumi integration](docs/work/MASUMI_INTEGRATION.md) handle task correlation, fees/escrow, results and payout. Its principal-funding seam remains unavailable; fee-only evidence is rejected as purchase funding. A completed paid task can truthfully return a stopped or failed commerce outcome. Task completion must not relabel that outcome as a successful purchase.

### Amount domains

Commercial USD minor units, chain asset base units, simulated provider purchasing capacity and read-only bank observations are distinct. The 1:1000 testnet notional policy is not FX or a cash redemption. For example, USD 91.07 corresponds to 0.091070 six-decimal test tokens; the merchant sandbox still sees the commercial amount. Neither test crypto nor OCBC observations can be silently counted as bank/card purchasing capacity.

## Commerce providers

| Provider | Sequence | Truth and recovery boundary |
| --- | --- | --- |
| Shopify controlled store | Product -> exact Storefront/browser quote -> controlled checkout/test payment -> Admin readback | An order submission is not proof of payment; old ambiguous attempts stay retained. |
| Shopify Global | Live Catalog discovery -> source refresh -> durable shadow in Capsule's test store -> controlled quote/execution | The source merchant is discovery provenance only. It receives no demo order/payment. Source listed price is not the sandbox all-in total. |
| Atlas | Search -> `/verify.do` -> create -> authorised sandbox test-balance payment -> ticketing/readback | Ticketed is distinct from paid-and-ticketing. A timeout during create does not justify blind create repetition. |
| Nuitée / LiteAPI | Rates -> prebook -> sandbox book -> booking readback | Prebook verifies a rate; it does not establish a reservation or booking. Completion needs the provider result. |

Source: [Shopify](src/execution/shopify/), [Atlas](src/execution/atlas/), [Nuitée](src/execution/nuitee/). Atlas quote/execution readiness is gated by its authorised test-balance configuration. Provider sandboxes are not live fulfilment promises.

Shopify webhook authentication is verified before using a delivery as a reconciliation hint. A webhook schedules readback; it does not independently mark the purchase paid. [Runtime wiring](src/wiring.ts)

A flight and hotel can be two independently approved Capsule transactions in one agent conversation. There is no atomic travel bundle or cross-provider rollback guarantee.

## Auxiliary data connections

### Frankfurter

Shopify Global can accept an SGD budget while merchant quotes and funding remain USD-based. The [Frankfurter client](src/integrations/frankfurter/client.ts) requests a USD/SGD reference; malformed or unavailable data fails the SGD route rather than inventing a rate.

The original budget and a frozen rate snapshot remain authority/evidence. Integer/rational arithmetic rounds the USD search bound down and the final SGD reference payable up. Shipping, tax and service fee are included in the final budget check. Quote and purchase do not silently refresh FX after approval. This is a reference conversion, not a trade or an off-ramp. [Detailed FX contract and recorded read](docs/FX.md)

### OCBC

The [OCBC adapter](src/banking/ocbc/adapter.ts) supplies read-only sandbox observations of accounts, cards and history. Operator views display stored, masked observations. They are not a payment execution adapter and do not reconcile a purchase into real bank/card settlement. [OCBC protocol](docs/evidence/ocbc-protocol.md)

## Persistence, idempotency and recovery

PostgreSQL stores customers/clients, offers/quotes, purchases, funding requirements and attempts, reservations, execution checkpoints, jobs, journal and evidence; later hosted work adds OAuth and payer-history tables. Applied migrations are append-only. Exact schema authority is the code, not a stale migration-count list.

Core transactions, uniqueness constraints, job claims/fencing and checkpoints coordinate execution. The supported topology is one gateway/worker configuration per runtime, not a claim of proven horizontal scale. External provider calls are not atomically committed with the database; consequently Capsule does not promise universal exactly-once delivery across all providers.

Instead, it persists intent before irreversible work and conservatively handles uncertainty. Readback can confirm or leave an outcome unresolved. Funding arriving too late remains an observed obligation rather than authorising unapproved commerce. Restarts and retries must preserve signed candidates, spend history, journal facts and unresolved exposure.

See [core](src/core/), [database](src/infrastructure/db.ts), [channel contract](docs/contracts/CHANNEL_CONTRACT.md) and [operational runbook](docs/RUNBOOK.md).

## Console, evidence and privacy

The React console is served at `/console/`; `/` and the old `/proof` route redirect to it. It reads authenticated API data and does not approve, pay, create purchases or refresh bank data. Sample-source mode remains labelled separately. The access key stays in tab memory, not storage or URLs. A dedicated hosted console key can be provisioned for the MCP evaluation customer. [Console contract](docs/contracts/CONSOLE_CONTRACT.md), [hosted configuration](src/channels/hosted-mcp/config.ts)

Customer proof projects durable funding, merchant result, progress and receipt independently. Raw technical details live behind inspection; PII and privileged bank/operator data are not added to customer proof. Operator Treasury/Connections views require server-enforced operator access, not merely hidden navigation.

Provider-specific completion language follows the evidence: order confirmed, booking confirmed or ticket issued. An opaque provider reference is not relabelled as an airline PNR. [Presentation contracts](src/contracts/), [evidence implementation](src/evidence/)

## Chainlink CRE — separate verification component

The inspected [CRE branch](https://github.com/dropandresetmain-prog/token2049-origins/commit/2695d6bd1110de4effa56e1b6e21232700025454) is not integrated into this document's main baseline. Its HTTP trigger invokes CRE HTTP reads of a bounded Capsule proof and Koios Cardano transaction, projects only required fields for consensus aggregation and returns a sanitised verification result.

The successful retained simulation used a local fixture serving an existing Capsule proof and a fresh Koios read. It independently checked the chain output, but trusted the retained Capsule record for Atlas/receipt facts. The workflow cannot mutate purchases and is outside the purchase critical path. Production-mode live Capsule evidence authentication is not demonstrated; no DON deployment or confidential TEE execution is claimed.

[Workflow source](https://github.com/dropandresetmain-prog/token2049-origins/blob/2695d6bd1110de4effa56e1b6e21232700025454/chainlink/capsule-chainlink/commerce-verification/main.ts) · [Reproduction/evidence report](https://github.com/dropandresetmain-prog/token2049-origins/blob/2695d6bd1110de4effa56e1b6e21232700025454/docs/work/CHAINLINK_CRE.md) · [Submission qualification caveat](PROJECT_SUBMISSION.md#chainlink)

## Operating and verification boundary

The source uses Node 24+, PostgreSQL, container tooling and the documented Render origin. Hosted MCP and console are code-backed, but a documented URL is not a current health/access certification. Provider credentials, rail readiness, customer access and final candidate deployment must be checked through the existing release process, not inferred from the README.

[Environment](docs/ENVIRONMENT.md) and [hosted runbook](docs/channels/hosted-mcp.md) hold configuration detail. [PROJECT_SUBMISSION.md](PROJECT_SUBMISSION.md#evidence) identifies the selected historical proof and its limitations. No provider call, payment, deployment, build or runtime test was executed to produce this architecture document.
