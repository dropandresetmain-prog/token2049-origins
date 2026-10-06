# Atlas flight executor (sandbox)

Code: `src/execution/atlas/` (factory `createAtlasExecutor`). Tests: `tests/unit/atlas-executor.test.ts` (offline, scripted fake fetch, synthetic data). Read-only check: `scripts/atlas-check.ts`.

Route `atlas`, category `flight`, environment `sandbox`. One-way, adult-only (the core's `FlightIntent` pins children/infants to 0).

## Payment constraint (decision needed)

Supplier credit or prefunding is not an approved architecture. The only payment mechanism this lane could confirm for Atlas is `pay.do` with `paymentMethod: 1`, which debits the sandbox account balance/deposit (test balance). It is not card spend and must not be relabelled as such.

Implemented handling:

- `/pay.do` is called only when `ATLAS_ALLOW_TEST_BALANCE_PAYMENT === 'true'` (exact string; `TRUE`, `1`, unset all keep it closed). Default is closed.
- Gate closed: the hold is created (`order.do`), then `execute` returns `failed_definite` with reason `atlas_payment_mechanism_not_approved` and `providerReference = orderNo`. Nothing is charged; the hold lapses at `tktLimitTime`. It is never reported as a purchase.
- Gate open: the result is labelled `merchantPaymentStatus: 'test_balance_paid'`. Receipts therefore say test balance, never card.
- `readiness().detail` always states whether the gate is enabled.

**Founder decision needed, one of:**

1. Approve a bounded, sandbox-only exception: enable `ATLAS_ALLOW_TEST_BALANCE_PAYMENT=true` for the sandbox host only, for demo purposes, with the receipt label `test_balance_paid` and no claim of card spend; or
2. Name another permitted payment mechanism. The candidate is a card-style pass-through (see findings below); it needs Atlas's official `pay.do` contract for that mode and a live sandbox probe before any code is written.

Until one of these is decided, Atlas can quote and create holds but cannot complete a paid purchase.

### Payment methods found in `atlas-hackathon-lab` (HEAD `9b802e2b13aebb02bc0fb4074ac1875f329a2018`)

- `docs/SKILL_VS_API.md:25`: direct API payment is `pay.do`; "deposit, VCC pass-through, BYOA, and merchant-of-record modes are documented" (by Atlas; the lab did not test them). The Skill supports "single-use Atlas-balance confirmation" only.
- `docs/ATLAS_CAPABILITY_MATRIX.md:35`: "Balance; API also documents VCC/BYOA/MoR modes"; marked "Accessible but not tested; intentionally excluded" (state-changing/financial).
- `docs/SKILL_VS_API.md:31-32` and `docs/ATLAS_FINAL_CAPABILITY_REPORT.md:69`: the official Skill explicitly excludes credit-card payment.
- `docs/SKILL_VS_API.md:43`: Skill fulfilment is "order create, one-time balance payment".
- `docs/DATA_DICTIONARY.md:26`, `:30`: search routings carry `supportPaymentMethods`, `supportCreditTransPayment` and `cardChargeList` (always null in the sample).
- Observed values (raw captures under the ignored `outputs/` directory, not tracked): most carriers return `supportPaymentMethods: [1]` with `supportCreditTransPayment: "0"`. Y4 (Volaris), F9 (Frontier), 7C and LJ (Jeju Air sandbox routes) and W6 (Wizz) return `[1, 3]` with `supportCreditTransPayment: "1"`. The Cebu Pacific route used for readiness (Z2, MNL-CEB) returns `[1]` only.
- Not found anywhere in the lab: what code `3` means, the `pay.do` fields for a card/VCC mode, or any enabling step. The official docs are linked at `docs/SKILL_VS_API.md:99-104` (resources.atriptech.com); this lane did not fetch them. Interpretation that code `3` is a credit-card transaction mode is an inference from the paired `supportCreditTransPayment` flag, not a confirmed fact.

## Wire semantics

All calls are POST JSON to `ATLAS_BASE_URL` (HTTPS, host must be exactly `sandbox.atriptech.com`, redirects rejected, 30 s timeout), headers `x-atlas-client-id` / `x-atlas-client-secret`; search body also carries `cid`. Success is body `status === 0`. Provider `msg` text is never read into results, errors or evidence.

| Step | Endpoint | Notes |
|---|---|---|
| search | `/search.do` | one offer per one-way routing, cheapest first, cap 10. Indicative = `(adultPrice + adultTax) * adults`, exact via `parseDecimalToMinor` in the response currency (ISO-4217 exponent table; inexact amounts skip the routing). `expiresAt` = `expireTime` if parseable and still in the future, else now + 20 min |
| quote | `/verify.do` | `{routingIdentifier, maxResponseTime: 15000}`. Price: `priceChange.new*` when `isPriceChange`, else the re-verified routing. Total adds a transaction fee known before the order. `expiresAt` = now + 10 min (verify-session TTL undocumented; conservative) |
| create | `/order.do` | not idempotent; sent at most once per attempt |
| pay | `/pay.do` | gated, see above; at most once |
| readback | `/queryOrderDetails.do` | `orderStatus` `0` held, `1` paid/ticketing, `2` ticketed, `-3` cancelled |
| reconcile | `/orderList.do` | read-only, only after a create of unknown outcome |

Traveller data: `quote` rejects with `ProviderError('rejected', 'atlas_traveller_data_required', ...)` listing field **names only** (for example `passenger.cardNum`) when the verified `bookingRequirement` marks a field required that the fulfillment cannot supply. Document fields (`cardNum`, `cardType`, `cardExpired`, `cardIssuePlace`) count as supplied only if every passenger has a document. Names containing characters other than Latin letters and spaces are rejected early (`atlas_traveller_data_invalid`), as are names over the verified `maxLength` (`32/32`) and a traveller count different from the search.

### Execute

1. Parse `QuoteRef`; validate fulfillment. Config problems return `failed_definite` before anything is sent.
2. `checkpoint('create_attempt', {at})` then `order.do`.
   - timeout, network failure, 5xx, unparseable body, redirect: `unknown`, no reference, no pay.
   - 4xx: `failed_definite`. Non-success `status`: `failed_definite` (318 duplicate is never adopted), unless the body also names an order, which stays `unknown` with the reference.
3. `checkpoint('order', {providerReference, orderNoB64, pnrCode, tktLimitTime})`, then the total check. `order.do` total must equal the quoted total (`totalPrice`, or `totalPrice + totalTransactionFee`; whether the fee is inside `totalPrice` is unverified, sandbox fee is 0) in the quoted currency, else `terms_changed`, not paid.
4. Gate closed: `failed_definite`, see above.
5. Gate open: `queryOrderDetails` pre-check (must be `0`, quoted currency and total), `checkpoint('pay_attempt')`, `pay.do`, then readback. Status `404`/`402`/`406` from `pay.do` are settled by readback, never re-paid. An explicit rejection (other status, or HTTP 4xx) with the order still held is `failed_definite`. A timeout or any ambiguity is settled by readback only.

A resumed `execute` that finds `create_attempt` without an order, or any `pay_attempt`, only reads back.

### Retrieve (state mapping)

| Observation | Result |
|---|---|
| no `create_attempt` checkpoint | `failed_definite` `atlas_create_not_attempted` (the checkpoint is durable before `order.do` is sent, so absence proves no create) |
| `create_attempt`, no order | `orderList` reconciliation: a unique match on contact e-mail, traveller names, route, departure date and creation time inside the attempt window is checkpointed as `adopted` and read back; anything else `unknown` |
| `0`, pay attempted | `unknown` (payment pending or not accepted) |
| `0`, no pay attempted | `unknown` `atlas_order_held_unpaid`; `failed_definite` `atlas_hold_lapsed_unpaid` once `tktLimitTime` + 60 s has passed |
| `1` and we paid | `succeeded`, `ticketing`, `test_balance_paid`, `chargedAmount` = observed total (quote if absent) |
| `2` with `ticketStatus` `1` and we paid | `succeeded`, `ticketed` |
| `1`/`2` without a pay attempt, or on an adopted order | `unknown` (we did not pay it; never claimed) |
| `-3` | `failed_definite`; `unknown` if a pay was attempted and a `payTime` is recorded (refund state unverifiable) |
| anything else, read failure | `unknown` |

Ticket numbers persist on cancelled orders and are never used to infer ticketing; only a count is recorded in evidence. Retrieve never calls `pay.do`.

## Money notes

Quoted `merchantTotal` is exact: taxes included, plus the transaction fee derivable from `verify.do` (PER_PAX mode: `transactionFeePerPax * adults`, falling back to `transactionFee * adults`; other modes: `transactionFee` once). That fee rule is UNVERIFIED beyond the observed `0.0` / `PER_PAX`; if it is wrong the order-total check stops the purchase before payment.

## Provenance

- Atlas lab (read-only): `C:/Dev/atlas-hackathon-lab` at `9b802e2b13aebb02bc0fb4074ac1875f329a2018`. Files: `docs/SKILL_VS_API.md`, `docs/ATLAS_CAPABILITY_MATRIX.md`, `docs/DATA_DICTIONARY.md`, `docs/ATLAS_FINAL_CAPABILITY_REPORT.md`, `docs/SANDBOX_COVERAGE_MATRIX.md`; raw verify/search captures `outputs/atlas_api_verify_mnl_ceb_return_mixed.json`, `outputs/atlas_api_mnl_ceb_2026-08-20.json` (shapes only).
- Prior integration (read-only, not copied), repo `C:/Dev/qoder-atlas` at `e79c387ebacc5a9e4a9350666e0dd8a501921d01`: `src/providers/atlas/client.ts` (transport and failure classes), `types.ts` (nullable wire shapes), `transactionAdapter.ts` (pay status 404/402/406, `orderStatus` mapping, SGT deadline, pre-pay check), `docs/work/r4-evidence/atlas-create-idempotency-decision.md` (create not idempotent, `orderList.do` fields), `docs/work/r4-evidence/atlas-duplicate-order-validation.md` (318 is a pointer, not proof).
- This code was written fresh from those semantics.

## Open questions only the live sandbox can answer

1. Does `pay.do` accept any mode other than `paymentMethod: 1` on this account (code `3`, VCC pass-through)? Required fields? (Payment decision above.)
2. `orderList.do`: name of the array in the response and the format of `orderCreateTimestamp`, `depDate` and `paxNames` (the parser accepts several shapes; no match simply stays `unknown`).
3. Does `order.do` `totalPrice` include `totalTransactionFee`, and does `pay.do` debit total or total + fee? Which transaction-fee modes besides `PER_PAX` exist?
4. Lifetime of a verify `sessionId` (quote TTL is a guess of 10 minutes) and of an unpaid hold (observed about 30 minutes by the prior integration).
5. Is `cardType: 'PP'` the right passport code, and are hyphens/apostrophes accepted in names (currently rejected at quote time)?
6. Is `search.do` `expireTime` a cache lifetime only? Sandbox values can already be in the past (fallback applies).
7. Does an unpaid hold at `tktLimitTime` become `-3` promptly, and what does a cancelled-after-payment order look like (`payTime` present?).
8. Provider status numbers other than the ones used here are not mapped; any unexpected value yields `unknown` or `failed_definite` only where listed above.

## Fresh run

```
npm ci
npx tsc -p tsconfig.json --noEmit
npx vitest run tests/unit/atlas-executor.test.ts
# live, read-only (readiness + search + nothing else); needs sandbox credentials in the environment:
ATLAS_BASE_URL=https://sandbox.atriptech.com ATLAS_CLIENT_ID=... ATLAS_CLIENT_SECRET=... \
  npx tsx scripts/atlas-check.ts MNL CEB 2026-11-20
```

The check script never creates an order and never pays. No live calls have been made by this lane (credentials not provisioned).

## Environment

`ATLAS_BASE_URL`, `ATLAS_CLIENT_ID`, `ATLAS_CLIENT_SECRET` (all required; missing names are reported by readiness), `ATLAS_ALLOW_TEST_BALANCE_PAYMENT` (optional, default closed).
