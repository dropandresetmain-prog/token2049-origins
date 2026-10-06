# TOKEN2049 Origins — Commerce Gateway

> Any agent. Agent-native money in. Ordinary commerce out.

A buyer-side commerce gateway. A customer's existing agent submits a purchasing job; the gateway
issues an executable quote, verifies real testnet funding (direct Cardano Preprod x402 first,
Solana Devnet next), reserves treasury capacity in a balanced journal, executes ordinary commerce
through provider sandboxes (Shopify retail, Atlas flights, Nuitée hotels), independently retrieves
the outcome and returns a safe receipt.

Channels (canonical HTTP, thin MCP, ChatGPT, Sokosumi Coworker) all call the same authenticated
core. No channel owns commerce logic, funding truth or journal writes. Payer keys never live in the
gateway process.

## Current state

- Planning release `launch-2026-10-06-v1` imported from
  `dropandresetmain-prog/wip-personal@af648eece01321fec50bcddeee9ba92fd3e10d3a`
  (`token2049-hackathon/`).
- First long-horizon implementation lane (Commerce Core) is in progress on `build/commerce-core`.
- No external acceptance has passed yet. Sandbox/testnet evidence is tracked separately from local
  tests in [`docs/work/ACTIVE_TASK.md`](docs/work/ACTIVE_TASK.md).

## Planning documents

| Document | Owns |
|---|---|
| [IMPLEMENTATION_PLAN.md](docs/planning/IMPLEMENTATION_PLAN.md) | Scope, lanes, checkpoints, acceptance |
| [CORE_CONTRACT.md](docs/planning/CORE_CONTRACT.md) | Channel/core/provider boundary, financial invariants |
| [ARCHITECTURE_DECISIONS.md](docs/planning/ARCHITECTURE_DECISIONS.md) | Founder decisions and engineering corrections |
| [SETUP_AND_EVIDENCE.md](docs/planning/SETUP_AND_EVIDENCE.md) | Configuration groups, readiness, references |
| [NEXT_DISCUSSION_AGENDA.md](docs/planning/NEXT_DISCUSSION_AGENDA.md) | Open launch decisions |
| [Planning README](docs/planning/README.md) | Authority and scope table |

`docs/planning/` is a pinned snapshot. Later planning changes come across through an explicit
reviewed commit; this repository owns execution state.

## Evidence labels

Public-testnet payments are real transactions with valueless test assets. Merchant sandboxes produce
provider-generated test orders/bookings. Internal simulated fiat/card accounting connects them but is
not a real crypto-to-fiat conversion, bank settlement or card-network transaction.
