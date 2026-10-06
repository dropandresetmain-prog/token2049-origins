# Nuitee (liteAPI) hotel executor

Route `nuitee`, category `hotel`, provider environment `sandbox`. Code: `src/execution/nuitee/`. Factory: `createNuiteeExecutor(env, { fetchImpl?, clock?, timeoutMs? }) -> CommerceExecutor`.
Status: implemented and tested offline against synthetic fixtures. **No live call has been made** (credentials not provisioned); see "Unverified".

## Configuration

| Env | Required | Default / rule |
|---|---|---|
| `NUITEE_API_KEY` | yes | sent as `X-API-Key`; never logged or placed in results |
| `NUITEE_SEARCH_BASE_URL` | no | `https://api.liteapi.travel/v3.0` |
| `NUITEE_BOOKING_BASE_URL` | no | `https://book.liteapi.travel/v3.0` |

Both URLs must be `https` on `liteapi.travel` or a subdomain, without credentials or query; otherwise readiness is `ACCESS_BLOCKED` and operations are not sent (the key is a header on every request, so a mis-set host must not receive it). All requests: 15s timeout, `redirect: 'error'`.
Keys with a `prod`/`live` prefix (prefix convention is observed, not documented) make `readiness` return `ACCESS_BLOCKED` and `execute` refuse with `failed_definite` before any network call, because `ACC_CREDIT_CARD` on a production account might place a real booking.

## Semantics

- **search** (`POST {search}/hotels/rates`): currency = `intent.spendCeiling.currency`. At most 10 offers, cheapest rate per hotel, cheapest hotels first. Price is exact: offer total = `offerRetailRate`, or the BigInt sum of per-room `retailRate.total`; if the two disagree the higher is used and a terms line says so. Offers that cannot be priced exactly in the requested currency are omitted. `2001` = no availability = `[]`. `executionRef = {offerId, hotelId, currency, scale, searchTotalMinor, title}`. `expiresAt` = now + 20 min (gateway-side cap; liteAPI documents no offer TTL).
- **quote** (`POST {booking}/rates/prebook`, `usePaymentSdk:false`): the prebook price IS the quote (`price`, `sellingPriceToUser`, or sum of rate totals; highest if they disagree). `priceDifferencePercent`, `cancellationChanged`, `boardChanged` and drift versus the search estimate are surfaced as terms, never fatal. Currency or hotel mismatch is a rejection. Fees with `included:false` become `fee_payable_at_property` breakdown lines (own currency), are excluded from `merchantTotal`, and a terms line says they are payable at the property; included taxes become `tax`/`fee_included` lines so that non-payable lines sum to `merchantTotal`. Traveller coverage (every requested room has a guest, no phantom room) is validated here. `executionRef = {prebookId, hotelId, expectedTotalMinor, currency, scale}`; `expiresAt` = now + 10 min (prebook TTL undocumented).
- **execute** (`POST {booking}/rates/book`, `payment.method = ACC_CREDIT_CARD`):
  1. `clientReference` = `T2O-<sanitised key>-<16 hex of sha256(key)>` (charset `^[A-Z0-9_-]+$`, <=255, deterministic; the hash prevents two keys sanitising to one reference).
  2. `checkpoint('book_attempt', {clientReference})` is durable **before** the request. If it cannot be persisted nothing is sent (`failed_definite`).
  3. Outcomes: transport timeout/network, HTTP 5xx/408, `5000`, `4016`, `2013`, `2014`, unparseable body, or an unrecognised provider code -> `unknown` (exposure retained). `4012`, `2001`, `4040`, `4000`, `4002`, `4003`, `4010`, and bare 400/401/403/404/410/422/429 -> `failed_definite` (nothing booked). `4005` -> lookup by `clientReference`. A 2xx without a booking id also triggers the lookup.
  4. On a booking id: `checkpoint('booking', {providerReference: bookingId, clientReference})`, then an independent `GET /bookings/{id}`.
  5. `succeeded` requires readback `status` CONFIRMED (or COMPLETED), `paymentStatus` `succeeded`, matching booking id / clientReference / hotelId when present, a parseable price, **and** a provider sandbox flag of true. Result: `commerceStatus 'confirmed'`, `merchantPaymentStatus 'simulated_paid'`, `chargedAmount` = provider price (higher of book response and readback if they disagree). If it differs from the quote it is still `succeeded` with the actual amount (`priceDiffersFromQuote` in evidence) and the core flags the over-charge. Any other combination -> `unknown` carrying the booking reference.
  6. Resume: if `booking` checkpoint exists only readback runs; if only `book_attempt` exists only the lookup runs. `book` is never sent twice for one attempt.
