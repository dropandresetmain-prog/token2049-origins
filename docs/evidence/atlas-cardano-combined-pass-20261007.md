# Real Atlas sandbox + Cardano Preprod combined E2E — PASS

Executed 7 October 2026, 03:31–03:41 Singapore. Execution checkpoint:
`48ec323630110d3d7522876bdc9c7adccc12b113`, branch
`codex/global-cardano-console-e2e`, worktree `.runtime/combined-shopify-cardano`.
Application code remains the successful combined E2E checkpoint; no branch merge,
dependency change, deployment, MCP, rail fallback or frontend implementation occurred.

## Verified result

| Field | Result |
|---|---|
| Flight | Z2 777, MNL → CEB, 5 November 2026, one adult; provider title `Z2Z2777 MNL to CEB` |
| Commercial total | USD 22.87: fare 4.87 + tax 18.00; provider transaction fee 0; Capsule fee 0 |
| Quote | `quo_01M49B82CA1G6CAJPFTYZ8ANKE` |
| Explicit Cardano funding option | `fop_01M49B82C9S6TBN07KD0QAAF3Z` |
| Purchase | `pur_01M49B9QJCBD8SS77FMAXNTJK8` |
| Cardano payment | 22,870 base units = 0.022870 exact Preprod tUSDM; disclosed 1:1000 scale |
| Transaction | `000a96cbf2c6155492e7f701f7e57500509125855d043d0057237e85bcf56da0` |
| Confirmations | Core recorded 1; independent final readback recorded 11 newer blocks, inclusion height 5,261,680 |
| Atlas order / payment reference | `TESTA20261007033457267`; test-balance paid at 03:34:58 Singapore; no separate payment ID returned |
| PNR / ticket / airline reference | PNR `DQLFN7`; ticket and airlinePNR `S19397` |
| Independent provider readback | Exact order, USD 22.87, zero transaction fee, payment timestamp, one passenger record, orderStatus=2, ticketStatus=1 |
| Receipt | `rcp_01M49BCHX6239KYXQ3604GWDYM`; refreshed to ticketed without replacing the receipt ID |
| Final core state | succeeded / confirmed / ticketed / test_balance_paid |
| Reservation | Consumed, USD 22.87 |
| Journal | Observed funding_received and prepayment_applied; simulated provider test-balance merchant payment; all trial balances zero |
| Proof | Both funding and merchant fresh_external; funding applied; final outcome complete; receipt present; console Proof 2 of 2 |
| Counts | One funding attempt/evidence, one execution attempt/job, one create_attempt/order/pay_attempt checkpoint, one receipt |
| Remaining Cardano headroom | 35,170 cumulative and same-UTC-day base units = 0.035170 tUSDM / USD 35.17 scaled notional; 66,830 committed under 102,000 caps |

The payer was invoked once and did not resume or retry. HTTP funding consisted of
one unsigned 402 challenge and one signed 202 submission. There was no second
transaction, purchase, quote, Atlas create or payment execution. Normal subsequent
Atlas refreshes and standalone verification were read-only. No operation became
ambiguous; paid-and-ticketing was a known successful payment state.

## Preflight and retained authority

Read CARDANO_FIX, ENVIRONMENT, RUNBOOK, SEED_DATA, the Atlas adapter and standalone
Atlas acceptance report, and successful Shopify+Cardano / Nuitée+Solana reports.
The older exhausted 1,020-unit Cardano budget was superseded by the retained
combined-run cap authorization; this run did not raise any cap.

Independent Blockfrost genesis magic was 1. Exact six-decimal asset:
`16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde.0014df10745553444d`.
Gateway and payer treasury matched
`addr_test1qrw503gkfd8cygz77c7jdympe75c66twatus3japsemz7eqdmmdxvsstkvdftkvanpquhyt86ra048k5rwjx9x0gxytqn523py`.
Wallet derivation matched the established source identity. Before payment it held
105,958,767 lovelace and 99,956,040 units of the exact asset. Paginated ascending
wallet history identified three outgoing transactions, all represented as accepted
in the existing ledger. No lock, unrecorded outgoing transfer or stale signing
entry existed. The protected directory has inheritance removed and operator-only
FullControl. The absolute ledger remained
`C:/Dev/token2049-setup/secrets/cardano-payer-a2e66045653afe62/ledger.json`;
preflight SHA-256 was `055c7b0828f10e3db4240a7ffd5c67caa76d75bf7e5d1ff76cdfe7403b9f3b79`.
No history initialization, reset or replacement occurred.

Per-payment/daily/cumulative caps stayed 102,000 units. Existing fee/output caps
stayed 50,000,000 / 200,000,000 lovelace. Headroom before payment was 58,040 units.
Atlas authentication/search and exact verification passed against only
`sandbox.atriptech.com`; five offers returned. The cheapest was quoted once and
funding explicitly pinned Cardano. Post-order zero-fee readback guards passed
before the native test-balance payment.

Console and HTTP reused customer `cus_01M496A1AMX19SC5AEDRX21BAE`, schema
`combined_0377612108794d379e15259bee7b166a`. Both client/customer bindings were
checked in PostgreSQL. No alternate database or customer was created.

## Actual console observations

