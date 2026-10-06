# Cardano funding fix — PASS

Completed 2026-10-06, 14:12 UTC / 22:12 Singapore; final checks 14:16 UTC. Isolated branch `codex/cardano-funding-fix`, based on `0afd377681fe0e27e0ea86cf2cfaa34cdb970769`. No deployment, merge, push, mainnet transaction, live hotel call or real-money payment occurred.

## Behavior and findings

A real separate payer signed one bounded Preprod native-token transfer. The normal HTTP gateway/core and a dedicated PostgreSQL schema used the real Cardano adapter and hosted facilitator. The gateway independently checked Blockfrost before allowing its worker to execute a fixture hotel purchase. The receipt separates `fresh_external` Cardano funding from `local_fixture` commerce and `simulated_paid` merchant payment.

Two defects prevented this flow:

1. The funded wallet contains **Masumi dispenser tUSDM**, not the SDK default tUSDM. Previously, the adapter reported successful external readiness but refused to offer USD-notional funding for this exact configured asset. It now recognizes both independently documented exact Preprod identities, enforces six decimals, and still refuses an unrelated or similar policy. The treasury/requirement/payment/chain checks always use the selected exact unit; a ticker cannot substitute one token for another.
2. The payer expected an unprefixed 64-hex quote digest. The actual QuoteView contract and gateway issue `sha256:<64 hex>`, so every actual challenge failed before signing. The payer now requires the canonical contract format. Unit fixtures use it and explicitly reject the old bare format before touching a key.

