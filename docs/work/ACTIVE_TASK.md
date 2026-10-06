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


## Current execution checkpoint — 2026-10-06 (supersedes historical next-action text above)

- Active E2E checkout: C:/Dev/t2o-e2e-acceptance, branch build/e2e-acceptance, HEAD/remote 4bdcc75a91b67d21c0438beb8bb61cb8656945b4. Clean on entry, ancestry from 59fc2d5 verified after fetch. Main local/remote remain 95a896c730cf893c3afd00919ebe16ad823a608b.
- User authorized autonomous guided E2E and bounded ordinary fixes, with explicit checkpoints. The previous permalink rehearsal must not be restarted. The current task is Phase 1: real Storefront search/cartCreate/exact quote/checkout, stop before pay.
- Two production attempts completed cartCreate and failed the exact quote guard. Instrumented attempt used one cartCreate, one delivery selection, two same-cart reads: all estimate flags true, explicit tax null, total USD 17.95, subtotal USD 9.95, shipping USD 8.00. No throttle on either attempt; no browser reached.
- Independent US catalog lookup verified Agent Commerce Test Tee variant 50670884094009 at USD 9.95. Both Admin checks found zero new orders; payer processes absent; funding config rejected by rehearsal guard. No gateway purchase, payment or Cardano transaction.
- Changed only rehearsal diagnostics and current evidence/docs. Shopify core financial/quote/payment guards remain unchanged. Working changes uncommitted because the product-decision stop precedes Phase 2 candidate preparation.
- Checks on current source: Shopify 39/39 PASS; strict typecheck PASS; production build PASS; diff check PASS; bounded diff/filename secret scan clean. Prior owner's full suite 487/487 is historical; not rerun here.
- **BLOCKED at product/provider-strategy decision.** Do not ignore estimates/null tax or hardcode 17.95. Exact next action: obtain human approval to add read-only hosted-checkout exact-total observation before quote approval/funding, preserving binding/revalidation and no-pay quote creation. Resume Phase 1 only after that approval. Human Checkpoint A not met; do not deploy/fund/proceed to Phase 2.
- Append-only ledger includes all 27 historical/current records, dedicated seed problems, artifacts and final disposition: docs/evidence/e2e-acceptance-log.md. Sanitized current artifacts: artifacts/e2e/20261006T121900Z-production-diagnostics/.
- Keep same chat for focused resolution. One final Opus reconciliation review is recommended at this terminal stop, in a fresh review chat; no independent review was launched.


## Human Checkpoint A reached — supersedes the earlier product-decision stop

The user approved read-only checkout exact quoting. Implemented and verified the production search/cartCreate/checkout quote path, then a fresh real driver reached REHEARSAL_STOPPED_BEFORE_PAY_CLICK at 2026-10-06 21:01 Singapore. Agent Commerce Test Tee 9.95 + Standard shipping 8.00 + checkout-balanced zero tax = USD 17.95; US/NY address; en-us checkout; checkout.pci.shopifyinc.com frames; Pay now enabled/visible and normal trial actionability passed. No Pay click, payment, order, purchase or Cardano transaction; independent Admin readback 0 new orders. One cart per attempt, no current throttle.

Issue 26 resolved via isolated quote-only browser operation and frozen full breakdown; issue 28 resolved via explicit selected CartDeliveryAddress and strict group/request cross-check; issue 29 fixes sanitized path diagnostics. Modern cart hashes bind selected addresses; legacy hashes/checks preserved. 66/66 focused tests, typecheck/build/diff checks pass. Full ledger and seed dispositions: docs/evidence/e2e-acceptance-log.md. Passing artifacts: artifacts/e2e/20261006T130100Z-selected-address/.

Current changes remain uncommitted on build/e2e-acceptance (base 4bdcc75); no merge/deploy. **Wait for CONTINUE** before Phase 2 candidate preparation/tests/commit/push. Then verify deployed token flow/env names/runtime/market; never assume the short-lived local private token is deployable. Later funding/merge/deploy checkpoints remain mandatory. Same chat is appropriate for Phase 2; final independent review belongs in a fresh chat after final E2E reconciliation.

## Human Checkpoint B — deployable candidate prepared

The user continued from Checkpoint A and authorized Phase 2 validation/commit/push. The complete
candidate passed Shopify 66/66, focused MCP/settlement/safety 102/102, PostgreSQL concurrency/idempotency/
funding recovery 25/25, full suite 514/514 (26 files), strict typecheck, production build/migration copy,
diff checks and bounded secret scan. Full suite counts include the focused subsets. No payment/order.

Render template now targets main, automatic deployment off, Singapore sandbox, existing private DB,
public Storefront auth and receive-only Preprod config. Independent public catalog and Admin token
provenance/scopes verified. Leave private delegate unset; no runtime lifecycle exists for it. Actual
Render env/token/browser/US market/Cardano/MCP readiness remain for Phase 3. Broad provisioning grants
accepted temporarily; SG sellability deferred. All 30 issue records and seed dispositions remain in
docs/evidence/e2e-acceptance-log.md; passing sanitized artifacts in
artifacts/e2e/20261006T130100Z-selected-address/.

Commit and push this completed candidate on build/e2e-acceptance, verify clean local/remote SHA,
then wait for explicit authorization to fast-forward main and deploy that exact SHA (Checkpoint B).
Main remains 95a896c730cf893c3afd00919ebe16ad823a608b; gateway is not deployed. No payer action,
purchase, testnet transaction or merchant order is authorized before later checkpoints. Same chat
remains appropriate for the canonical E2E. Final independent review belongs after full PASS or a
terminal/ambiguous blocker; do not start other project lanes.

## Terminal Shopify-only acceptance stop — supersedes Checkpoint B next action

The user explicitly requested completion of Shopify first with simulated funds. One isolated local
Capsule gateway used the REAL production Shopify executor and TEST-ONLY funding fixture, one fresh
cart/quote/purchase, one worker tick and one normal Bogus Pay submission. No main merge, Render,
Cardano or payer. Exact quote USD 17.95; quote quo_01M48PSSSGY8KG6HYAJEAX9B2B;
purchase pur_01M48PSSTDQDR4VGPAQPC2VRYZ; retained local schema
shopify_accept_cefde6fa7269419080a4509999373a78.

The browser timed out awaiting confirmation after its durable pay_click checkpoint. State unresolved,
one unknown attempt, held_unresolved reservation, one local_fixture funding event, balanced journal,
no provider reference/receipt. Independent Admin currently shows 0 new/bound orders, which is not
not-sent proof. All active writes stopped; worker timer never started and process exited. The pending
reconcile job was not run. Do not rerun the manual harness, Pay, or create a replacement purchase.

Issue 31 Investigate Now/open; ledger has all 31 issues and seed dispositions. Artifacts:
artifacts/e2e/20261006T133500Z-shopify-paid/. Harness tests/manual/shopify-paid-acceptance.ts is outside
production wiring/image and requires an explicit one-order flag. Typecheck and Shopify/browser/webhook
74/74 passed; complete paid receipt/UI checks were NOT reached. Overall verdict UNRESOLVED.

Pause for user direction on READ-ONLY reconciliation of the original checkout. Main remains
95a896c730cf893c3afd00919ebe16ad823a608b; no deployment. Recommend one final independent Opus
review of captured evidence/diff in a fresh review chat; do not launch it or any new project lane.
Keep the same integration chat for reconciliation. Do not fund real Cardano until this original
Shopify outcome and the later deployment/source approval checkpoints are resolved.
