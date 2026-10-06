# Demo purchase latency

This lane changes final presentation and console visibility. Payment finality, approval, idempotency, execution,
provider readback and recovery policy remain unchanged. No new payment, order, booking or ticket was created to
measure latency. Existing provider evidence and fixture tests must not be confused with a new combined live run.

## Obtain a breakdown without another provider call

Download the customer's technical proof JSON from the console's Proof panel, or save the response from the
existing authenticated `GET /v1/evidence/purchases/:id`. Run locally:

```powershell
npm run latency -- 'C:\path\technical-proof.json'
```

The script reads a local file only. It prints timestamps and measured durations, discards unrelated record fields,
and never prints credentials, provider responses, payment headers, traveler details or merchant references.
Missing boundaries say `unavailable`; overlapping phases must not be summed.

For console visibility, inspect the local browser DevTools performance mark after completion:

```javascript
performance.getEntriesByName('capsule.purchase_visible').at(-1)?.detail
```

Match its purchase ID to the downloaded record and pass `observedAt` as the second argument:

```powershell
npm run latency -- 'C:\path\technical-proof.json' '2026-10-07T00:00:00.000Z'
```

The timestamp above illustrates the command syntax, not a measurement. The mark is local, holds at most one
completed purchase, and sends nothing externally. It records when the bundle was presented to React, before paint;
visibility includes HTTP and refresh waits. A later independently verified ticket issuance (`outcome.refreshed`)
is counted as merchant latency; console visibility starts from that final update rather than the earlier receipt.
Browser and gateway clocks must agree. Negative durations report
`unavailable`, since clock skew must not be presented as a speedup.

## Timing sources and limits

| Boundary | Durable source |
| --- | --- |
| Quote created | Existing `quote.createdAt` |
| Purchase authorized | Existing `approval.recorded` |
| Payment prepared | Existing `funding.attempt_prepared`; this is before submission |
| Payment submitted | Existing `funding.submitted`; unavailable if the first verification already confirms payment |
| Payment detected | Submitted event, or first funding row's `verifiedAt`; approximate detection in the gateway |
| Payment confirmed | Existing `funding.confirmed`; this is confirmation and application, not the exact chain inclusion time |
| Purchase queued | Existing `execution.queued` |
| Worker picked it up | New `execution.picked_up`, after the worker obtains the purchase lock |
| Merchant execution started | Existing `execution.started`, before adapter/context preparation |
| Merchant response/reference observed | New `execution.reference_observed` from existing Shopify order/Nuitée booking checkpoints |
| Adapter returned | New `execution.adapter_returned`; includes mandatory provider readback |
| Verified success | Existing `execution.succeeded` or later `outcome.refreshed` for independent ticket issuance; core guards must pass |
| Receipt issued | Existing `receipt.issued`; same transaction timestamp as verified success |
| Console sees completion | Local `capsule.purchase_visible` mark |

Shopify and Nuitée reference checkpoints approximate the split between a merchant response and later readback.
A reference alone does not prove success. A resumed purchase may first observe a reference during readback;
the report explicitly describes these segments as approximate. Atlas's order checkpoint precedes payment, so
it cannot be used as a ticket/payment response boundary. Its execution and verification duration stays combined.
Existing records lack the new worker/reference/return boundaries and retain `unavailable` rather than inferred data.
Later reconciliation is included in the combined merchant-to-verified duration; it is not pure provider request time.

## Recorded provider-only evidence

The existing untracked local file `integration-e2e/atlas/evidence-2026-10-06T13-35-24-497Z.jsonl`
records a run against source SHA `72f95de467d4be7773e9c845e0a0fd932d242b81`, before this lane's base:

A timestamp-only extraction and original-file SHA-256 are committed in
[demo-polish-latency-baseline.json](../evidence/demo-polish-latency-baseline.json) for review.

| Observation (UTC, 6 October 2026) | Time |
| --- | --- |
| Create-attempt checkpoint | 13:35:24.920 |
| Order-reference checkpoint | 13:35:25.120 |
| Payment-attempt checkpoint | 13:35:25.292 |
| Initial execute returned | 13:35:25.593 |
| Independent retrieve returned | 13:35:25.832 |
| First observed ticketed readback | 13:36:07.146 |