The configured asset is `16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde.0014df10745553444d`. Primary source: [Masumi token identity and decimals](https://www.masumi.network/dev/masumi/documentation/how-to-guides/list-agent-on-sokosumi), checked 2026-10-06. The SDK default remains the distinct `e675b46e…` policy; both identities are pinned precisely, never inferred from names.

## Operator setup and history

The worktree's private `.env.cardano-e2e` reconciles root legacy Blockfrost aliases, reads the provisioned hosted facilitator endpoint, and inserts the canonical policy/name dot. It contains no payer key, mnemonic or key-file reference. The gateway subprocess receives only its own environment; startup explicitly rejects inherited payer authority.

The root wallet fingerprint is `a2e66045653afe62`. Before signing, the configured mnemonic derived exactly the declared address. Complete ascending paginated official Blockfrost address history showed three incoming transactions and **zero outgoing transactions**. The original starter signer scripts persist no signed headers; no historical payer ledger was found in the inspected setup/root trees. Parent coordination granted this lane exclusive signing ownership; Masumi's wallet fingerprints are different. This evidence justified an initially empty history of outgoing payments; it was not a reset or bypass. Incoming historical transaction identities and reconciliation time are retained in `live-e2e.json`.

A protected shared ledger now lives outside the disposable worktree:

`C:/Dev/token2049-setup/secrets/cardano-payer-a2e66045653afe62/ledger.json`

Its directory has inheritance removed and the current operator's full-control Windows ACL. The separately extracted mnemonic remains private there. The ignored worktree `.env.payer` references this exact absolute ledger and a private gateway token. Existing starter key material was preserved, not silently removed or modified.

Legacy per-purchase and total token ceilings were unset. Explicit one-payment sandbox ceilings are per-payment/daily/cumulative **1020 base units**, fee **500000 lovelace**, treasury ADA output **2000000 lovelace**. The private setup used the lower of any supplied legacy ceiling and these token limits; no existing ceiling was raised. These incidental ADA ceilings are per transaction. The ledger now contains the accepted payment and **the token budget is exhausted**. Do not reset it to run another test.

## Actual evidence

Transaction: [0086ff87f9cdd828968d1f3a895af11d935325efddad5890b79850ce7d97e683](https://preprod.cardanoscan.io/transaction/0086ff87f9cdd828968d1f3a895af11d935325efddad5890b79850ce7d97e683)

Purchase: `pur_01M48RKCSN1GEPBY0MNBEQDC6A`.

Commercial fixture quote: USD 1.00 principal + USD 0.02 fee, disclosed scaled-testnet 1:1000 policy. Transfer: 1020 base units = 0.001020 test tokens, plus 1168010 lovelace min-output ADA. Actual transaction fee: 177337 lovelace. Independent Preprod network magic: 1; inclusion block: 5260845; eight newer blocks at the explicit readback. Metadata label 2049 independently equals commitment `c3609fd61ba88bf17fe1870404794aaf08b3c6cc708a7eb68577cb730a41a9da`.

The HTTP 202 response after the real send was deliberately discarded. The original payer therefore returned `gateway_unreachable`. Its exact signed header was already durable. After gateway and payer restart against the same PostgreSQL schema/shared ledger, it resumed the same transaction without building another one. The fixture hotel then executed once. The primary purchase had one funding evidence row, one prepared funding attempt, one consumed reservation and three balanced journal entries. The additional unfunded guard purchase has its own reservation and never executes; total fixture-schema reservations are two after guard checks.

Live checks rejected wrong network/asset/amount/payee/quote extras before broadcast. Reusing the signed transaction with a fresh purchase's exact echoed terms fails the cryptographic commitment check. Unaltered cross-purchase and already-funded same-purchase replays fail. Restart/rerun retains the same accepted transaction and 1020 committed units. Live-state cumulative/daily/per-payment and future-clock expiry tests use a disabled signer: zero key touches, no extra ledger reservation or funding evidence. Daily testing varies only a test dependency's cumulative ceiling so the daily guard can be reached; it never enables signing or changes operator configuration.

## Files and validation

Product files: `clients/payer/payer.ts`, `src/funding/cardano/config.ts`, `src/funding/cardano/adapter.ts` (comment only). Regression tests: `tests/unit/cardano-payer.test.ts`, `tests/unit/cardano-adapter.test.ts`.

Acceptance files: `integration-e2e/cardano/{e2e,gateway,runtime,readback,postchecks}.ts` and sanitized `live-e2e.json`. The JSON includes base-commit and working-file SHA-256 provenance, exact chain evidence and the honest receipt; it contains no signed header, mnemonic, token or provider key. Private configuration/history/run-state/log files remain ignored.

- Full Vitest suite: **26 files / 517 tests PASS**, including real PostgreSQL recovery, settlement arithmetic and payer guards.
- Application TypeScript typecheck: **PASS**.
- Strict acceptance-script TypeScript typecheck: **PASS**.
- Production build and migration-copy step: **PASS**.
- `git diff --check`: **PASS**.
- Bounded real Preprod funding E2E, restart/response-loss recovery, independent chain readback and no-sign postchecks: **PASS**.

The standalone scripts require the existing private operator configuration and retained `data/cardano/run-private.json`; this is evidence orchestration, not a production route. Run `readback.ts` or `postchecks.ts` to inspect retained evidence without enabling another signer. Do not rerun `e2e.ts` as a new payment or change its state/history to obtain more cap headroom.

## Remaining issues and integration

| Classification | Issue / importance | Action | Risk of deferral |
| --- | --- | --- | --- |
| Act Now | Existing legacy starter buyer still possesses the preserved mnemonic and does not use this shared ledger. | For integration, route every process using this wallet through the bounded payer and the exact shared ledger; never run the old starter buyer concurrently. Copy canonical gateway/payer names from the private worktree configuration into the intended operator deployment separately. | An independent legacy signer can spend outside these controls; the untouched root legacy config remains unsuitable for this fixed gateway. |
| Ignore / Accept Risk | Merchant and card capacity are explicit fixtures. | Retain receipt disclosures; use another lane's real merchant acceptance before claiming commerce-provider E2E. | This PASS proves Cardano funding and core gating, not real hotel execution, FX, redemption, Visa or bank settlement. |
| Park for Later | Live response loss was injected after the gateway had recorded successful funding. | Existing PostgreSQL recovery tests cover process-loss windows before recording; a future broader chaos milestone may inject that specific live window. | This single bounded run does not empirically exercise every crash window against the hosted facilitator. |
| Ignore / Accept Risk | Fixed test budget is now exhausted and private state/schema remain for audit. | Preserve the shared ledger and retained evidence. Any later spending policy must be explicitly reviewed; never delete history. | Reusing or archiving worktree configs without retaining authority references can cause operator confusion. |

Next task: review and integrate this scoped branch, propagate the canonical private configuration to the intended sandbox, and preserve the shared ledger. Use a **fresh chat** for the next milestone with this report, the exact commit, and the instruction that this payer budget is exhausted. No further Cardano transfer is needed for this fix.
