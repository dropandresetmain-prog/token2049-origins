# Release and rollback runbook — Capsule E2E reliability repair
12 October 2026, Singapore. **Runbook only.** Writing or reading this file fences nothing, deploys nothing and touches no database. Every step below needs the owner's explicit, per-action authorization; none has been executed or pre-approved.

"This release adds no migration" does **not** make it financially reversible. The risks of switching binaries are in-flight money state, signer authority, and records the new binaries wrote that the old binaries may not parse. The procedure below addresses those, in order.

## 0. Invariants (never violated by any path in this runbook)
- The current canonical Neon PostgreSQL 18 database and the payer's signer/ledger history are the only truth. **Never restore a stale snapshot over it, never reset a ledger, never delete or re-key a wallet identity.** A backup taken during rollback is for forensics only.
- **Exactly one signing authority at a time.** Never run two payer processes with enabled authority; never reactivate the retired local Cardano/Solana/Sui signers, the old Solana service or revoked legacy gateway payer clients.
- No cap, policy or key change is part of a rollback.
- Unknown outcomes are reconciled read-only against the **existing** durable candidate (same transaction id, same signed header). Never rebuild a candidate, switch wallets, or POST a payment again.
- Prefer **roll-forward** (fix and redeploy the new line) to rolling back whenever any payment, merchant operation or durable job is unresolved.

## 1. What this release changes that a rollback must account for
| Boundary | Previous (recorded live) | Candidate | Rollback-relevant effect |
|---|---|---|---|
| Gateway (`srv-db2jgqnavr4c73e9blrg`, `Dockerfile`) | `86f5194` | candidate SHA in the handoff | Cardano uncertain settlement now answers HTTP **202 `{confirmationPending:true}` with `funding: []`** (was HTTP 402 `payment_invalid … retry with the identical payment header`); journals `funding.confirmation_pending` instead of `funding.rejected`. |
| Consolidated payer (`srv-db2mnk1srm7s73c1f5c0`, `Dockerfile.multiwallet`) | `3945f9c` (instance `capsule_3945f9c52cf7`) | candidate SHA | **Artifact changes.** One signed funding POST per run; ambiguous results reconciled by read-only GETs; a pending result keeps the ledger entry `signed`. Its instance id is derived from the SHA, so signing grants are **instance-bound** (`wallet_signing_authority.instance_id`). |
| Cloudflare wake Worker | `00ee6d4a-…` health-only | unchanged | none |
| Database | schema through `0013` | **no migration**, no additive column, no new table | Data written by the candidate is the compatibility question (§3), not schema. |

Records the candidate may have written that a prior binary was not built to read:
- `quotes.public_json` / `quotes.quote_json` containing `originalBudget` (flight/hotel USD-input contract). `QuoteView`/`ReceiptView`/`PurchaseView` are `.strict()`, so a prior binary **fails to parse** such a quote or receipt.
- `offers.public_json` / persisted source offers containing `media` (`SourceOffer` is `.strict()`).
- `purchase_events` rows of type `funding.confirmation_pending` (an event type string; harmless to store, shown by the console copy only on the new build).
- A **pending Cardano candidate with no funding-evidence row** (`payment_state='unknown'`, `funding_attempts.status='pending'`). The prior payer and prior gateway handle this state only through the same recovery path, but the prior payer would answer a repeated pay request with a conflict rather than "pending".

## 2. Quiesce write and signing authority BEFORE switching versions
Owner authorizes each step; use the existing documented mechanisms (see `docs/architecture/CONSOLIDATED_PAYER.md` and `docs/architecture/PAYER_READINESS_REPAIR.md`). Do **not** re-run `scripts/multiwallet/repair-release.mjs` unchanged: it is pinned to branch `codex/capsule-neon-migration` and the prior repair's SHA, secrets and migration step, so a release for this candidate needs its own owner-approved plan.

