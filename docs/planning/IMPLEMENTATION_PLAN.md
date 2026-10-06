# Implementation plan — first long-horizon build and integration roadmap

> Historical planning snapshot: persistence alternatives in this source are superseded by the PostgreSQL-only decision in docs/RUNBOOK.md. The original planning text below is retained as history.

Release: `launch-2026-10-06-v1`.
Source baseline: `wip-personal@ae9297fca6c725f3b370ed69f97dcedeaf02b6f9`, subsequent founder decisions in this conversation, attached BuilderBase pages and the Masumi workshop/organizer message.

This is the single execution plan. It authorizes the first core lane in the fresh implementation repository; it does not authorize production spending, a new product direction or silently dropping core integrations.

## 1. Objective and success

Build a channel-independent commerce engine and prove:

`authenticated agent -> executable quote -> real Cardano Preprod funding -> journal/reservation -> provider sandbox purchase -> independently retrieved outcome -> safe receipt`.

Then prove Shopify retail, Atlas flights and Nuitée hotels under the same contract. Publish integration seams so Solana, ChatGPT/MCP, the parallel Masumi/Sokosumi channel and the console can attach without duplicating commerce logic.

A first long-horizon run is expected to occupy much of the first build session, not a guaranteed number of autonomous hours. Continue through all independent work when credentials are missing. The objective is executable, testable software plus evidence, not more planning.

## 2. Scope and ownership

| Lane | Owns | Must not own |
|---|---|---|
| Core lead — first launch | Contracts; core; persistence/journal/jobs; direct Cardano; Shopify/Atlas/Nuitée; OCBC observation adapter; HTTP; thin MCP; bounded payer client; evidence API | Masumi registration internals, Solana implementation owned by another lane, polished console, CRE, exchanges |
| Parallel Masumi/Sokosumi | Coworker standard, registration/listing, task translation, Masumi payment verification integration proposal, its isolated service/config/tests | Core DB/journal, retail/travel implementations, unilateral shared contract changes |
| Solana follow-on/parallel after seam | Devnet payment client/verifier, exact assets, evidence and common funding contract tests | New purchase/state/ledger implementation |
| Client/console lane | ChatGPT connection, other MCP clients, polished evidence console, safe status projections | Payment authorization logic, raw secrets, direct journal mutations |
| Later integration lead | Merge verified lane commits, cross-channel tests, deploy, demo and submission | Unreviewed provider/scope replacement |

Same overall core scope: Shopify + Atlas + Nuitée + direct Cardano + Solana + treasury + secure credentials + separate channels + console. Masumi/Sokosumi is an additional Cardano-priority route, not a pivot.

Chainlink is secondary after the core works. NOWNodes, CDP/exchange rebalancing, Lalamove, supplier credit and a live low-value purchase remain stretch. Alibaba and merchant-account linking/registration are future. Do not implement an open-ended browser-shopping system or external card simulator now; controlled browser completion for the Shopify dev store is in scope.

## 3. First commit — docs before code

Target: `dropandresetmain-prog/token2049-origins`. It was empty at planning inspection; recheck before writing.

1. Inspect local working directory, git status, remote, branch, any existing repository instructions and current remote state. Do not overwrite an initialized repo or someone else's work. Do not build product code inside private `wip-personal`.
2. Fetch the approved planning snapshot through authenticated GitHub/local access. Copy only `token2049-hackathon/*.md` into `docs/planning/`. Do not copy unrelated private planning folders, secret files or third-party project runtimes.
3. Add root `README.md` describing product, current launch state and planning links. Create `docs/work/ACTIVE_TASK.md` (50–150 lines) with goal, source planning SHA, target repo, branch/base, checklist, evidence, current checkpoint and next action. Add minimal `.gitignore` protecting `.env*` except examples, wallet/key files, local data, raw logs/traces and artifacts.
4. First commit contains only planning/working docs, README and safety ignore rules. Suggested message: `docs: establish commerce gateway implementation SSOT`.
5. In an empty repository, make that docs-only root commit on `main` and push. Then create `build/commerce-core` and its dedicated worktree for code. Record branch/base SHA. If remote is already initialized, make the first commit of this run docs-only on a safe task branch; never rewrite history to force a root commit.
6. A missing GitHub login may block push but not local documentation/code work in a verified correct repo. Record it, commit locally and retry at checkpoints; never claim pushed without remote verification.

At the first code checkpoint freeze executable v1 schemas, thin HTTP shape and contract fixtures. Push that commit and publish its SHA. The Masumi lane branches from that shared checkpoint, or starts standalone official-service setup while waiting; it must not invent incompatible core schemas.

## 4. Implementation defaults

These are lean defaults, not pre-existing infrastructure facts. Retain an already-provisioned compatible stack when discovered and record the reason.

