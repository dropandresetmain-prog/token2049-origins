# TOKEN2049 Origins — commerce gateway planning

Planning release: `launch-2026-10-06-v1` (6 October 2026, Singapore time).
Status: first long-horizon implementation authorized. No product code was written in this planning update.

> Any agent. Agent-native money in. Ordinary commerce out.

Build a buyer-side commerce gateway. The customer's existing agent submits a purchasing job; the gateway verifies funding, executes ordinary commerce and returns a receipt. Neither a new marketplace nor failed-order recovery is the product.

## Source of truth and handover

- Planning repository: `dropandresetmain-prog/wip-personal`, folder `token2049-hackathon/`.
- Implementation repository: `dropandresetmain-prog/token2049-origins` (verified empty during this update).
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) owns scope, lanes, checkpoints, acceptance and continuation rules.
- [CORE_CONTRACT.md](CORE_CONTRACT.md) owns the initial integration boundary and financial invariants.
- [ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md) records founder decisions and corrections to earlier proposals.
- [SETUP_AND_EVIDENCE.md](SETUP_AND_EVIDENCE.md) owns provisioning, verification gaps and source references.
- [NEXT_DISCUSSION_AGENDA.md](NEXT_DISCUSSION_AGENDA.md) contains only unresolved launch decisions, not another implementation plan.

The implementation agent's first commit must import this folder into `docs/planning/`, record its source commit, and establish `docs/work/ACTIVE_TASK.md`. Thereafter the implementation repository owns execution state. Do not maintain two independently edited implementation plans: bring later planning changes across through an explicit reviewed commit. The old “do not implement yet” instruction is superseded by the current launch authorization.

## Scope stays fixed

| Component | Overall status | First long-horizon lane |
|---|---|---|
| Shopify retail, Atlas flights, Nuitée hotels | Core, all three | Build all three adapters and verify each as credentials arrive |
| Direct Cardano Preprod x402 | Core original route | Build and prove a funded purchase |
| Solana Devnet x402 | Core second rail | Freeze seam now; implementation in its separate/next lane |
| Masumi / Sokosumi Commerce Coworker | Cardano-track priority after organizer guidance | Parallel lane, integrate after contract readiness |
| ChatGPT plugin; Claude/Cursor/Codex MCP | Separate customer channels | Canonical HTTP plus thin MCP and payment-aware client; connect clients next |
| Treasury and credential boundary | Core | Persistent journal, authorization, reservations, safe executor |
| OCBC fiat/card relationship | Retained | Bank/card adapter only for capabilities actually verified |
| Evidence console | Core overall | Evidence API and basic inspection; polished UI can run separately |
| Chainlink CRE | Secondary, after core | Integration seam only |
| NOWNodes | Low-value stretch | No mandatory setup |
| Exchange/CDP rebalance, Lalamove, supplier credit | Stretch | Not in first-lane implementation |
| WooCommerce | Retail fallback/second proof | Does not silently replace Shopify acceptance |
| Alibaba B2B; account linking/creation | Future/research | No implementation dependency |

**Parallel does not mean replacement.** The Masumi route does not replace direct Cardano, Solana, ChatGPT/MCP, Shopify, Atlas or Nuitée. Lane sequencing does not demote overall scope.

## Two different kinds of evidence

Public-testnet payments are real transactions with valueless test assets. Merchant sandboxes produce provider-generated test orders/bookings. Internal simulated fiat/card accounting connects those demonstrations but is not a real crypto-to-fiat conversion or a shared OCBC–Shopify card-network transaction.

Use labels for every external leg. Do not convert a mock, locally generated identifier, registered agent, created cart or unpaid reservation into a completed purchase claim.

## Event constraints

User-supplied BuilderBase materials establish hacking from 6 October 12:00 to 7 October 23:59, Singapore time. Keep the common repository/demo/slides/write-up/evidence package ready; Cardano also requires a video of at most three minutes. Submit main plus justified partner tracks. Full main-track details and any reused-code permission must be checked against the actual submission form; do not invent missing requirements.
