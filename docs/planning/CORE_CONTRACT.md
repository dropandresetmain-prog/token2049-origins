# Core contract — initial integration SSOT

Version: `v1`; implementation defaults proposed by this launch plan. Commit executable schemas and contract tests at the first code checkpoint. Those schemas become canonical; update this document when changing them. The core lead owns changes; parallel lanes propose changes rather than editing shared contracts unilaterally.

## Separation

- **Channel adapter:** authenticates/identifies its caller, translates input/output and calls core. ChatGPT/plugin, MCP and Sokosumi concerns live here.
- **Core:** validates authority, owns immutable quotes, purchase state, persistent jobs, reservations, journal and evidence links.
- **Funding adapter:** generates protocol requirements and independently verifies payments. It never books commerce.
- **Commerce executor:** resolves/requotes/executes/retrieves provider objects. It cannot mark funding valid or write financial tables.
- **Bank adapter:** returns provenance-bearing OCBC observations for supported APIs. It does not fabricate card-network events.
- **Payer client/signer:** separately configured bounded signing capability. Private payer keys must not be loaded by the commerce gateway process.

A local-only separate signer process is sufficient for disposable test wallets; no signing platform is required. Hosted channels can call an authenticated bounded signer bridge later. Neither a client-supplied agent ID nor a wallet alias confers spending authority.

## Money and evidence

`Money` carries `currency`, `amountMinor` as an integer string, and `scale`. Crypto amounts similarly carry a full network ID, asset ID/mint/policy, decimals and integer base units. No binary floating-point arithmetic for money. USD is reporting currency, not a replacement for original currency/token quantities.

Every external fact includes source, environment, reference, observed time and verification status. Separate dimensions:
- chain environment: Preprod / Devnet;
- provider environment: sandbox / test / production;
- evidence mode: fresh external response / replay / local fixture;
- ledger mode: externally observed versus internally simulated.

Test-token USD valuation is a stated demo convention, not a market price or redeemability claim. One displayed ticker is never an asset identity.

## Common objects

### ActorContext

Authenticated principal, channel identity and scopes. Resolved server-side; carries no credentials in public results. Isolate one customer's quotes, profiles, purchases and receipts from another's.

### PurchaseIntent

A tagged category (`retail`, `hotel`, `flight`), objective/selected target, quantity or travel parameters, buyer profile reference, spending ceiling and currency. Use category-specific validated requirements rather than either a giant hotel-shaped object or unchecked arbitrary JSON. The customer's agent can do reasoning; the core is not another general-purpose chatbot.

### ExecutableOffer and Quote

Offer: provider route, concise description, terms, source timestamp and an opaque server-held execution reference.

Quote: immutable `quoteId`, actor, offer, exact buyer/fulfillment configuration, full price breakdown, merchant amount/currency, service fee if any, payable principal, expiry, chosen execution route and quote digest. Requotes produce new versions/IDs; do not mutate the already-funded quote. Account for shipping/tax before asking for purchase funding. A search result or estimate is not executable.

### Purchase

`purchaseId`, owner, quote/version, policy/approval reference, state, funding references, execution attempt, reservation and receipt references. Persist before any side effect. Tie idempotency to actor + operation + key + request digest. Same key and different payload is a conflict.

### FundingAuthorization / FundingEvidence

Core-issued purchase authority is distinct from adapter-verified payment evidence. Evidence identifies purchase and quote digest, rail/network, asset, base-unit amount, payer/payee, unique external transfer reference, confirmation/finality policy, timestamps and purpose (`purchase_principal`, `service_fee`, or an explicitly split combined amount).

Payment states distinguish `not_received`, `submitted`, `confirmed`, `escrow_locked`, `released`, `refunded`, `invalid` and `unknown`. Default direct-purchase gate requires verified confirmed principal covering the quote. An escrow lock is not cash received. Enabling escrow-backed execution requires a separately documented trust policy after the Masumi lane proves the lifecycle.

Never accept `funded: true`, a claimed tx hash, a channel's `success` flag or Sokosumi task credits as authoritative funding. Verify them using the actual configured network/payment service. Bind verification to the resource/quote and track consumed transfer/output references to prevent reuse.

### MerchantOutcome / PurchaseReceipt

Keep commerce status separate from payment and bank settlement: an order can be created but unpaid, a payment authorized but not captured, and a flight reserved but not ticketed. Normalize only semantics the provider actually supports. Preserve provider references and amounts in private evidence, return a curated receipt.

Receipt contains purchase/quote identifiers, principal and fee, funding summary, provider order/booking reference, verified commerce/payment status, treasury effect summary, evidence references and environment labels. No keys, PAN/CVV, full raw provider payloads, address/passport details or signed payment payloads.