- TypeScript strict, a supported installed Node LTS compatible with the selected SDKs, Express, a runtime schema validator and targeted test runner.
- One gateway service. SQLite with a maintained runtime-compatible driver and persisted file is sufficient for one writer/worker; if the local environment already supplies working PostgreSQL and SQLite would require a toolchain detour, choose PostgreSQL once and record it. Do not support both backends for this event.
- Use SQL transactions, unique constraints and a persistent job table. No new Redis, message bus, microservice framework, queue SaaS or general workflow engine.
- Separate payer/signer process or CLI; gateway cannot load payer keys. Provider payment secrets live only in a restricted executor. No general LLM framework in core.
- Unit/contract tests use fixtures; actual proof uses fresh provider/testnet requests. Lock dependencies after checking reference SDK compatibility; do not force a package upgrade across the whole tree just to fix one adapter.
- Windows/ARM may require a compatible runtime or existing WSL; inspect first. Do not spend hours repairing native tooling or introduce a new paid service to work around it.

Proposed locations (create only what is used):

```text
src/contracts/
src/core/                         # quotes, authority, purchases, journal
src/infrastructure/               # config, auth, persistence, jobs, redaction
src/funding/cardano/
src/execution/shopify/
src/execution/atlas/
src/execution/nuitee/
src/banking/ocbc/
src/channels/http/
src/channels/mcp/
clients/payer/                    # separate secrets/process
integrations/masumi/              # parallel lane; not written by core lead
src/funding/solana/               # next/parallel lane
src/evidence/
tests/unit/ tests/contracts/ tests/integration/ tests/e2e/
docs/planning/ docs/work/ docs/evidence/
```

No circular imports: contracts are provider/channel neutral; core consumes ports; composition wires adapters. The public API validates every boundary. Choose identifiers/schemas at checkpoint one; the working contract is specified in `CORE_CONTRACT.md`.

## 5. Credential-independent continuation

Min Htet provisions accounts, access, faucet funding and credentials in parallel. The coding agent owns installable tools, test-wallet generation when authorized, source research, code and preflight scripts. Do not hand routine commands back to the user.

Implement a safe readiness command early. It reports configuration presence, valid environment, network/asset match and a sanitized capability check; never prints values. Keep core startup independent of unconfigured optional routes. Selecting an unready route must fail clearly, not fall back silently.

Use statuses: `MISSING_CONFIG`, `CONFIGURED_UNVERIFIED`, `EXTERNAL_CHECK_PASSED`, `ACCESS_BLOCKED`, `LOCAL_TESTS_ONLY`. Configuration presence is not passing integration.

For every blocker, record integration, exact missing variable/capability, sanitized evidence, last check, human action and next independent task in the active ledger/known issues. Publish one compact blocker update rather than repeatedly asking whether to proceed. Recheck at phase boundaries and when the user signals readiness, not in a busy polling loop.

Allowed while waiting: implement SDK adapters from pinned reference code, schemas, deterministic fixtures, tests, persistence, security, HTTP/MCP, OCBC normalization, evidence API, all commerce adapters, documentation, local run/deployment configuration and clean restart checks.

Do not wait at a Cardano gate while Shopify/Atlas/Nuitée work remains. Do not wait for Shopify keys before building the checkout worker against controlled fixtures. Do not stop after the first minimal happy path when required local implementation remains.

Fixture funding must be test-only: no public production/sandbox “mark funded” route and no deployed fallback that turns missing wallets into synthetic successful payments. Prefer test composition; if an explicit local demo process exists, isolate its storage and prevent it from calling consequential external providers.

When all runnable work is exhausted, produce a checkpoint with exact blocked external acceptance rows, not an invented PASS and not endless activity. Resume from the recorded next command when credentials arrive. “Don't stop” means don't stall on one dependency, not bypass security or fabricate evidence.

## 6. First long-horizon checkpoints

### Checkpoint: contract and runnable skeleton

- Complete docs-only commit, safety defaults and v1 contract schemas/tests.
- Implement authenticated routes, capabilities/readiness, one consistent error shape and integer-safe money.
- Introduce persistent purchases, quotes, journal/event IDs and durable execution jobs.
- Publish shared contract commit for parallel lane.

Exit evidence: clean install/build/typecheck; health/readiness without external keys; unauthorized access and bad inputs fail; snapshot/contract tests pass. Commit/push only exact files changed.

### Checkpoint: treasury and local commerce spine

- Immutable quote, scoped authority, purchase/funding/commerce states kept distinct.
- Transactional reservations and balanced per-asset journal, explicit simulated fiat capacity.
- Job claims, idempotent client/provider operations and restart reconciliation.
- Deterministic hotel, retail and flight fixtures behind the same executor contract.

