# Channel contract v1 — for channel lanes (MCP, ChatGPT, Sokosumi/Masumi, console)

Canonical schemas: [`src/contracts/`](../../src/contracts/) (zod, executable). This document summarizes them; on
conflict the code wins. The core lead owns changes; other lanes propose changes (PR against `build/commerce-core`).

## Rules every channel follows

1. **Authenticate, translate, call core.** A channel holds a gateway API client token (`Authorization: Bearer …`)
   bound server-side to one customer, one channel label and a scope set. Client-supplied agent IDs, wallet aliases,
   task IDs or `success` flags confer nothing.
2. **No commerce logic, funding truth or journal writes in a channel.** There is no mark-funded/mark-paid route.
3. **Funding is verified by the core's funding adapter only.** A Sokosumi task credit, a Masumi payment request,
   a claimed tx hash or a fee payment is not purchase funding (see fee-only fixture below).
4. **Idempotency.** `POST /v1/purchases` requires `Idempotency-Key`. Channels derive it deterministically from their
   own correlation ID, e.g. Sokosumi: `sokosumi:<externalTaskId>`. Same key + different body ⇒ `409 idempotency_conflict`.
5. **PII stays in fulfillment.** Send traveller/shipping data only in `POST /v1/quotes.fulfillment`. Public results never
   echo it. Use synthetic data in sandbox.

## Operations

| Operation | HTTP | MCP tool | Scope |
|---|---|---|---|
| Find offers (not executable) | `POST /v1/offers/search` `{intent}` | `find_offers` | `offers:read` |
| Exact quote (immutable, digest) | `POST /v1/quotes` `{offerId, fulfillment}` | `create_quote` | `quotes:write` |
| Create purchase (no spend) | `POST /v1/purchases` `{quoteId, approval:{maxTotal, quoteDigest, selectedFundingOptionId}}` + `Idempotency-Key` | `buy` | `purchases:write` |
| Fund (x402) | `POST /v1/purchases/:id/fund` (+ `PAYMENT-SIGNATURE`) | `buy` (via payer client) | `purchases:fund` |
| Status + receipt | `GET /v1/purchases/:id` | `get_purchase` | `purchases:read` |
| Event history | `GET /v1/purchases/:id/events` | — | `purchases:read` |
| Existing purchase for quote | `GET /v1/quotes/:id/purchase` (purchase + submitted approval, or both null) | internal to `buy` | `purchases:read` |
| Customer/judge proof | `GET /v1/evidence/purchases/:id/proof` | — | `evidence:read` |
| Capabilities/readiness | `GET /v1/capabilities` (no auth, no secrets) | — | — |

Errors always: `{ "error": { "code", "message", "requestId", "details?" } }` with codes from `ErrorCode`.

## Current human orchestration decision

This decision extends the pinned planning snapshot without rewriting it. Conversation and working
drafts belong to the host agent; strict canonical commerce validation, exact terms, money, recovery,
journal and evidence remain gateway responsibilities. No conversational drafts are persisted.

`PurchaseIntentDraft` and `FulfillmentDraft` require a known category and accept absent known fields,
including nested fields. Supplied values retain canonical types/formats; unknown fields are rejected.
`assessPurchaseIntent` / `assessFulfillment` return a validated canonical object when ready, or:

```json
{
  "status": "needs_input",
  "phase": "search",
  "fields": [
    {"path":"to","humanLabel":"Destination airport","expectedType":"string","reason":"Required to search inventory","issue":"missing"},
    {"path":"departDate","humanLabel":"Departure date","expectedType":"date","format":"YYYY-MM-DD","reason":"Required to search inventory","issue":"missing"}
  ]
}
```

Fulfillment example: `{status:"needs_input", phase:"fulfillment", fields:[{path:"contact.mobile",
humanLabel:"Contact · mobile", expectedType:"string", reason:"Required to fulfill this purchase",
issue:"missing"}]}`. Phases are `search`, `fulfillment`, `provider`, `approval`, `funding_selection`.
Descriptions and paths come from controlled schemas and never echo supplied values or provider prose.
Missing input is HTTP **422**, error code `needs_input`, with this object in `error.details`. Invalid
supplied formats/types, unknown fields and incompatible canonical combinations remain 400
`invalid_request`. Business failures retain their existing codes. MCP returns `structuredContent`
directly as `needs_input`, without `isError`, and tells the agent to ask, merge and retry. It must not
fabricate customer information. Synthetic demo fixtures are for explicitly run demo scripts only.