1. **Stop new spend first.** Set `MULTIWALLET_SIGNING_ENABLED=false` on the payer and disable the three registered wallets' `wallet_signing_authority` rows (this fences the new payer; legacy images ignore database grants, which is why they stay retired). Restrict the demo core client's `purchases:*`/write scopes so no new quote or purchase can start. Do not delete anything.
2. **Wait for or stop the gateway worker** only after step 3 shows what it still owns; a stopped worker must not strand a `recover_funding`/`confirm_funding` job — those are read-only and are the preferred way to resolve uncertainty.
3. **Inspect (read-only SQL / console).** Record counts and ids, do not modify:
   - Funding: `purchases` with `payment_state IN ('unknown','submitted')` or `state='awaiting_funding'`; `funding_attempts WHERE status='pending'`; `funding_evidence` with `application='pending_confirmation'`.
   - Merchant: `purchases` with `commerce_status IN ('unknown','held','order_created_unpaid','payment_pending')` or `state IN ('funded_queued','executing','unresolved')`; open `execution_attempts`.
   - Durable work: `jobs WHERE status IN ('pending','claimed')` by `kind` (`recover_funding`, `confirm_funding`, execute/reconcile kinds); dead jobs.
   - Handoffs: `payment_handoffs` with `status='running'` or `status='failed' AND retry_safe=false`.
   - Payer ledger (`hosted_payer_ledger` and the Solana/Sui wallet ledgers): any entry in `signing` or `signed` (not `accepted`) — each is a reservation or an unsettled candidate that still counts against caps.
4. **Decide.** If **any** item above is unresolved, **do not switch binaries**. Hold authority fenced, let the *current* (new) binary's recovery resolve it read-only (a Cardano candidate is resolved by `recoverPendingFunding` → Blockfrost read of the recorded transaction; the facilitator is not contacted again), re-inspect, and repeat. Switch only when every funding attempt is `recorded` or removed, every purchase is terminal, and no job is `pending`/`claimed`.

## 3. Verify the prior binary can read what the candidate wrote
Run before any switch (read-only):
- `quotes`/`offers` created since the candidate was deployed whose JSON contains `"originalBudget"` or `"media"`: for each, the owning purchase must be terminal or the quote expired and unreferenced by a non-terminal purchase. A non-terminal purchase referencing such a record **blocks** the binary switch (roll forward instead).
- Receipts (`purchases.receipt_json`) containing `originalBudget`: a prior binary cannot parse them in its console or MCP readback; they stay in the canonical history and are readable again by the new line. Customer-facing readback of those purchases is degraded during a rollback — accept and record it, never edit or delete the rows.
- No `payment_state IN ('unknown','submitted')` rows (already required by §2.4).
- Prior payer + new gateway and new payer + prior gateway are each safe for **settlement** (the gateway's canonical one-attempt guard and the facilitator's transaction-id dedup are unchanged), but the pair is only supported when nothing is pending. Do not leave a mixed pair running with pending candidates.

## 4. Switch (only after §2–§3 are clean, owner-authorized)
1. Redeploy the **previous** pinned SHA to the existing service(s) with signing **disabled** (`86f5194` gateway; `3945f9c` payer with `MULTIWALLET_INSTANCE_ID=capsule_3945f9c52cf7`). Never create a second service.
2. Confirm the replaced instance is gone (Render deployment status, no second live process, health/readiness from the Worker path only).
3. Re-grant signing for the **previous instance id only**, only after the owner re-authorizes, and only for the three existing registrations. The candidate instance's grants stay disabled.
4. Verify canonical history unchanged: row counts and hashes of the ledgers, `funding_evidence`, journal; caps and pinned policies identical; the retired legacy fences still refuse.
5. Restore the demo client's scopes last. Stop for the owner's retest; the agent creates no quote or purchase.

## 5. Roll forward instead (default when anything was unresolved)
Keep the candidate line, keep authority fenced, ship a narrow fix with fixtures, re-verify §2–§3 and redeploy the same service. This is the only path once any signing, submission or uncertain outcome has occurred under the candidate and cannot be shown terminal.

## 6. Never
Restore a stale database or Render backup over the live one · reset or truncate a ledger · re-enable the retired local or old Solana signers · run two signers with enabled authority · delete a candidate's `funding_attempts`/`hosted_payer_ledger` row to "unstick" a payment · POST a payment again to resolve uncertainty · change caps or policy as part of rollback · replay the completed Atlas/Sui purchase `pur_01M4NRRCVHXW6GZEX35S7H20EM`, the expired Shopify quote `quo_01M4NSPKAB116PPJ9Z0KVGHVT2`, or any older incident purchase.