Exit evidence: no funding/no authority cannot buy; duplicate/concurrent requests cannot duplicate orders/journals; unknown outcome stays unresolved; insufficient capacity and changed quote/terms fail safely; restart test preserves state. This is local correctness evidence, not an external demo.

### Checkpoint: provider routes, with Shopify risk tested early

Start these bounded tasks after the shared contract exists; do not postpone Shopify investigation until the end.

**Nuitée:** inspect existing source for API semantics; implement search/rates -> prebook/requote -> book -> retrieve. Verify payment mechanism and whether confirmed booking is paid/guaranteed under the sandbox contract. Use synthetic traveller data. Missing keys block fresh booking evidence only.

**Shopify:** investigate authenticated Checkout MCP/UCP capabilities on the actual dev store. Prefer supported programmatic completion; if it escalates, implement isolated controlled-browser checkout using merchant test-payment inputs. Query order/payment state or verify signed webhooks/readback. `continue_url`, an unpaid order or Admin mark-as-paid does not satisfy acceptance. Keep buyer and seller-admin capabilities separate. No CAPTCHA/OTP bypass and no real card data.

**Atlas:** inspect actual provider client/types and create/pay/retrieve semantics, preserving quote/session validity and passenger requirements. Audit test-balance-only limitation before copying any behavior. A hold is not a ticket. Verify the permitted sandbox payment mechanism; do not reintroduce supplier credit by default. Keep the unresolved payment-path row visible until verified/approved.

**OCBC:** implement only proven account/card observations with timestamps, masking and environment. Keep observed values separate from simulated capacity. Source access or missing secrets must not block the three executors. No invented issuance, card authorization, debit or webhook.

Exit evidence: each adapter has contract tests and sanitized source/protocol notes; each configured provider gets one fresh sandbox lifecycle. Every unverified provider remains explicitly blocked, not demoted.

### Checkpoint: real direct Cardano funding

- Inspect and pin the official x402 reference implementation; prove supported scheme, network ID, headers, asset policy/name/decimals, payer/treasury roles and confirmation semantics.
- Generate/load dedicated test keys safely; use correct faucet-funded tADA and test stablecoin. Verify token identity, not symbol alone.
- Use reference transaction verification plus quote/actor/resource binding, payee/amount checks and consumed-proof protection.
- Verify whether middleware settles before or after the handler. The protected handler may register a pending job; it must not trigger a purchase before confirmed funding. The worker executes only after verified evidence is persisted.
- Correlate actual chain transfer to the purchase; validate sufficient full quote funding, gas and recipient requirements.

Exit evidence: actual Preprod transfer and independent confirmation -> exactly one fresh provider sandbox purchase -> retrieve outcome -> safe receipt with chain and provider references. Test invalid/replayed/expired funding rejection. If wallets are still unavailable, finish the adapter and all remaining independent work; external acceptance remains blocked.

### Checkpoint: all core commerce and integration surface

- Bring all three executors through the same durable purchase contract.
- Finalize thin MCP tools and payment-aware payer client, leaving ChatGPT connection/configuration to its channel lane where necessary.
- Publish redacted evidence endpoints; a small inspection page is acceptable without taking over the polished console lane.
- Provide per-process environment examples, run commands, focused test commands and deployment configuration with persistent storage.
- Add contract fixtures/examples for the Masumi lane, including fee-only evidence that must not fund a purchase.

Exit evidence: HTTP and MCP contract conformance; readiness states accurately reflect external checks; receipts and browser/log traces pass secret/PII redaction; local service restarts without lost orders. First lane aims for fresh funded flows across Shopify, Atlas and Nuitée. Do not claim first-lane PASS if any required external proof is still missing.

### Checkpoint: independent review and handoff

Use bounded review workers for authorization/funding, journal/idempotency and provider/evidence semantics. Primary lead integrates findings. Classify every issue as **Act Now**, **Investigate Now**, **Park for Later**, or **Ignore / Accept Risk**, with evidence and resolution.

Run focused checks after edits, broader repository checks only at meaningful integration/final checkpoints. Do not rerun every external booking or full suite on every change. No paid build service unless actually needed and authorized.

Commit/push, then reconcile `ACTIVE_TASK.md`, actual git diff, source plan, tests and external evidence. Update only materially affected `README.md`, `PROJECT_FILE_MAP.md`, `TEST_CHECKLIST.md`, `KNOWN_ISSUES.md` and `HANDOFF.md`; create these when useful, not mechanically as duplicate plans.

## 7. Parallel Masumi/Sokosumi lane

Create an isolated worktree/branch `build/masumi-coworker` from the published contract checkpoint. The core agent does not implement this lane in the same worktree or run a second architect over shared files.

Its first deliverables are a current-standard compliance check, runtime/service setup, sanitized token/network configuration, registration/listing steps and a runnable task wrapper. Use official starter/service code where permitted and disclose it. A public listing requires user-approved publication/metadata; prepare everything while access is being provisioned.

