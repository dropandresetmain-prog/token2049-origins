# Real Nuitée sandbox + Solana Devnet combined E2E — PASS

Completed 7 October 2026, 03:03 Singapore; independent verification at 03:04:32.
Execution checkpoint `6d6fcb78897d852fa02d99af359e973ef59bf92f` on
`codex/global-cardano-console-e2e`; application code is unchanged from
`b760e82b594bcf784b791daadef99e80ffa055e4`. The successful Shopify fixes and
evidence were already pushed at that application checkpoint. No unrelated branch
was merged, and no application code or dependency changed in this run.

The earlier blocked preflight report remains historical. The user subsequently
authorized matching the other rail's amount caps and continuing. Both rails use
six decimals and the documented 1:1000 commercial notional scale. Local private
Solana profiles therefore use 102,000 base units per purchase/cumulative and
10,200 commercial USD cents. The independent sponsor fee cap remains 100,000
lamports. Payer/sponsor history was never initialized, reset or released; ledger
hashes were unchanged when the new profiles were written.

## Result

| Field | Verified value |
|---|---|
| Quote | `quo_01M499FZ5A7SG1PESK25KD90S3` |
| Purchase | `pur_01M499GNYBPW16XJGQKQ62KDA3` |
| Hotel / room | Jyu Capsule Hotel / Upper Single Capsule - Mixed; hotel `lp656db636` |
| Stay | Singapore, 6–8 December 2026; one adult, one room; validated synthetic traveller |
| Exact amount | USD 91.07: room 83.58 + sales tax 3.81 + taxable service charge 3.68; Capsule fee 0.00 |
| Explicit Solana option | `fop_01M499FZ5A5PF5A16V47RKH3QV` |
| Solana amount | 91,070 base units = 0.091070 Devnet test USDC |
| Signature | `66jSAnq9eywGKGULpyRWYpskjTneFGcy9VJbNwg6xkHBPYiXt2Ni5HQPzW9hGur6AB4qDNDFt1TfnKMVdgemsV8L` |
| Finality | Independently retrieved at finalized commitment; slot 508192021; successful meta; sponsor fee 10,001 lamports |
| Nuitée booking | `8uPrCfmtZ`; CONFIRMED; payment succeeded; explicit sandbox=true; confirmation code `test` |
| Client reference | `T2O-PUR_01M499GNYBPW16XJGQKQ62KDA3-1-6D7669F487F97A84` |
| Receipt | `rcp_01M499J9Y34BV4FPDJSQ94PGFZ` |
| Reservation | Consumed, USD 91.07 |
| Journal | Observed funding_received, simulated merchant_payment_simulated_card, observed prepayment_applied; all native/USD trial balances zero |
| Counts | One funding attempt, one funding evidence, one execution attempt, one execute job, one book_attempt checkpoint, one booking checkpoint, one receipt |
| Proof | Funding and merchant both fresh_external; exact references; applied funding; receipt present; console Proof 2 of 2 |

Fresh canonical HTTP search returned ten real Nuitée offers; the cheapest was
prebooked into the exact quote above. The approved purchase explicitly selected
Solana. The existing bounded payer was invoked once, obtaining the existing
facilitator's sponsor signature and sending its immutable payment header once.
HTTP 202 was returned; normal core recovery independently confirmed finality.
The canonical worker made one Nuitée sandbox booking execution attempt using
ACC_CREDIT_CARD and independently read it back. A further standalone GET to the
provider booking endpoint confirmed booking ID, client reference, hotel ID,
sandbox flag, status, payment status and exact price. No resend, second booking,
replacement purchase or manual success mutation occurred.

Read-only chain verification decoded and validated the exact transfer, signatures,
mint, accounts, memo/quote commitment, historical owner/decimals and opposing
91,070-unit balance deltas: payer 19,998,950 → 19,907,880; treasury
20,001,050 → 20,092,120. Raw transaction SHA-256:
`7e73a9389e31b6a92d5b4fb33d9b16f2876eeb9034d9a0a3b7cc95a99a584e4e`.

Before spending, official Devnet genesis and exact six-decimal standard mint/token
accounts passed. Keys matched their configured public identities; strict protected
ledger parsing/ACL checks passed; finalized retained wallet history was fully read
and already represented in those ledgers. Both old rejected candidates were
expired and demonstrably lacked sponsor signatures; their reservations remain.
The previous paid candidate was independently finalized. No signing lock existed.
Payer balance was 10 SOL and 19,998,950 token units; sponsor balance was
4,999,984,999 lamports. The authenticated facilitator advertised the expected
scheme/network/sponsor/preparation prerequisite, and gateway readiness passed.

After this run, payer committed amount is 94,220 base units, leaving 7,780 under
the authorized 102,000 cap. Sponsor committed fee is 25,002 lamports, leaving
74,998. Prior failed reservations and successful history remain retained. These
values do not authorize another purchase.

## Actual frontend observations