Provider `inputRequirements` is a typed read-only discovery seam. It requests reviewed canonical leaf
paths only; array indices respect canonical bounds. `collectionPhase` identifies which canonical input
to amend. Search cannot request fulfillment fields; a quote that needs revised search data directs a
new search. Unmodelled or out-of-phase requirements fail safely with `provider_error` for operator
attention. **Stable provider requirements are promoted into canonical schemas deliberately.** There is
no provider extras bag or automatic schema bypass.

Each new quote option is `{fundingOptionId, rail, amount:{network,assetId,decimals,amountBaseUnits,symbol?},
payTo, settlement}`. Its opaque ID is quote-scoped and included in the quote digest. No selection is
made by listing options. The purchase request contains only `quoteId` and `approval` with
`quoteDigest`, `maxTotal`, **required** `selectedFundingOptionId`. Core resolves the stored option,
freezes it into `fundingRequirement`, derives the rail and persists approval plus `approval.recorded`.
Execution rechecks that new approval binds the frozen option. The event proves channel-submitted
authorization of stored terms; it does not attest which physical human approved.

Funding readiness: `CONFIGURED_UNVERIFIED` / `EXTERNAL_CHECK_PASSED` are selectable; `LOCAL_TESTS_ONLY`
is selectable only with `APP_ENV=test`. `MISSING_CONFIG` / `ACCESS_BLOCKED` are never selectable.
Quote creation permits zero options and says no payment source is available; purchase creation then
refuses. Readiness is rechecked before a new purchase. Old records retain stored amounts and recovery;
legacy quotes without option IDs must be requoted to create new purchases. No default rail remains.

The payer's authenticated loopback `GET /status` returns only `{ok:true, source}` or `source:null`.
Source fields: stable public `sourceId`, `rail`, `network`, `publicAddress`, masked `displayAddress`,
`assetId`, `readiness`. Derivation is offline in the independent signer process; it never signs or
queries a provider. Strict response allowlisting rejects secret/config fields. MCP holds no signing
material. `configured` means identity/configuration available, not verified balance or spend capacity.
MCP quotes show a matching connected source or external-action requirement; automatic buy requires a
current matching rail/network/asset before creation. Source identity is informational; approval binds
the quote option, not a cryptographic human or wallet-session attestation.

MCP derives `mcp:<sha256(quoteId + ':' + selectedFundingOptionId)>` unless an explicit key is supplied.
It loads the owner-scoped existing purchase and approval before creating: matching repeated approval
follows the same purchase; changed amount/digest/choice requires a fresh authorization flow. Races
use backend idempotency/quote uniqueness. Only a newly created, `not_received` purchase can request
automatic funding, at most once per local tool instance. Repetition never restarts funding after
refusal, submission, uncertainty or confirmation. Existing payer ledger protection persists across
processes/restarts; operator recovery uses the same purchase. `confirmation_pending` calls for no
new payment. The customer never manages idempotency or duplicate prevention.

`projectProgress` presents awaiting/confirming payment, purchase queued, purchasing, verifying result,
complete, or needs attention. It includes payment confirmation, merchant action, finality and next
action. Internal dimensions remain in structured output; raw recovery reasons are not primary copy.
Unresolved results say no further action is needed. Completion requires a receipt, completed commerce
and paid merchant status, with sandbox/fixture limitations retained.

Proof response: `{proof:{purchaseId,quoteId,summary,commercialAmount,progress,timeline,funding,merchant,
receipt,technicalEvidencePath}}`. Timeline: Requested → Quote confirmed → Approved → Funded → Merchant
execution → Result verified. Each step has status, timestamp, human text and optional evidence reference.
Only durable events/evidence advance steps. Funding distinguishes frozen commercial terms and testnet
amounts, applied confirmation, masked recorded payer and actual references/provenance. Merchant data
is normalized, with environment/reference if recorded. Receipt is concise and omits treasury effects;
fulfillment, raw provider data, checkpoints and bank/operator data are absent. Ownership and
`evidence:read` apply; foreign purchases return the same 404 as nonexistent ones.

`/proof` is a light neutral same-origin shell: token in memory only, explicit session clearing,
timeline/payment/merchant/receipt first, detailed existing evidence on expansion. Pending/unknown
results retain pending steps and no final receipt. `/inspect` and all detailed audit evidence remain.
The proof request shares the existing short core transaction lock for a consistent projection; it
does no external work and adds no tables or alternate truth store.

## Purchase lifecycle a channel can observe