Integrate only through authenticated core operations. The lane owns task-ID correlation and its private provider SDK; the core owns spending policy and journal. Keep payment principal, fees and escrow commitments separate.

Gate to resolve: the workshop shows work/result before escrow funding. Prove dynamic principal + fee, pre-execution payment/escrow verification, and release timing. If that cannot be supported, preserve direct purchase funding and treat Masumi task remuneration separately, with transparent UX and no double charge. Escalate the business decision rather than silently fronting unfunded purchases.

Integration acceptance: listed and runnable on Preprod; a real task reaches the existing core; authenticated callback/readback; independently verified funding semantics; fresh sandbox result returned to task; no duplicate ledger or provider code. A successful standalone fixture task is not the purchasing demo.

## 8. Subsequent launch lanes and event pacing

After contract publication, provider reconnaissance, signer research and channel scaffolding may run in parallel. Core architecture, database schema, financial semantics, root lockfile and final verification stay with the lead. Bound worker counts to avoid spending Min Htet's attention on coordination.

Solana remains required overall: real Devnet payer/treasury, native fee funds and correct test stablecoin; same funding contract and a tested multi-rail x402 challenge. Do not advertise an unimplemented rail. Preserve exact scheme/network compatibility and independent funding verification.

The console/client lane connects ChatGPT plus a second client as practical, supplies a polished result/timeline surface and keeps raw secrets inaccessible. Masumi integration does not replace this lane.

Chainlink can verify provider results only if it adds a real responsibility after core. Clearly distinguish local simulation from a deployed decentralized workflow; do not claim independent trust from a local script or our own proxy alone. NOWNodes stays last.

Suggested coordination targets, not permission to cut scope:
- 6 Oct afternoon: docs/contracts, parallel access spikes and first core vertical slice.
- 6 Oct evening/night: funded provider paths, persistent state, all three core adapters; parallel Masumi registration/runtime and Solana work as lanes become available.
- 7 Oct morning: integrate channels, second rail and console; rehearse and repair.
- 7 Oct 14:00: target feature freeze and capture working evidence/video; no unapproved scope cuts to hit this target.
- 7 Oct 20:00–22:00: target submissions with contingency before the fixed 23:59 cutoff.

Elapsed-time estimates must be recalculated at launch. Do not silently spend the final hours on a new exchange/provider instead of core/demo evidence.

## 9. Completion matrix

Track **local implementation** and **external acceptance** separately per row. Record exact commit, command, status, source reference and environment. Use `PASS`, `FAIL`, `BLOCKED_EXTERNAL`, `NOT_RUN`; blocked/skip is never green.

| Required row | Acceptance |
|---|---|
| Docs and contracts | Docs-only first commit; source SHA; shared schemas; boundary tests |
| Treasury | Balanced journal, capacity reservations, idempotency, durable recovery; no invented bank debits |
| Cardano | Fresh Preprod principal transfer actually gates provider execution |
| Shopify | Actual buyer test checkout/payment plus independent paid order readback |
| Nuitée | Fresh sandbox booking and provider-specific payment/booking readback |
| Atlas | Fresh sandbox create/pay/retrieve using verified permitted mechanism; status accurately identifies hold/payment/ticket |
| Security | No authority bypass, cross-user access, SSRF or model-visible credentials |
| API/MCP | Common contract and payment-aware client behavior, not a fake chat transcript |
| Evidence | Fresh external references, environment labels, safe receipts and local-fixture separation |
| Remote checkpoint | Verified commit/branch and focused handoff; no claim about unpushed work |

First-lane completion does not claim the separately owned Solana, live Sokosumi listing or polished frontend is done. Overall hackathon completion additionally requires those core/track rows, deployment/access checks, demo/video/slides/write-up and submission confirmation.

## 10. Operating memory and reporting

Maintain `docs/work/ACTIVE_TASK.md` at roughly 50–150 lines. Reread before phases, after compaction, after subagent results and before completion. Keep raw logs local/ignored and publish compact sanitized evidence. Check items off only after the stated tests pass.

Workers return only finding, affected files, recommended action and evidence. Record architecture questions centrally. Use a separate lane-specific ledger in the Masumi worktree so concurrent agents do not fight over one live file.

At every meaningful checkpoint: inspect diff, run relevant tests, stage explicit paths, commit and push the task branch, verify remote, update next action and keep going. No `git add .`, destructive resets, force pushes, speculative purchases or edits to unrelated repositories.

Final report: branch/base/head and first-docs commit, files/behavior changed, commands and pass/fail evidence, per-provider external readiness, open risks with triage, exact next action, and merge handoff for the parallel lane. Never report “complete” based solely on mocks.
