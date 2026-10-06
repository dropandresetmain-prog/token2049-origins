# Capsule documentation index

This index separates current sources of truth from historical plans and evidence.

## Current sources of truth

Read these first for new work:

| Document | Authority |
| --- | --- |
| README.md | Product summary and current implementation baseline |
| docs/HANDOFF.md | Complete current handoff |
| docs/DECISIONS_LOG.md | Settled current decisions |
| docs/ROADMAP.md | Remaining work and priority order |
| docs/ENVIRONMENT.md | Runtime, external services and config groups |
| docs/architecture/CURRENT_ARCHITECTURE.md | Current architecture and boundaries |
| docs/demo/CANONICAL_DEMO.md | Target judge demo |
| docs/demo/SEED_DATA.md | Demo seed/preflight policy |
| docs/KNOWN_ISSUES.md | Current issue triage |
| docs/RUNBOOK.md | Operational procedures |
| docs/TEST_CHECKLIST.md | Current gates |
| docs/contracts/CHANNEL_CONTRACT.md | Executable channel/core contract summary |
| docs/work/ACTIVE_TASK.md | Working-memory checkpoint |

Runtime/code remains authoritative when docs disagree.

## Product/design authority

- DESIGN.md — approved Capsule UI rules.
- docs/design/ui-v3/ — approved V3 visual reference.
- assets/brand/ — approved logo assets.

V2 is retained only as design history.

## Current decision records

- docs/decisions/scaled-testnet-settlement.md
- docs/decisions/shopify-real-discovery-sandbox-execution.md
- docs/DECISIONS_LOG.md

## Historical planning snapshots

docs/planning/ is the launch planning snapshot imported before implementation. It is historical context, not the current execution plan. Do not silently edit it to match later implementation decisions.

## Evidence and lane history

docs/evidence/ and docs/work/*_FIX.md / COMPLETED_LANES.md preserve what actually happened in earlier lanes. Do not rewrite failed or partial evidence to make the project look greener.

Important retained evidence:
- pre-masumi-integration.md — exact verification of main baseline before promotion.
- e2e-acceptance-log.md — append-only Shopify E2E issue history.
- shopify-global-sandbox-e2e.md — live Global Catalog/shadow evidence.
- cardano-protocol.md — Cardano funding design/evidence.
- CARDANO_FIX.md / SOLANA_FIX.md / SOLANA_LIVE.json — rail-specific evidence.
- COMPLETED_LANES.md — crypto/provider consolidation source report.

## Rule for future agents

Before major work:
1. inspect current main and recent commits;
2. read ACTIVE_TASK, ROADMAP, KNOWN_ISSUES and the relevant current decision/architecture docs;
3. use historical evidence only to understand what was actually tested;
4. never infer external PASS from local fixtures;
5. update current docs after meaningful verified integration; preserve historical evidence.
