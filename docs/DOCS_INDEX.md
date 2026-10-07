# Capsule documentation index

## Public and judge entry points

| Document | Owns |
| --- | --- |
| [README](../README.md) | Short introduction, public-unavailable status, restricted judge quick-start and navigation. Not an engineering handoff. |
| [PROJECT_SUBMISSION](../PROJECT_SUBMISSION.md) | Problem, solution, user experience, full stack/connections, Main/Cardano/Solana/Chainlink write-ups, selected evidence and submission gaps. |
| [ARCHITECTURE](../ARCHITECTURE.md) | Technical boundaries, lifecycle, funding, providers, persistence, recovery and evidence. |
| [DESIGN](../DESIGN.md) | Approved visual system and console design rules. |

Track judges should use the [Cardano](../PROJECT_SUBMISSION.md#cardano), [Solana](../PROJECT_SUBMISSION.md#solana) and [Chainlink](../PROJECT_SUBMISSION.md#chainlink) anchors. Do not create duplicate per-track narrative documents.

## Engineering and operations

| Document | Purpose |
| --- | --- |
| [Channel contract](contracts/CHANNEL_CONTRACT.md) | Shared HTTP/MCP/channel semantics; executable schemas in [src/contracts](../src/contracts/) win. |
| [Console contract](contracts/CONSOLE_CONTRACT.md) | Read-only UI, authenticated reads and presentation boundaries. |
| [Hosted MCP](channels/hosted-mcp.md) | Hosted OAuth, Cardano payer and provisioning/connection detail. Consult current source for client UI/configuration differences. |
| [FX](FX.md) | Implemented Frankfurter SGD-budget/reference conversion; distinct from execution FX. |
| [Environment](ENVIRONMENT.md) | Runtime and service configuration groups; historical readiness statements need current verification. |
| [Runbook](RUNBOOK.md) | Developer and operator procedures, not judge onboarding. |
| [Test checklist](TEST_CHECKLIST.md) | Verification procedures; an unchecked procedure is not proof. |
| [Decisions](DECISIONS_LOG.md) | Settled decisions and dated integration history. |
| [Known issues](KNOWN_ISSUES.md) | Issue ledger; older UI/deployment/FX status entries can lag code and newer evidence. |
| [Roadmap](ROADMAP.md) | Working backlog, not an implementation or acceptance certificate. |
| [Handoff](HANDOFF.md) | Earlier integration handoff; reconcile its status with newer code and evidence before acting. |
| [Active task](work/ACTIVE_TASK.md) | Branch-scoped work checkpoint and verified next action. |

The root architecture is canonical. The old `docs/architecture/CURRENT_ARCHITECTURE.md` path is only a short compatibility pointer for historical links, not a second architecture source.

## Demo and design references

- [Canonical demo](demo/CANONICAL_DEMO.md) — target narrative; not proof of a completed final run.
- [Seed and preflight policy](demo/SEED_DATA.md) — configuration is not proof of external availability.
- [Demo directory](demo/) — scenario and recording guidance.
- [Approved UI V3](design/ui-v3/) and [brand assets](../assets/brand/) — visual references.
- [Design vocabulary](design/VOCABULARY.md) — user-facing wording.

## Retained evidence

Evidence records keep their original branch/SHA, date, environment and failed/partial outcomes. Never rewrite an old result to make the submission greener.

| Record | What it covers |
| --- | --- |
| [Atlas + Cardano](evidence/atlas-cardano-combined-pass-20261007.md) | Combined historical payment, sandbox ticketing and receipt. |
| [Nuitée + Solana](evidence/nuitee-solana-combined-pass-20261007.md) | Combined historical Devnet payment, sandbox booking and receipt. |
| [Shopify Global](evidence/shopify-global-sandbox-e2e.md) | Append-only discovery/shadow/quote execution history and limits. |
| [Shopify acceptance log](evidence/e2e-acceptance-log.md) | Historical attempts and reconciliation; do not blindly retry old purchases. |
| [Masumi integration](work/MASUMI_INTEGRATION.md) | Native fee/task/payout evidence and separate marketplace boundary. |
| [Render rehearsal](evidence/render-rehearsal.md) | Point-in-time deployment verification, not current health. |
| [Chainlink section](../PROJECT_SUBMISSION.md#chainlink) | Pinned separate-branch workflow and successful simulation; not merged evidence. |

Additional material remains in [evidence](evidence/), [work](work/), [providers](providers/), [contracts](contracts/) and [decisions](decisions/). [Planning](planning/) is historical context; do not silently rewrite it as a current plan.

## Authority and maintenance

Current code/runtime establish implementation. A retained run proves only the path, environment and revision recorded. Root submission prose summarises those sources; it cannot overrule them. Narrative source for slide preparation is PROJECT_SUBMISSION, technical support is ARCHITECTURE, and visual authority is DESIGN.

Update each fact in its owning document, then update links/evidence pointers. Do not expand README into a project essay, copy full incident logs into the submission, merge another lane to make documentation claims true, or describe proposed work as delivered. Recheck branch, current source and this lane's ledger before further edits.