The actual `/console/` was opened and authenticated before payment at
`http://127.0.0.1:18881/console/`, using the existing customer token. Customer and
payer clients were independently checked against customer
`cus_01M496A1AMX19SC5AEDRX21BAE`, schema
`combined_0377612108794d379e15259bee7b166a`. The console automatically followed
the new hotel purchase from the previous completed Shopify purchase.

Directly observed: **Awaiting payment → Completed → Proof 2 of 2 → Receipt**.
The awaiting view showed Solana 0.09107 due and the correct USD 91.07/stay.
The completed view showed Payment received, Booking the stay, Merchant
confirmation, and Booking confirmed as completed steps. Proof showed the full
Solana signature and booking `8uPrCfmtZ`; receipt showed USD 91.07, Solana,
Nuitée test mode and Booking confirmed.

**Not directly observed as intermediate live states:** Confirming payment,
Payment received / Purchasing, and Checking with merchant. The continuous
read-only DOM sampling call timed out at the browser transport while the real
payment/booking completed. Durable events record funding prepared at 03:02:59.683,
funding confirmed at 03:03:04.507, execution started at 03:03:05.031 and execution
succeeded/receipt at 03:03:09.465. These are backend evidence, not claimed live UI
observations. No payment or booking was repeated to improve capture.

Existing Booking confirmed labels were verified, but the main heading remains
generic Purchase complete. Receipt notes still use generic wording about orders
and shipping. The requested final-ending polish was not implemented.

## Issues

| Classification | Issue / why it matters | Recommended action | Risk of deferral or acceptance |
|---|---|---|---|
| Act Now — resolved | Missing Solana caps/profile blocked safe spending. | User-authorized equivalent caps were placed in isolated private profiles, preserving canonical histories. | No remaining blocker for this completed run. |
| Investigate Now | Intermediate UI transition capture timed out; visibility of every expected stage is unverified. | Improve bounded browser observation before a separately authorized future run; use retained events to inspect presentation read-only now. | Cannot claim the full intended live narrative was observed. |
| Investigate Now | Payer headroom is now only 7,780 units. | Keep the cap and retained history; assess any future quote against remaining headroom and obtain explicit authorization for any further policy change. | Another hotel payment is likely outside current remaining budget. |
| Park for Later | Two historical unsigned simulation reservations still consume 2,100 units. | Keep them retained; any proof-based release requires a separately reviewed recovery workflow. | Less headroom; conservative accounting remains safe. |
| Park for Later | Generic Purchase complete heading and receipt order/shipping language remain on the hotel path. | Handle final hotel UX polish in its own lane as requested. | Less clear provider-specific ending; proof and booking reference remain correct. |
| Ignore / Accept Risk | Provider returns processingFee 3.64 alongside price/selling prices 91.07. Prior user confirmation resolved inclusion for this ACC_CREDIT_CARD sandbox method. | Retain exact quoted/readback 91.07 and the existing method-specific fee interpretation; revisit before adding other payment methods. | Treating this interpretation as universal could misstate a different payment method. |
| Ignore / Accept Risk | Gateway harness startup labels still say Cardano/Shopify from its earlier run. | Treat the canonical frozen quote, explicit option, transaction, provider readback and proof as authoritative; update local harness labels before future reuse. | The startup line alone could be misread as provenance. |
| Ignore / Accept Risk | Provider sandbox payment and scaled valueless Devnet tokens do not demonstrate bank/card/fiat settlement. | Preserve environment and settlement limitations in evidence/receipt. | No production economic settlement claim is established. |

## Changes, checks and continuation

Tracked additions: this report and the selected sanitized verification JSON.
Local ignored files: separate private gateway/payer profiles, cap-authorization,
preflight/search/quote/purchase/payment/final proof/verification artifacts, bounded
execution/read-only helper scripts, and final console/proof/receipt screenshots
under `data/combined/nuitee-solana/`. No keys, tokens, traveller data or raw
provider body was copied into tracked evidence. The earlier stopped-run report
is preserved.

Checks: strict HTTP contract parsing; live chain/account/history/identity/ledger
preflight; real search/exact quote/cap enforcement; single payment/attempt
guards; independent finalized chain and provider readback; exact totals, identity,
reservation, receipt, journal and proof assertions; actual console/proof/receipt
inspection. All execution verification assertions passed. Browser continuous
sampling failed as described; no application test suite was rerun because no
application implementation changed. Final Git whitespace/secret checks are
performed before committing this evidence checkpoint.

No MCP, unrelated integration, frontend ending implementation, deployment, Atlas,
Cardano fallback or additional purchase occurred. A fresh chat is recommended for
the next distinct milestone, using this report as the compact handoff. The exact
next work, if separately requested, is bounded frontend observation/ending UX;
exclude new payment/booking attempts and signer-history resets. This milestone
is a testable documentation/evidence commit checkpoint; no further spending is
authorized by its PASS result.