- **retrieve**: bookingId from the `booking` checkpoint, else lookup by `clientReference` from the `book_attempt` checkpoint (or re-derived from the idempotency key). Not found / ambiguous / transport failure -> `unknown` (never a definite failure: the lookup filter is undocumented, so absence proves nothing). Status map: CONFIRMED/COMPLETED + payment succeeded + sandbox -> `succeeded`; `CANCELLED`/`CANCELED` -> `failed_definite` **only** when the sandbox flag is true (simulated payment, nothing charged; with real money a cancellation could carry charges); `CANCELLED_WITH_CHARGES`, PENDING, anything else -> `unknown`.
- **readiness**: `MISSING_CONFIG` (names only); otherwise `GET {search}/data/currencies` (cheap authenticated reference-data read), cached 5 min: 2xx -> `EXTERNAL_CHECK_PASSED`, 401/403 -> `ACCESS_BLOCKED`, anything else -> `CONFIGURED_UNVERIFIED`. This proves the key is accepted, not that search/prebook/book entitlements work. Never throws.

## Sandbox payment meaning

`ACC_CREDIT_CARD` is documented as "simulates bookings in sandbox without charging". The gateway therefore reports `simulated_paid`, not `paid`; no card, bank or wallet moves. The adapter refuses to apply that label unless the provider response carries a sandbox flag (root `sandbox:true` or `data.sandbox:1`; a `false` in either wins). Every offer/quote carries a terms line saying the booking is simulated.

## Privacy

Holder/guest data exists only in the request body to liteAPI. It is not logged (the module has no logging), not in checkpoints (`clientReference`, `providerReference` only), not in evidence details, errors or result reasons. Provider error `message` text is dropped (it can echo input); only HTTP status and numeric code are kept. `fulfillmentSummary` contains counts and dates only. Tests assert this over results, checkpoints, evidence and console output.

## Provenance

Written fresh for this repo. Reference reading only (no code copied): the earlier prototype adapter `qoder-atlas@e79c387` `src/providers/hotel/nuiteeAdapter.ts` (endpoint surface, hosts, retailRate array/object duality, status vocabulary) and the *shapes* of its sanitized recordings under `fixtures/recordings/nuitee/` (search `data[].roomTypes[].offerId`, `offerRetailRate`, `retailRate.total[]`, `taxesAndFees[]`, `cancellationPolicies`; prebook `data.prebookId/price/priceDifferencePercent`; book/retrieve `data.status/paymentStatus/price/currency/sandbox`, `bookedRooms[].rate.retailRate.total{}`; cancel statuses CANCELLED and CANCELLED_WITH_CHARGES). Public docs read 2026-10-06: docs.liteapi.travel (`/rates/book`, `/rates/prebook`, `/hotels/rates`, `GET /bookings`, `/data/currencies`). Tests use synthetic data, no recorded identifiers or PII.

## Open questions / unverified

1. **GET /bookings?clientReference= is not documented** (listed filters: dates, status, paymentStatus, sandbox, customTags). The code matches the reference client-side and never trusts the filter, but if the server ignores it and paginates, our booking may not appear in the first page. Mitigation if this matters: set `customTags` on book (undocumented here) or verify pagination live. Reconciliation currently ends in `unknown` -> manual review in that case.
2. `4005` semantics (duplicate across all history vs a window) and whether the duplicate response includes the existing bookingId.
3. `prebookId` is documented as reusable across several bookings, so duplicate protection rests entirely on `clientReference`.
4. prebook TTL and offer TTL (we use 10 and 20 min), and whether a stale prebook at book time returns `4012`/`4040`/`2001` as assumed.
5. Whether book response `price` can exclude/include add-ons or processing fees differently from the prebook `price` (retrieve fixtures show a separate `processingFee`; we ignore it).
6. Sandbox flag presence on every book/retrieve response (we require it; a response without it yields `unknown`).
7. Retail-rate `total` array with more than one entry (we treat as unpriceable) and `included` semantics for fees with the flag missing (treated as included, i.e. already in the total).
8. Key prefix convention (`sand_`/`prod_`) is inferred, not documented.
9. 2013/2014 mapped to `unknown`; real responses unseen.
10. Timezone-less cancel deadlines are rendered as provider text, not converted.
11. No cancel/modify operation (outside the executor port).

## Recommendations for the core

- Treat `unknown` from this route as exposure-retaining; `retrieve` can upgrade it, and the checkpointed `clientReference` is the only join key if the booking id was never received.
- The executor already returns actual `chargedAmount`; keep the core's over-charge flag.
- A cancelled booking maps to `failed_definite` only in sandbox; revisit before any production route.

## Fresh run

```
set NUITEE_API_KEY=<sandbox key>          (PowerShell: $env:NUITEE_API_KEY = '<sandbox key>')
npx tsx scripts/nuitee-check.ts           # readiness + search (read-only)
npx tsx scripts/nuitee-check.ts --quote   # + prebook, no booking
npx tsx scripts/nuitee-check.ts --book    # + simulated booking and readback (sandbox, uses a synthetic traveller)
npx vitest run tests/unit/nuitee.test.ts  # offline tests
```