The headed console stayed open at `http://127.0.0.1:18882/console/` and automatically
followed this new API purchase. A DOM MutationObserver recorded:

- 03:34:05: Awaiting payment / Waiting for payment.
- 03:34:22: Confirming payment / Checking the payment.
- 03:34:57: Confirming payment / Payment sent, waiting for confirmation.
- 03:35:02: Checking with merchant / Waiting for Atlas to confirm.
- After normal outcome refresh at 03:39:00: Completed / Ticket issued / 4 of 4 done.
- Proof dialog: Received Cardano 0.02287, exact transaction, confirmed Atlas booking,
  Ticket issued, test-balance payment, exact merchant reference.
- Receipt dialog: Completed, USD 22.87, Cardano test network, Atlas test mode,
  Ticket issued, exact merchant reference and receipt number.

Purchasing was not observed as an intermediate live state. Completed step text
and backend execution events are not presented as evidence that it was observed.
Screenshots are retained under `output/playwright/atlas-cardano/`; private run
artifacts and observations are under `data/combined/atlas-cardano/`.

Desired final ending remains **“Ticket issued” with booking/ticket/provider reference**.
Existing merchant, proof and receipt views already say Ticket issued and display
the provider reference; the main heading remains Purchase complete. No wording
was implemented in this lane.

## Issues and disposition

| Classification | Issue / why it matters | Action | Risk of deferral or acceptance |
|---|---|---|---|
| Act Now — resolved | Prior Nuitée gateway still ran against the shared schema and could claim Atlas refresh jobs with a different profile. | Stopped only its verified process (36684); the next normal refresh completed ticket issuance. Before future runs, ensure one correctly configured worker owns this schema. | Competing incomplete profiles can delay or interfere with provider execution/reconciliation. |
| Investigate Now | Competing-worker causation is inferred: historical per-attempt claimant/configuration was not retained, although fresh Atlas adapter readback succeeded and removal preceded normal refresh success. | Inspect retained job/configuration evidence read-only; improve ownership/preflight in a separate lane. | Attribution remains incomplete; the completed provider/payment result is independently verified. |
| Investigate Now | Cardano cumulative headroom is now USD 35.17 scaled notional. | Compare any separately authorized future exact quote against retained caps; preserve history. | More expensive quotes must stop; no further spend is authorized by this PASS. |
| Investigate Now | Atlas ambiguous-create recovery remains historically unverified. | Investigate order-list freshness/recovery read-only; preserve stop-writes policy. | A future ambiguous create may remain unresolved; this happy path does not validate recovery. |
| Park for Later | Purchasing was shorter than console polling; main heading/receipt notes remain generic. | Separate observation/UX lane; desired ending above. | Incomplete live-stage capture and less precise flight wording; final ticket/reference are correct. |
| Ignore / Accept Risk | Harness startup log still names an old SHA and Shopify/Cardano. | Use this exact checkpoint, frozen quote, selected rail and independent evidence; update local harness labels before reuse. | Startup labels alone can misstate provenance. |
| Ignore / Accept Risk | Read-only verifier initially counted the unsigned funding challenge as a second payment. | Corrected to assert one 402 challenge and one 202 signed submission; reran read-only assertions. | No effect on payment; careless request counts could misreport retries. |
| Ignore / Accept Risk | Favicon 404 and local CLI module/import syntax issues occurred during observation setup; the final gateway restart briefly caused a connection-refused browser request. | Console authenticated and observer was functioning before spending; final post-restart observation still shows Completed / Proof 2 of 2. | Cosmetic/favicon or transient restart error; no commerce impact. |
| Ignore / Accept Risk | Provider test balance and valueless scaled Preprod funds do not demonstrate fiat/card/bank settlement. | Retain receipt/environment disclosures. | No production economic settlement claim is established. |

## Completion and next step

Tracked additions: this report and `atlas-cardano-combined-pass-20261007.json`.
Private additions: isolated gateway/payer profiles and bounded preflight/flow/pay-once/
verification/observation helpers. No product files, dependencies or frontend changed.
Live checks passed: network/asset/treasury/balance/history/ACL/caps; canonical
HTTP contract parsing; fresh search/exact quote; one payer invocation and signed
submission; independent chain output/commitment and provider ticket readback;
receipt/reservation/journal/proof invariants; actual console/proof/receipt views.
No application suite rerun was necessary for this evidence-only lane.
Final sanitized-evidence assertions, exact configured credential-value exclusion,
new-file whitespace checks and Git diff whitespace checks also passed.

After completion, Atlas payment flag was disabled and this gateway restarted
with its worker paused and all HTTP writes blocked. The console remains open and
readable on the same origin/customer/schema. Private browser token script/log
copies were removed; canonical tokens, payer history and all purchase evidence remain.

No new milestone starts. Recommend a fresh chat for any separate worker-ownership
investigation or UI work, using this report and excluding new payment/booking,
ledger reset and unrelated branch integration. This is a useful evidence commit
checkpoint; stage only these two evidence files.

```powershell
Set-Location 'C:\Dev\token2049-origins\.runtime\combined-shopify-cardano'
git add -- docs/evidence/atlas-cardano-combined-pass-20261007.md docs/evidence/atlas-cardano-combined-pass-20261007.json
git commit -m "docs: record real Atlas and Cardano combined E2E"
```
