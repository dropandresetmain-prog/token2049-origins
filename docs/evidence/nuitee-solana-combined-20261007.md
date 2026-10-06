# Nuitée + Solana combined E2E — UNRESOLVED, stopped before spending

Preflight: 7 October 2026, 02:51 Singapore. Execution code checkpoint:
`b760e82b594bcf784b791daadef99e80ffa055e4`, branch
`codex/global-cardano-console-e2e`. Remote `ls-remote` verified the exact checkpoint
on origin. The bounded Shopify console/redaction changes, regression tests and
successful acceptance log were already committed and pushed. Only ignored/runtime
browser output was left outside that checkpoint; no unrelated branch was merged.

The user requires stopping when safe Solana spend is unavailable. Preflight stopped
at that gate: the root private environment has empty payer per-purchase and total
caps and no complete combined Solana payer/facilitator profile. The previous live
Solana harness used process-local caps of 10,000 base units per purchase/cumulative,
1,000 commercial USD cents and 100,000 sponsor fee lamports. Those values are
historical bounds, not a new authorization to raise limits or initialize history.
Remaining payer headroom under that retained bound is 6,850 base units (0.006850
Devnet test tokens; USD 6.85 commercial notional at the documented 1:1000 scale).
No fresh hotel quote was obtained, so this report does not claim a verified hotel
price comparison against that headroom.

## Read-only checks

- Configured network: Devnet; RPC `https://api.devnet.solana.com`. This run checked
  configuration only, not current RPC genesis/account balances or chain finality.
- Mint: `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
- Payer: `5iSWoZSucVSaNjtxeVC5TCJTN1RQBC6nScw8P32X5MZ6`;
  source token account `2dWzL6j5sxpcfrqmuQdhbj22A4WXz2JwDNdbwa9wheMs`.
- Sponsor/treasury: `6QdrzAxbQMZGCSuk2R9ddneHum22VUJdabDM56ZAr6EU`;
  treasury token account `6imvBRJazCiUyJ96nBfFnFBBrKaJjZvALzyLCW8nkpJF`.
- Existing payer and sponsor key files derive those exact public identities.
  No message was signed and no secret bytes were printed or copied.
- Canonical ledgers remain in the successful Solana worktree's protected
  `data/solana` directory. Existing ACL checks, strict schema/identity/duplicate
  validation passed. Neither ledger has a lock.
- Payer: six entries, 3,150 committed base units. Sponsor: five entries,
  15,001 committed lamports; historical fee headroom 84,999 lamports.
- Two unsigned 1,050-unit reservations remain:
  `pur_01M48S9JMWEXMS34EEYCZ0YYKP` and `pur_01M48SB32BXEZGS9KPC74NNGM5`.
  They were documented as rejected simulations in SOLANA_FIX.md and were not
  released, reset or retried. This run did not independently reconcile their chain
  history and does not certify the absence of all ambiguous candidates.
- Ledger SHA-256: payer
  `f7839e0101cfcf2e2f8205d0a9215de48ee01325dcfa0d6302032b18830dd48d`;
  sponsor `4bf44576a0af68788eda4e73971729927ae6198fe5e16822fea6d9917c632e76`.

The read-only harness and detailed sanitized result are retained locally at
`data/combined/solana-readonly-preflight.ts` and
`data/combined/solana-readonly-preflight.json`. The harness only reads ledger/key
files and writes its local result; it never initializes, reconciles, reserves,
signs, starts a facilitator or submits a transaction.

## Requested execution fields

| Field | Actual result |
|---|---|
| Quote ID / purchase ID | None created |
| Hotel / rate / exact commercial amount | Not searched or prebooked in this run |
| Selected Solana funding option | None; purchase gate not reached |
| Solana amount / signature / finality | No new transaction |
| Nuitée booking / reference / status | No new booking execution attempt |
| Receipt / reservation / journal | None created by this run |
| Console states actually observed | None; frontend execution gate not reached |
| Proof result | No combined proof generated |
| Overall result | UNRESOLVED — blocked before spending |

Facilitator readiness, fresh Singapore hotel availability, prebook, traveller
validation, same-customer/database console connection and live state observations
remain unverified for this composition. Prior standalone Solana or Nuitée PASS
evidence is not counted as combined success. No MCP, Cardano fallback, Atlas work,
cap increase, history reset, booking or payment was performed. The final
"Booking confirmed" polish was not implemented; its UX behavior remains untested.

## Issues

| Classification | Issue and why it matters | Recommended action | Risk of deferral |
|---|---|---|---|
| Act Now | No complete bounded Solana runtime profile; payer caps are unset. Signing must fail closed. | Supply an explicitly authorized combined profile using the same protected histories, then repeat read-only readiness before any purchase. | Combined E2E remains blocked. |
| Investigate Now | Historical cap leaves only 6,850 units and USD 10 per-purchase commercial ceiling; no current hotel quote proves fit. | Obtain a fresh read-only search/prebook after the configuration gate is resolved; compare the exact total to all authorized caps. Raise no caps implicitly. | A viable hotel may exceed the existing bounds. |
| Investigate Now | Two retained unsigned candidates reduce headroom; current chain reconciliation was not run. | Reconcile retained attempts read-only before certifying no stale ambiguity. Keep reservations unless separately reviewed release evidence exists. | Lower headroom and incomplete operational readiness. |
| Park for Later | Final hotel confirmation ending is explicitly excluded. | Observe and report the existing UI when the run resumes; handle polish in its own lane. | Possible final-state wording gap remains unknown. |
| Ignore / Accept Risk | Native Nuitée sandbox commerce and valueless scaled Devnet funding do not prove fiat settlement. | Retain sandbox/testnet labels in any eventual evidence. | Production financial readiness is not established. |

No application implementation changed, so no new test suite run was necessary.
Read-only preflight passed ledger/key identity checks but the spending gate failed.
Resume in the same chat for a small configuration clarification; use a fresh chat
with this report if moving into signer recovery or cap-policy implementation.
