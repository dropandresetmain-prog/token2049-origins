# Hosted MCP stall recovery

Base: deployed gateway/payer commit `593e1d02ddeb867e7026b3b70a71e5459c17bddf`.
Branch: `codex/hosted-stall-recovery`. FX work is deliberately separate.

## Behavior

- Hosted search, quoting and buy wrap the whole operation, including payer readiness. A slow operation returns `search_pending`, `quote_pending` or `purchase_pending`; repeat the same tool with identical arguments to collect it. The gateway and payer operations continue in the current process.
- Completed quote collection checks the stored expiry with the gateway's clock. A retained expired quote returns `quote_expired`, rather than asking the user to approve it.
- Every payment handoff is claimed durably before calling the bridge. The new claim/completion HTTP endpoints require purchase-write scope and customer ownership. Completion additionally requires the claiming API client and current attempt ID. Handoff data is diagnostic: it cannot mark funding confirmed, alter approval, or cause merchant execution.
- A bridge refusal carries `retrySafe=true` only when the payer, under its ledger lock, confirms there is no reservation for that purchase. Signed, accepted, unfinished-signing and unreadable ledger states all fail closed. The MCP may resume the same approved purchase only after an explicit safe refusal. Network failures and older bridges without this field never authorize a retry.
- A late payer refusal is visible through `purchase.paymentAttempt` and the public progress projection. Running handoffs become operator-attention states after ten minutes without an outcome. Restarting the gateway does not clear their durable claims.
- Existing manual-reconciliation events appear as `operatorAttention`, rather than an indefinite automatic-progress message.
- Search-only routes attach `checkout.status=search_only` to offers. MCP explains the limitation before asking for fulfillment. Atlas's payment gate remains unchanged.

## Deployment and integration

The gateway requires additive migration `0007_payment_handoffs.sql`; migrations 0001–0006 are unchanged. No existing signer history is migrated or reset. The payer also needs this branch's retry-safety response for automatic recovery of definitely unsent refusals; an older payer continues to work but its failures require operator review.

Deploy the gateway and payer only after integrating the FX lane and validating the combined candidate. No public deployment or real payment is part of this change. The migration runner rejects an older checkout that lacks an applied migration, so a rollback must retain migration 0007 and compatible purchase-view code.

Unknown payments are never automatically retried. A process loss before or during a handoff can require read-only operator reconciliation. There is no new operator retry/reset endpoint. Search and quote background jobs remain in memory; only payment handoff claims and outcomes survive process loss. Physical retail fulfillment and production funding remain outside the sandbox.

## Verification

Regression coverage includes full-operation deadlines, expired result collection, late failures across MCP sessions, exclusive claims, stale/foreign completion rejection, definitely-unsent retries on the same purchase, unrecoverable signing states, overdue handoffs, manual reconciliation and search-only disclosure. Tests use isolated local PostgreSQL schemas and provider/payer fixtures; they do not sign or send real payments.

Final checks: backend suite 1,054/1,054 across 55 files; console suite 84/84 across nine files; backend and console typechecks, gateway build and `git diff --check` passed. The seven new recovery tests also passed separately after the final HTTP-boundary checks were added.