Create-attempt to order checkpoint: **0.200s**. Payment-attempt to initial execute return: **0.301s**.
Payment-attempt to first ticketed readback: **41.854s**. Readback observations after the independent retrieve were
10.261s, 10.226s, 10.237s and 10.590s apart. These are measured observation intervals, including local driver waits
and provider calls. The actual ticket-ready timestamp is not available. This is provider-only evidence, not a
measurement of blockchain confirmation, queue wait, this lane's improvement, or the three combined paths.
The raw file is not committed by this lane.

## Internal delays versus external work

| Source | Classification | Decision |
| --- | --- | --- |
| Detail polling: 5s | Internal visibility delay | Reduced to 1.5s after each completed read; no polling after final |
| Worker tick: 1s (`WORKER_INTERVAL_MS`) | Internal queue pickup | Already configurable and short; unchanged |
| Single worker drains jobs serially | Internal contention + time spent in other external jobs | Measure pickup event before considering concurrency |
| Pending funding recheck: immediate first check, then 30s/60s/etc. backoff | Internal observation delay + external finality | Unchanged pending measured evidence; no finality reduction |
| Funding recovery initial wait: 15s | Internal recovery delay | Unchanged; ambiguous-payment policy remains intact |
| Merchant reconciliation: 15s initial, increasing backoff | Internal recovery observation + provider readiness | Unchanged; never re-execute ambiguous merchant actions |
| Ticket outcome refresh: 30s | Internal observation + external ticket issuance | Unchanged pending a measured current combined run |
| Four console detail reads | Internal HTTP/database work | Already overlap safely; quote depends on purchase ID and overlaps proof/evidence |
| Required independent provider readback | External verification | Preserved |
| Chain confirmation/finality | External blockchain | Preserved |

No real transaction speedup has been measured. The configurable timer changes from 5000ms to 1500ms; request
duration is added before scheduling the next read. Polling can still miss states shorter than the observation
interval. The timeline keeps durable progress visible without holding states artificially or claiming success early.

## Issue triage

| Classification | Issue, action and deferral risk |
| --- | --- |
| Act Now (done) | Generic final screen and 5s visibility: commerce outcome panel, prominent reference, receipt/proof access and serial 1.5s polling. Deferring obscures demo progress and the ending. |
| Act Now (done) | Missing queue/adapter boundaries: add lightweight durable events and local breakdown tool. Deferring encourages guessing at latency. |
| Investigate Now | Run the tool on the next already-authorized combined E2E records; distinguish confirmation/readback observation waits from external latency. Without data, tuning backoffs risks provider load and earlier recovery escalation. No new external run is authorized in this lane. |
| Park for Later | Worker concurrency, cached immutable quote reads, SSE, and finer Atlas call timing. Defer until timing shows material cost; current single worker can wait behind another slow job. |
| Ignore / Accept Risk | Sub-second states can be missed and wall clocks can differ. Accept for this demo with durable activity/proof and explicit unavailable timings; do not fabricate animation delays or timing precision. |

## Files in this lane

- Shared presentation: `src/contracts/presentation.ts`.
- Timing events and analysis: `src/core/worker.ts`, `src/core/latency.ts`, `scripts/purchase-latency.ts`, `package.json`.
- Console: `web/src/contracts/backend.ts`, `web/src/copy/en.ts`, `web/src/model/present.ts`, `web/src/model/types.ts`,
  `web/src/ui/PurchaseDetail.tsx`, `web/src/ui/useDetail.ts`, `web/src/ui/detailRefresh.ts`, `web/src/styles/console.css`.
- Tests: `tests/unit/presentation.test.ts`, `tests/unit/latency.test.ts`, `tests/unit/mcp.test.ts`,
  `tests/integration/latency.test.ts`, `web/src/model/present.test.ts`, `web/src/ui/completion.render.test.tsx`,
  `web/src/ui/detailRefresh.test.ts`.
- Documentation/evidence: `docs/contracts/CONSOLE_CONTRACT.md`, `docs/demo/PURCHASE_LATENCY.md`,
  `docs/evidence/demo-polish-latency-baseline.json`.