`awaiting_funding → funded_queued → executing → succeeded | failed | unresolved | requires_reauthorization`, or
`awaiting_funding → expired`. Separate fields: `paymentState` (funding), `commerceStatus` (provider: `held`,
`order_created_unpaid`, `paid`, `confirmed`, `ticketing`, `ticketed`, …) and `merchantPaymentStatus`. A `held` or
`order_created_unpaid` commerce status is never a completed purchase. `unresolved` means the provider outcome is not
yet known; the core reconciles by readback and never re-executes.

## Funding (direct Cardano, x402 v2)

`POST …/fund` without a payment header ⇒ `402` with `PAYMENT-REQUIRED` (base64 JSON) and the same JSON body:
`{x402Version:2, resource, accepts:[{scheme:"exact", network:"cardano:preprod", amount, asset:"<policyId>.<assetNameHex>", payTo, maxTimeoutSeconds, extra}]}`.
A bounded payer client signs and retries with `PAYMENT-SIGNATURE`. The gateway verifies and settles through the
facilitator **before** recording funding; the purchase executes later in the worker, only from persisted confirmed
evidence. Success ⇒ `202` + `PAYMENT-RESPONSE`. Replay ⇒ `409 payment_replayed`. Already funded ⇒ `409 conflict`
(no settlement attempted).

## Masumi/Sokosumi seam

- Map `externalTaskId → purchaseId` in the Masumi lane's own storage; call core with idempotency key `sokosumi:<id>`.
- Masumi funding evidence, if proven, becomes a **separate funding adapter** (`rail: "masumi"`), not a channel shortcut.
  Until the lane proves dynamic principal + pre-execution escrow semantics, use the direct funding gate and present the
  required funding honestly.
- Keep service-fee earnings, purchase principal and escrow receivables distinct. Evidence `purpose` is one of
  `purchase_principal | service_fee | principal_and_fee`. **Fee-only evidence (`service_fee`) is rejected as purchase
  funding** — see `tests/contracts/channel-equivalence.test.ts`.
- Do not complete paid purchasing tasks with fixture results. On-chain result hashes contain no buyer data.

## Contract fixtures

`tests/support/fixtures.ts` (test-only) provides deterministic executors and a fixture funding rail; payment header
format `fixture:<txref>:<baseUnits>[:<state>][:<asset>][:<payee>][:<purpose>]`. These are never wired into the runnable
gateway (`src/wiring.ts`).

## Durable funding and evidence implementation notes

The production Cardano adapter implements `prepare` before any settlement and `recover` for read-only recovery. Core atomically persists a prepared canonical transfer reference and immutable funding requirement before facilitator verify/settle. A proven pre-settlement rejection (`settlementAttempted:false`) permits a new attempt; omission/ambiguity preserves recovery and blocks a second transfer. Confirmed transfers arriving after closure are recorded as refundable unapplied obligations. Funding/confirmation jobs continue read-only after retry thresholds and are repaired on startup.

Compatible Cardano payers include signed metadata label 2049 with the application commitment documented in `docs/evidence/cardano-protocol.md`. Transaction validity must end by quote expiry. The exact x402 resource URL is frozen for new purchases so changing deployment origins cannot change recovery commitments. Earlier local records require their original public base URL.

Default MCP clients lack `purchases:fund`; provision a separate read/fund payer client for the SAME customer. Gateway destinations require HTTPS except exact loopback HTTP; the bridge is loopback-only. The gateway never imports signer/client key material.

Evidence routes require owner-scoped `evidence:read`, or `operator:read` for treasury/bank/refresh. `/inspect` is a public static shell. `/v1/webhooks/shopify` verifies raw-byte HMAC before JSON parsing and only schedules independent readback; payload financial claims cannot complete a purchase. Receipt/result provenance overrides environment inference, and `executionEvidenceStatus` distinguishes source-only/pending execution evidence from receipt issuance.

## Explicit notional settlement contract

New funding options include settlement.policy {mode:scaled_testnet,numerator:1,denominator:1000},
commercialPrincipal, commercialServiceFee, commercialTotal and principalBaseUnits/feeBaseUnits/
totalBaseUnits. amount still supplies network, exact assetId, decimals and total amountBaseUnits;
rail and payTo remain explicit. Purchase/receipt/evidence responses retain fundingRequirement after
payment. USD 183.40 becomes exactly 183400 six-decimal base units (0.183400 tUSDM), not an FX exchange.
Quote digest and Cardano metadata bind policy/breakdown; current demo edits never recalculate old
obligations. The historical payablePrincipal field is commercial total including fee. See the
[current decision](../decisions/scaled-testnet-settlement.md) for disclosure and legacy compatibility.
