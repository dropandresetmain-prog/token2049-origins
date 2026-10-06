# Console contract v1: what the Capsule console reads, and what it still needs

The Capsule console (`web/`) is a read-only web app where a customer follows the purchases their AI assistants make
through Capsule. It implements the approved V3 design (`DESIGN.md`). This document is the agreement between the console
and the gateway. Canonical schemas are executable: `web/src/contracts/` (console side) and `src/contracts/` (gateway side).
On conflict, the code wins.

The console lane does not change gateway contracts. Gateway changes the console needs are listed as proposals under
[Gaps](#gaps) for the core lead to accept, adjust or reject (per `CHANNEL_CONTRACT.md`).

## Rules

1. **Read-only.** The console never creates, approves, funds or changes a purchase. Approvals and payments happen through
   the customer's assistant (agent channels). The only "actions" are copying text and downloading the customer's own
   records. The operator screens ([below](#operator-screens)) are also read-only: they never ask a bank or provider
   anything and never call `POST /v1/evidence/bank/refresh`.
2. **One data boundary.** Screens never call `fetch`. They read a `ConsoleSource` (`web/src/contracts/source.ts`).
   There are two sources: the **sample source** (local sample purchases) and the **gateway source** (authenticated HTTP).
   Both return the gateway's own contract shapes, validated with the gateway's schemas. Going live means switching the
   source (`VITE_CONSOLE_SOURCE=gateway`), not rewriting screens.
3. **No second source of truth.** Purchase status comes from the gateway's `projectProgress`
   (`src/contracts/presentation.ts`). Payment, merchant result and receipt stay separate: a confirmed payment never makes
   a purchase look complete, and no receipt is shown before the merchant confirms.
4. **The access key stays in memory.** The gateway source holds the bearer token in a closure for the life of the tab.
   Nothing is written to storage, URLs or logs.
5. **User-facing language only.** Every string on screen comes from `web/src/copy/en.ts` and follows
   `docs/design/VOCABULARY.md`. Gateway enums and event types are mapped there; raw values never reach the screen except
   inside the "Technical details for support" disclosure.

## Access

The console asks for a gateway API client token ("access key" on screen). It needs these scopes:

| Scope | Why |
|---|---|
| `purchases:read` | Purchase status, payment and receipt |
| `evidence:read` | Purchase list, proof and activity |
| `quotes:write` | Price details and title on the purchase page (today only; see G5) |

Missing optional scopes degrade gracefully: proof, activity and price details become unavailable with a plain message;
the purchase itself still loads.

The operator screens need `operator:read` as well (the `operator` role of `npm run client:create` has `purchases:read`,
`evidence:read` and `operator:read`). A customer key never has it. See [Operator screens](#operator-screens).

## Reads

| Screen element | Endpoint | Schema (console side) |
|---|---|---|
| Test-mode strip | `GET /v1/capabilities` (no auth) → `appEnv` | `CapabilitiesResponse` |
| Purchases list, counts, "Needs attention" | `GET /v1/evidence/purchases` (50 newest) | `EvidenceListResponse` (mirrors `read-model.listPurchases`) |
| Purchase status, total, payment, receipt | `GET /v1/purchases/:id` | `PurchaseResponse` / `PurchaseView` |
| Progress steps, payment and merchant proof | `GET /v1/evidence/purchases/:id/proof` | `PurchaseProofResponse` (mirrors `src/evidence/proof.ts`) |
| Activity log, spending allowance, technical details | `GET /v1/evidence/purchases/:id` | `EvidenceDetail` (subset of `read-model.purchaseDetail`) |
| Title, price details, merchant terms | `GET /v1/quotes/:quoteId` | `QuoteView` |

While a gateway purchase can still change (`HumanProgress.outcomeFinal === false`), the purchase page re-reads
1.5 seconds after the previous read finishes. `LIVE_REFRESH_MS` in `web/src/ui/detailRefresh.ts` supplies the default;
`useDetail` accepts an interval override for testing/configuration. Manual reload and timer refresh share one request
guard. Final purchases and sample data do not poll, and navigation invalidates late responses.

Verified success has a separate completion panel with Order confirmed, Booking confirmed, or Ticket issued,
derived from category and durable commerce status. A flight must be `ticketed` to say Ticket issued. The panel
shows the stored provider reference (or receipt reference/number) with receipt and proof actions. An opaque flight
reference is never relabeled as a PNR. The success gate still requires completed commerce, merchant payment and a receipt.

**Drift protection.** `PurchaseProof` cannot be imported into the browser bundle (its module imports the database
layer), so the console mirrors it. `tests/contracts/console-contract.test.ts` fails if the mirror and the gateway schema
differ, and type-checks the read-model return types against the console's list and detail schemas.

## Operator screens

Two secondary screens, **Treasury** (`#/treasury`) and **Connections** (`#/connections`), expose operator evidence the
gateway already stores. They are demo and operator surfaces, not part of the customer purchase flow, and they change
nothing about the purchase screens.

| Screen element | Endpoint | Scope | Schema (console side) |
|---|---|---|---|
| Treasury: simulated capacity, observed funds, obligations, purchases by state, ledger health | `GET /v1/evidence/treasury` | `operator:read` | `TreasuryResponse` (`web/src/contracts/operator.ts`, mirrors `read-model.treasuryView`) |
| Connections: stored OCBC observations and adapter readiness | `GET /v1/evidence/bank` | `operator:read` | `BankResponse` (mirrors the route in `src/evidence/router.ts`) |
| Connections: Cardano, Solana, Masumi, Shopify, Nuitée, Atlas readiness | `GET /v1/capabilities` (no auth) | none | `CapabilitiesResponse` |

**Permissions.** The links to both screens appear only after a read of `/v1/evidence/treasury` succeeds for the entered
key. A key without `operator:read` sees no operator links, and a typed `#/treasury` or `#/connections` address shows
"Operator access required" with no operator data; the gateway answers 403 and the console shows nothing from it.
Hiding the links is a convenience. The gateway's scope check is the control.

**What the screens must keep true** (pinned by `web/src/model/operator.test.ts` and
`tests/integration/operator-console.test.ts`):

- Observed money (test crypto the gateway verified, and what it owes customers) and simulated money (the synthetic
  purchasing allowance) sit in separate sections and are never added, netted or listed together. Test crypto is not
  bank cash and the allowance is not a bank or card balance.
- OCBC observations are labelled read-only observations with their source and provenance. They are not purchase
  settlement and not treasury truth, and nothing on screen says a purchase reached a bank or card account. References
  show at most the last four characters (masked again in the console), and a bank `description` can never reach a
  screen: the console schema drops fields it does not list.
- Amounts are formatted exactly from integer strings. An asset the console cannot identify is shown in raw base units,
  never guessed at. "Test" is said only when the network id says so.
- Raw JSON appears only inside "Technical details", as the parsed (and re-masked) response.

**No refresh button.** The gateway has `POST /v1/evidence/bank/refresh`, and the console deliberately does not call it:
the console is read-only, and a manual refresh is a bank call made on an operator's behalf. Observations are loaded
outside the console. The page's Reload button re-reads stored data only. Adding a refresh action is a product decision
that needs approval, not an implementation detail.

## How statuses read on screen

| Gateway (`HumanProgress.stage` + `state`) | Console status | Group |
|---|---|---|
| `confirming_payment`, payment `not_received` | Awaiting payment | In progress |
| `confirming_payment`, other payment states | Confirming payment | In progress |
| `purchasing` | In progress | In progress |
| `verifying_result` | Checking with merchant | In progress |
| `complete` | Order confirmed / Booking confirmed / Ticket issued (otherwise Purchase confirmed) | Completed |
| `needs_attention` + `requires_reauthorization` | Price changed | Needs attention |
| `needs_attention` + `failed` | Couldn't complete | Needs attention |
| `needs_attention` + `expired` | Expired | (All only) |

**Price changed.** The gateway pauses with `requires_reauthorization` and does not produce a new quote. The console says
so plainly ("The price changed, so nothing was bought") and offers one action: copy a request for a new quote to give to
the assistant. There is no side-by-side comparison, because no proposed quote exists to compare against.

## Products found at another store

When a quote carries `sourceOffer` and `sandboxRepresentation` (Shopify Global sandbox), the product was found at a
real store but the order is placed as an equivalent test order in Capsule's own Shopify test store. The console shows
the merchant as "Capsule test store", shows the original store only as "Found at <store>", and states on the summary,
proof and receipt that the original store receives no order and no payment. The quote dialog shows the listed price
and a display-only link to the original listing. The console never suggests the original store fulfilled the order.

## Gaps

Proposed gateway changes. Console fields for G1 to G4 already exist as optional `PurchaseContext` fields
(`web/src/contracts/proposed.ts`); the sample source fills them, the gateway source leaves them empty, and the screens
render with or without them.

| # | Console shows | Gateway today | Proposal |
|---|---|---|---|
| G1 | Item name in the purchases list ("Two nights in Singapore") | List items carry no title or quote ID; the console falls back to "Hotel booking" | Add `title` (from `QuoteView.title`) to `listPurchases` items |
| G2 | Which assistant asked ("ChatGPT", "Claude") | Only the `channel` enum, and only on the detail evidence route; the list has neither | Expose the API client's display label as `requestedBy: { name }` on list items and `PurchaseView` |
| G3 | The customer's request in their own words | Not stored | Optional `requestSummary` (plain text, no personal data, max 500) on `CreatePurchaseRequest`, echoed read-only. Or drop the block |
| G4 | "Approved up to $400.00" | `Approval.maxTotal` is recorded but not exposed | Add `approval: { maxTotal }` to `PurchaseView` |
| G5 | Price details and title with a read-only key | `GET /v1/quotes/:id` requires `quotes:write` | Allow `purchases:read` for quotes attached to the caller's own purchases, or add `GET /v1/purchases/:id/quote` |
| G6 | Search, status tabs and paging beyond 50 | 50 newest, no parameters; the console filters in the browser | Add `status`, `q` and `cursor` query parameters to the list route |
| G7 | Item details, price-line labels and merchant terms | Free text relayed from merchants. `receipt.limitations` is engineering wording, so the console writes its own receipt notes from receipt facts and keeps the gateway's text in the downloaded receipt | Optional: a customer-facing limitations field the console could show directly |
| G8 | Live updates | Serial polling 1.5 seconds after each completed read, only while live | Optional later: a server-sent events stream per purchase |

Nothing in this list blocks the console. Each one makes a screen more complete when the gateway provides it.

## Serving

`npm run build` also builds the console in gateway mode to `dist/console`. The gateway serves it at `/console`
(`src/console/router.ts`) with the same strict headers as `/inspect`: no inline scripts, same-origin scripts, styles,
images and API calls only. The page contains no private data; everything comes from the authenticated API after the
customer enters an access key. The console is the customer frontend: `/` and the earlier `/proof` page redirect to
`/console/`. `/inspect` remains as the engineering evidence view. `src/evidence/proof-page.ts` is no longer mounted by
the gateway; the test harness and a manual Shopify acceptance script still mount it themselves until they move to the
console.

For design work without a gateway, `npm run console:dev` runs the console on sample data at
`http://localhost:5174/console/`.
