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
| Create purchase (no spend) | `POST /v1/purchases` `{quoteId, approval:{maxTotal, quoteDigest}, fundingRail}` + `Idempotency-Key` | `buy` | `purchases:write` |
| Fund (x402) | `POST /v1/purchases/:id/fund` (+ `PAYMENT-SIGNATURE`) | `buy` (via payer client) | `purchases:fund` |
| Status + receipt | `GET /v1/purchases/:id` | `get_purchase` | `purchases:read` |
| Event history | `GET /v1/purchases/:id/events` | — | `purchases:read` |
| Capabilities/readiness | `GET /v1/capabilities` (no auth, no secrets) | — | — |

Errors always: `{ "error": { "code", "message", "requestId", "details?" } }` with codes from `ErrorCode`.

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
