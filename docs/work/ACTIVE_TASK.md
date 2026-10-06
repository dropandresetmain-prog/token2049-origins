# Active task — human orchestration and judge proof

## Verified branch state

- Reviewed PostgreSQL baseline: `build/commerce-core`, `45db8d6a2fd486947b9e6b5045493a849309f326`.
- Implementation base: `build/external-acceptance-hardening`, `3d7f1df7cea845cd04bd98af9f0d6fc94a79c16e`.
- Fetched origin; both exact remote SHAs match; hardening descends from reviewed core.
- All registered worktrees were clean before creation (per-command safe-directory checks where needed).
- Branch/worktree: `build/human-orchestration`, `C:/Dev/token2049-origins/human-orchestration`.
- Main stays at `95a896c730cf893c3afd00919ebe16ad823a608b`; no merge into any base branch.
- Final head and publication guard: `git rev-parse HEAD` must equal `origin/build/human-orchestration`.

## Scope and decisions

Progressive controlled input assessment and drafts; explicit quote-scoped payment choice and persisted
approval; only ready rails selectable; safe independent payer identity; duplicate-safe MCP follow;
human progress and customer/judge proof. Core strict canonical intent/fulfillment, financial math,
recovery, journal and evidence remain intact. No migrations or package dependencies were added.

No Cardano default remains in new purchase creation. Old frozen obligations retain amounts/digests
and recovery; old quotes without option IDs must be requoted for new buys. Approval events prove
channel submission of exact terms/payment choice, not cryptographic human attestation. Source status
means identity/configuration available, not confirmed wallet balance or spend-cap acceptance.

The host agent keeps/merges drafts and asks only for missing fields. It never invents customer data.
Canonical demo fixtures were used only in explicit local verification scripts/tests. Provider discovery
is a controlled schema-path seam, never a provider JSON bag; unmodelled/out-of-phase requests fail safely.

## Completed work

- [x] Verify Git baselines/ancestry/clean worktrees and create isolated branch.
- [x] Canonical `needs_input` with phases, exact controlled paths, human descriptors and no PII echo.
- [x] HTTP 422 and non-error MCP progressive collection; malformed/unknown input remains invalid.
- [x] Quote-scoped funding IDs, required selected option in approval, frozen requirement, approval event.
- [x] Ready-rail filtering/recheck and worker selected-approval guard.
- [x] Protected payer `/status`; offline public identity only, strict response whitelist.
- [x] MCP quote display, source-match preflight and stable quote/option idempotency.
- [x] Owner-scoped quote-purchase lookup; matching repeated approval follows purchase without repayment.
- [x] Human progress, authenticated customer proof and neutral `/proof` page with expandable audit.
- [x] Local contract/MCP/HTTP/proof/payer/financial/concurrency/recovery tests, typecheck/build/smokes/readiness.
- [x] Documentation updated; pinned planning snapshots untouched.

Verification commands/results and exact changed-file manifest are in `docs/evidence/local-verification.md`.
External acceptance remains **NOT_RUN**. No Cardano transaction, Shopify checkout/browser rehearsal,
Atlas/Nuitée/OCBC call, deployment, registration, merge or independent review was run.

## Findings and limits

Act Now gaps (progressive input, silent funding selection, duplicate payer requests, opaque progress/proof)
are resolved locally and require independent review. Accepted limits: proof reads share the bounded
core transaction lock; payer identity is not balance verification; legacy quotes require new quotes.
Stronger human/wallet-session attestation is Park for Later. See `docs/KNOWN_ISSUES.md` for evidence,
affected files, actions and deferral risks. No new unresolved external-acceptance blocker was identified.

Unchanged Investigate Now blockers: Shopify IN-1 hosted-card-frame allowlist/forced click; Atlas IN-2
ambiguous pay.do interpretation; Atlas IN-3 final fee readback/runbook claim. Atlas remains disabled.
Unrelated parked findings, provider integrations, production wallets, Solana, Masumi/Sokosumi,
card funding, treasury rebalancing and branding work remain outside this lane.

## Exact next action — fresh chat

Independent Opus review of the complete `build/human-orchestration` head against reviewed PostgreSQL
baseline `45db8d6a2fd486947b9e6b5045493a849309f326`, covering both inherited financial hardening and this
human-orchestration diff, before any Shopify rehearsal, deployment or real testnet transaction.
Do not start review automatically. Recommend a fresh chat because this implementation context is long;
review model: Claude Opus at high reasoning for independent financial/security and orchestration review.
Authoritative current files: this task, `docs/contracts/CHANNEL_CONTRACT.md`, `docs/KNOWN_ISSUES.md`,
`docs/evidence/local-verification.md`, and `docs/decisions/scaled-testnet-settlement.md`.
