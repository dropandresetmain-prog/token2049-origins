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

The human flow is progressive: collect missing information, find offers, show an exact quote,
explicitly select an available funding option, approve those terms and payment choice, then follow
one durable purchase. No Cardano choice is inferred. [Channel contract](docs/contracts/CHANNEL_CONTRACT.md)
documents `needs_input`, approval and duplicate behavior. `/proof` shows the customer timeline,
payment and receipt; `/inspect` retains detailed engineering evidence.

## Current state

- Planning release `launch-2026-10-06-v1` imported from
  `dropandresetmain-prog/wip-personal@af648eece01321fec50bcddeee9ba92fd3e10d3a`
  (`token2049-hackathon/`).
- Commerce Core local implementation is complete on `build/commerce-core`. `build/human-orchestration` builds on the isolated external-acceptance-hardening branch; the combined diff requires independent review against the reviewed PostgreSQL baseline before external acceptance.
- Runtime and acceptance instructions: [RUNBOOK](docs/RUNBOOK.md), [TEST_CHECKLIST](docs/TEST_CHECKLIST.md), [KNOWN_ISSUES](docs/KNOWN_ISSUES.md), [HANDOFF](docs/HANDOFF.md).
- No external acceptance has passed yet. Sandbox/testnet evidence is tracked separately from local
  tests in [`docs/work/ACTIVE_TASK.md`](docs/work/ACTIVE_TASK.md).

## Database contract

Local development and automated integration tests use PostgreSQL.
Hosted runtime uses Render PostgreSQL.
SQLite is not supported.

Use Node 24+, Docker Desktop and the official Postgres 18 Compose service:

```powershell
npm ci
docker compose up -d --wait
$env:DATABASE_URL = 'postgresql://origins:origins_local_only@127.0.0.1:55432/origins'
npm run db:migrate
npm run typecheck
npm run build
npm test
node dist/scripts/db-smoke.js
```

Tests use a random isolated schema per fixture, with explicit reuse for restart tests and
cleanup of owned schemas only. A test PostgreSQL outage fails the suite. There is no database fallback.
See the [runbook](docs/RUNBOOK.md) for stop/reset, migration and Render operations.
The Render gateway configuration is prepared in `render.yaml`; it has **not** been deployed.

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

## Demo settlement policy

The hackathon demo uses a disclosed **1:1000 notional scale** for public-testnet stablecoins:
USD 183.40 commercial principal -> 0.183400 tUSDM on Cardano Preprod (183,400 base units at 6 decimals).
These test assets have no real-world value. This is a testnet notional scale, not an FX rate.
The chain transfer demonstrates payment authorization, amount binding, transaction settlement,
purchase gating and reconciliation. It does not prove USD redemption, crypto-to-fiat conversion,
Visa settlement, bank settlement or equivalent economic value. Provider sandbox commerce continues
at its full commercial test amount. SERVICE_FEE_BPS remains 0 by default; a configured non-zero fee
uses the same scale as principal.

Canonical secret-free scenario data: [demo/demo-data.json](demo/demo-data.json), validated by
[src/demo/config.ts](src/demo/config.ts). Runtime endpoints, secrets, exact asset identities,
protocol constants and independent signer/security caps remain runtime configuration or code.
See [current settlement decision](docs/decisions/scaled-testnet-settlement.md).
