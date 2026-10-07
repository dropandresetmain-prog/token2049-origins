# Active task — submission documentation reorganisation

## Goal and authority

Deliver a reviewable documentation-only branch for Min Htet.
README is the public front door and restricted judge quick-start.
PROJECT_SUBMISSION owns the story, full stack, and Main/Cardano/Solana/Chainlink sections.
ARCHITECTURE owns technical design. DESIGN remains the visual authority.
No separate partner-track write-ups and no slides are produced in this lane.

## Branch and baseline

- Repository: `dropandresetmain-prog/token2049-origins`.
- Branch: `docs/submission-reorganisation`.
- Source/base SHA: `5343235ebe6c341abdda95450065950a3d1051b7`.
- Base tree: `c23b9a82087aae5d09c5540e76841cea425dab95`.
- Branch created from that exact remote main commit; no local runtime checkout is assumed.
- Writes use GitHub's file/Git APIs and exact paths, never main.
- The previous release ledger remains available in Git history at the base SHA.

## User decisions

- Capsule is not available for general public use.
- Judges use MCP; the console shows transaction progress and proof.
- README links to all documentation and directly to partner sections.
- Include all actual connections, including Frankfurter, with their roles.
- Chainlink is an intended submission, not an optional omitted section.
- Do not confuse intended entry with proven integration or qualification.
- Rename/supersede CURRENT_ARCHITECTURE with root ARCHITECTURE.
- Preserve engineering evidence and historical planning.
- Min Htet reviews before approval, integration or slide production.

## Required outcomes

- [x] Verify remote repository, main SHA and isolated branch.
- [ ] Inspect current docs, executable contracts, integrations and recent commits.
- [ ] Reconcile supplied BuilderBase material; retain ambiguities explicitly.
- [ ] Write concise README with status, judge access steps and document routing.
- [ ] Write PROJECT_SUBMISSION with shared story, stack and all entered tracks.
- [ ] Write root ARCHITECTURE against inspected source.
- [ ] Update current documentation navigation and architecture references.
- [ ] Preserve historical evidence; avoid two authoritative architecture documents.
- [ ] Verify changed Markdown links, anchors and exact path scope.
- [ ] Review secrets, evidence provenance, draft markers and qualification claims.
- [ ] Checkpoint final files on this branch and verify remote ancestry/diff.
- [ ] Report missing information and a denominator-based completion estimate.

## Inspection findings to reconcile

- README/HANDOFF/old architecture describe an earlier integration baseline.
- Current main includes hosted MCP, console and later demo-profile changes.
- `feat/chainlink-cre` exists at `2695d6bd1110de4effa56e1b6e21232700025454`.
- That branch is 2 commits ahead and 29 behind the docs base; it is not integrated.
- Inspect its workflow/evidence without merging it or claiming it is on main.
- Repository visibility is private; judge access/open-source wording must be resolved.
- Credentials and private access material must not be copied into Markdown.

## Constraints

No runtime changes, schema changes, provider calls, spending or deployments.
No main merge, branch promotion, visibility change or external submission.
No repo-wide test suite, production build, browser E2E or cloud job.
Never relabel fixtures as fresh provider/chain evidence.
Never claim an unverified final candidate, live access or fresh-work compliance passed.
Use source links for requirements and implementation claims.
Any historical compatibility pointer must contain no duplicate architecture.

## Verification plan

Check only changed documentation and its directly affected navigation.
Use exact blob hashes and the remote compare result for write verification.
Keep local Markdown checks/report outside the application runtime.
Record what was and was not run; completed checkboxes require evidence.

## Current checkpoint

Planning checkpoint: isolated branch created; source investigation in progress.

## Next action

Finish source/evidence inspection, then draft the three entry-point documents.
Re-read this ledger before writing and before final handback.
