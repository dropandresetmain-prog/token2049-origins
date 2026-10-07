# Active task — judge-facing narrative rewrite

## Goal

Rewrite README, PROJECT_SUBMISSION and ARCHITECTURE after founder feedback.
The documents pitch Capsule to judges; they are not internal release audits.
The macro thesis is buyer-side infrastructure connecting agents and Web3 funding
with existing Web2 commerce. Travel and retail scenarios are illustrations.

## Branch and source

- Repository: `dropandresetmain-prog/token2049-origins`.
- Branch: `docs/submission-reorganisation`.
- Rewrite parent: `84d7a786222c17d7a6b5165ec8374b3aebf45857`.
- Original branch base: `5343235ebe6c341abdda95450065950a3d1051b7`.
- Remote main inspected: `2833c79b0d423cf58fe28142d27bdc510a9bb0a0`.
- Main is one commit beyond the branch base; only console copy/model/tests changed.
- CRE source/evidence: `2695d6bd1110de4effa56e1b6e21232700025454`.
- CRE source branch is unchanged. Remote integration/partner-lanes-final returned 404.
- Do not assume unpushed candidate work is integrated or deployed.
- Writes use exact GitHub API paths. No application worktree is assumed.

## Editorial decisions

- README stays short: macro introduction, restricted judge access, MCP, console, links.
- PROJECT_SUBMISSION is a written pitch, including all three partner sections.
- ARCHITECTURE explains design decisions and transaction flow in connected prose.
- Explain why agentic commerce is timely using named, primary-source developments.
- Attribute ecosystem strengths through concrete technology and product roles.
- Keep source links beside claims and results; retain meaningful environment facts.
- Remove prizes, judging weights, SHA narration, audit labels and task lists from root prose.
- Keep unresolved release/compliance questions here, not in judge-facing narrative.
- No new per-track narrative documents. DESIGN and historical evidence are untouched.

## Required outcomes

- [x] Read previous drafts and verify their local blobs match the remote checkpoint.
- [x] Read the task ledger and recheck docs branch, main and CRE source heads.
- [x] Inspect the main-to-base diff to identify source changes relevant to the rewrite.
- [x] Research agentic-commerce developments in official OpenAI, Google/Shopify and Visa sources.
- [x] Check official Cardano, Solana and CRE descriptions for partner framing.
- [x] Draft the written pitch around the approved macro thesis.
- [x] Rewrite README and ARCHITECTURE with their distinct audiences and purposes.
- [x] Update documentation routing without creating extra public narrative files.
- [x] Verify Markdown links/anchors, scope, source fidelity and secret patterns.
- [x] Commit rewritten documents and verify the remote diff and blobs.
- [x] Prepare Markdown copies and a readable HTML review copy.
- [x] Add explicit Cardano, Solana and Chainlink requirement-to-evidence tables.
- [x] Add Coinbase CDP operational-treasury proof and OCBC/manual-reconciliation story.
- [x] Update ARCHITECTURE to separate customer funding, operational crypto treasury and fiat observation.
- [ ] Founder approval of the new track/treasury update; no automatic merge or slide production.

## Sources supporting the market narrative

- OpenAI: buy-it-in-chatgpt, 29 September 2025 (ACP with Stripe).
- Google: agentic-commerce-ai-tools-protocol-retailers-platforms, 11 January 2026 (UCP with Shopify and others).
- Visa: Intelligent Commerce Connect announcement, 8 April 2026.
- Official Cardano developer portal: x402 and Masumi capabilities.
- Official Solana payments documentation: payment design and fee sponsorship.
- Official Chainlink CRE documentation: workflow orchestration.
- User-supplied Coinbase CDP proof-closure evidence: `c74ff8b`, `docs/work/COINBASE_CDP.md`, `docs/evidence/coinbase-cdp/server-wallet-proof.json`; Base Sepolia Server Wallet transfer executed with official `cdp` CLI and independently read back.
- Sources are linked in the pitch. No invented market size, adoption percentage or benchmark.

## Internal release inputs retained from the earlier draft

| Classification | Item | Effect |
| --- | --- | --- |
| Investigate Now | Confirm destination for a Get judge access link; the README currently tells judges to ask the Capsule team. Deliver consent code and matching console key privately. | Access handoff not final. |
| Investigate Now | Confirm unassisted Solana evaluation path. Inspected hosted MCP uses Cardano; Solana completed run uses supplied payer/facilitator. | Final judge onboarding. |
| Act Now | Supply final deck Drive link, embedded recording and Cardano video at most 3 minutes. Media production remains a separate approved lane. | Final submission assets. |
| Investigate Now | Reconcile CRE with final candidate and core-product qualification. Simulation is valid evidence; documented run uses retained Capsule proof plus fresh Koios data. | Final integration and entry review. |
| Investigate Now | Reconcile the user-supplied CDP proof-closure lane into the final candidate. The connector currently exposes the older `feat/coinbase-cdp-treasury` lane but not `feat/cdp-proof-closure` / `c74ff8b`; treat the supplied proof details as the source for this narrative update until the final integration branch exposes the files. | Final evidence-link integrity; not a reason to weaken or invent the CDP result. |
| Investigate Now | Obtain founder build/reuse declaration, resolve Cardano open-source/private-access wording, confirm deadline timezone and .pptx acceptance if used. | Submission compliance. |
| Ignore / Accept Risk | Prototype uses public testnets and provider sandboxes; no commercial off-ramp is demonstrated. State the implementation directly, once where relevant. | Environment clarity. |
| Park for Later | Public onboarding, production conversion/settlement partnerships and expanded execution capacity. | Forward-looking product direction, not delivered features. |

## Constraints

Documentation changes only. No provider/payment calls, deployment, schema changes,
credential publication, visibility changes, main merge, or application build/test run.
Do not create an access URL or publish an email/credential without an approved target.
Do not infer production merchant settlement from the testnet notional scale.
Preserve historical evidence and the existing architecture compatibility pointer.

## Checkpoint

Founder-approved narrative remains intact. Content update commit `13fc6f4a448d18d765972ca9d8d067df1681a94a` adds:
- track requirement-to-evidence tables for Cardano, Solana and Chainlink;
- Coinbase CDP Server Wallet operational-treasury story and proof matrix;
- OCBC + CDP manual fiat/crypto reconciliation framing;
- architecture separation between customer purchase funding, operational treasury and fiat observation;
- direct treasury navigation from README and updated documentation index.

No application code, provider/payment call, deployment, schema, credential, repository visibility or main branch changed. The proof-closure branch/commit supplied by the founder was not visible through the current GitHub connector; the public docs therefore reference its evidence paths and provenance as supplied, without copying or fabricating the missing raw file.

## Next action

Return the updated submission docs for founder review. If approved, integrate them with the final candidate alongside the CRE and Coinbase CDP evidence lanes, then hand the approved narrative plus demo footage and DESIGN.md to the deck-production lane. Do not merge automatically.