## Canonical HTTP and tool surface

Initial proposed endpoints:

| Endpoint | Purpose |
|---|---|
| `POST /v1/offers/search` | Find supported offers from validated intent |
| `POST /v1/quotes` | Revalidate selected offer and return exact terms |
| `POST /v1/purchases` | Create idempotent purchase, check authority, return funding instructions; no merchant spend yet |
| `POST /v1/purchases/:id/fund` | x402 protected purchase-funding resource; verify/settle selected payment using SDK |
| `GET /v1/purchases/:id` | Status and safe receipt/evidence summary |
| `GET /v1/purchases/:id/events` | Redacted ordered event history for authorized caller |
| `GET /v1/capabilities` | Supported routes, environments and readiness, without secrets |

Thin MCP tools: `find_offers`, `create_quote`, `buy`, `get_purchase`.

`buy` coordinates create/fund/status through the payment-aware client and bounded signer where available; otherwise returns payment-required/action-required, not fake completion. MCP does not magically turn ChatGPT into an x402 signer. Canonical HTTP remains usable independently of any channel.

No public “mark funded”, “mark paid”, balance editor, replay/live switch or unrestricted generic card/payment tool. Provider webhooks live behind dedicated authenticated/verified handlers. Do not trust input URLs for callbacks or webhooks without validation.

Use the selected SDK's actual x402 version, headers and network identifiers. Advertise only scheme/network/asset combinations the running server and facilitator can settle. A conceptual `cardano:preprod` label is not a specification. The combined Cardano/Solana challenge must be tested; do not claim wire compatibility merely because both support HTTP 402.

## Durable execution and journal invariants

1. Purchase creation, reservation, job creation and journal updates use database transactions where appropriate. Persist an execution attempt before issuing the external request.
2. A queued worker checks valid funding, approval, quote validity, permitted provider/environment and available capacity before any irreversible operation. A request timeout cannot cause another order automatically.
3. Persist a job table/outbox with unique claims and recovery on restart. One worker in one gateway process is enough initially. Do not introduce Redis or a workflow service for this.
4. Unknown external outcome retains exposure and enters reconciliation. A definite uncharged failure can release reservation; it does not by itself return already-received crypto.
5. Journal entries are immutable, balanced by native currency/asset, reference a purchase/external event and are protected by unique event keys. USD reporting valuations are separate. Include opening balances/equity and liabilities; do not use a decorative debit/credit column over mutable counters.
6. Receiving test crypto increases a crypto observation/customer funding obligation, not OCBC cash. Define sandbox fiat/card capacity explicitly. Keep card capacity, pending obligations, merchant spend, bank snapshots and card payable distinct; do not count the same money twice.
7. Shopify paid evidence finalizes the simulated merchant-payment result once. It does not prove issuer clearing, fiat conversion, physical fulfillment or an OCBC balance change. A booking result likewise needs its provider-specific payment/ticketing state.
8. A purchase cannot consume the same proof twice or execute twice across competing channel calls. A second incoming payment must remain an unapplied/refundable obligation rather than fund another order silently.
9. External callbacks are authenticated or followed by authenticated provider readback before committing state. Duplicate/out-of-order events cannot duplicate journal entries or regress finalized state.
10. Approval covers merchant/offer, exact principal/fee, currency, destination/travellers, expiry and a spend ceiling. Changed financial or fulfillment terms require fresh authority; an LLM cannot approve its own broader mandate.

## Masumi integration seam

Sokosumi maps `externalTaskId` to a core purchase and translates task input/result. Masumi funding evidence is a separate adapter, not a privileged channel shortcut. Keep service-fee earnings, purchase principal and escrow receivables distinct.

The parallel lane must report whether the actual standard supports dynamic purchase amounts, pre-execution escrow funding, task continuation and payout timing. Until proven, use the ordinary core funding gate and present required funding/action honestly. Do not complete paid purchasing tasks with fixture results. On-chain result hashes contain no sensitive buyer data.

## Mandatory contract tests

- Equivalent authenticated requests from HTTP/MCP/Sokosumi test clients produce the same core operation and isolation rules.
- Bad/expired/mismatched funding, wrong asset/network/payee/amount and replayed proof cannot execute commerce.
- Duplicate concurrent buy calls and restart recovery do not issue a second order or journal posting.
- Insufficient capacity, expired/repriced quotes and altered shipping/traveller data are rejected or require renewed authority.
- Unknown provider outcomes do not free committed capacity or imply refunds.
- Unpaid orders/reservations do not become paid/ticketed receipts.
- No cross-customer reads/writes, unsafe URL fetches or fixture funding bypass in external-evidence mode.
- Redaction tests cover tool output, receipt, event stream, logs and browser traces.
