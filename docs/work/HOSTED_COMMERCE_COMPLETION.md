# Hosted commerce completion checkpoint

Candidate branch: `feat/hosted-commerce-completion`

Base: `ca5519ac6abb134b81f5cc194657a55718ec4701` (`review/final-astra`)

Validated code checkpoint: `e1029a4e7873001d4f23fd234225013e61c3f79a`

Worktree: `C:/Dev/t2o-wt-hosted-commerce-completion`

Final documentation commit SHA is printed in the completion message and resolves with `git rev-parse HEAD`.

**Safe to integrate on top of the Astra candidate: YES. Safe to deploy: NO.**
No merge, push, deployment, real Solana import/retirement, booking, provider payment or chain transfer was performed. The shared checkout and historical E2E evidence were not changed.

## Outcome and evidence boundaries

| Lane | Status | Candidate result | Live evidence / remaining acceptance |
|---|---|---|---|
| Atlas | PARTIAL | Hosted provisioning/manifest enable the proven sandbox gate. Exact sandbox host, zero-fee, checkpoint, single-pay and reconciliation guards are retained. | Live gateway remains on main with the gate false. Candidate code using hosted provider configuration returned executable readiness, 5 offers and a saved-profile quote. Public deployed MCP executable quote/funding options await deployment. |
| Nuitee | PARTIAL | Trace found no artificial hosted restriction; provider code was left unchanged. Sandbox/prebook/price/readback checks remain. | Hosted sandbox configuration with candidate code returned executable readiness, 10 offers and a saved-profile quote. Exact public MCP quote acceptance was not rerun. |
| Cardano cold start | PARTIAL | One bounded generic status recovery replaces fire-and-forget wake. Simulated transient 503 on both rails recovers within the same background quote operation. No payment retry changes. | Live Cardano status connected in 33219 ms without a separate health warm-up. A genuine cold/restarting state was not established; the historical fast failure's root cause is still unclassified. |
| Hosted Solana | PARTIAL | Free public HTTPS/bearer service, PostgreSQL payer and sponsor histories, internal sponsor, immutable imports/retirement, independent gateway finality verification all tested locally. | No public service deployment, real PostgreSQL import, hosted readiness or funding proof. Existing reservations, key ACLs, absent current policy and unavailable balances block operational acceptance. |

No-spend provider evidence is [no-spend-probes.json](../evidence/hosted-commerce-completion/no-spend-probes.json). It uses the saved profile and records no order/payment/booking. These are local candidate/provider probes with hosted configuration, not newly deployed hosted MCP acceptance. Historical Atlas+Cardano and Nuitee+Solana commerce E2Es were preserved and not repeated.

| Hosted MCP property | Local integration | Current live evidence |
|---|---|---|
| Cardano visible/connected | YES | YES, read-only payer status |
| Solana visible/connected | YES | NO hosted payer proof |
| Both simultaneously | YES, same quote operation | NO |
| Explicit fundingOptionId, no default/fallback | YES | Existing generic flow preserved; new deployment not tested |

## Behavior and safety

- Atlas enablement changes deployment configuration only. The provider executor's proven safety rules are unchanged. No Nuitee code change was necessary.
- Both rails use the same BridgeClient. Safe diagnostics classify fetch/connect, timeout, HTTP, invalid JSON, schema, missing source, rail mismatch and success. Concurrent status probes coalesce. Only classified transient failures permit one awaited health request and at most two short status retries inside the original budget. Authentication/schema/rail errors do not recover; /pay is never retried by readiness.
- The smoke uses `fulfillment: { category: 'retail' }` and Singapore shipping. Optional direct payer probes follow MCP calls, preventing them from pre-warming the flow being tested.
- Solana exposes only health, authenticated status and purchaseId-only pay through the existing hardened hosted bridge. Keys stay in the separate payer. There is no public sponsor/prepare route, persistent disk or hosted canonical file ledger.
- Payer spend and sponsor fees are durably reserved before their respective signatures. Immutable PostgreSQL facts and advisory locks prevent concurrent signing. A missing signed candidate requires reconciliation; a persisted fully signed candidate is reused exactly, including after response loss/restart. Broadcast never calls SDK settlement that signs again.
- The gateway's explicit payer_broadcast mode signs nothing and verifies finalized transaction bytes, purchase/quote memo, source debit and destination credit independently. Local legacy facilitator mode still requires its explicit URL/token.
- Both histories import atomically with identity, network, mint, raw source hash, entry count, exact references/fields and committed totals. First import independently scans finalized chain history. Reruns require exact markers and original entries. Startup never creates an empty ledger for the real identities.
- Approved retirement must acquire both permanent locks before writing retirement markers. Locks remain so older signers also refuse signing. Originals are unchanged at this checkpoint.
- Provisioning defaults to read-only, reuses existing Render credentials/PostgreSQL, requests only a free public Docker web service, preserves Cardano configuration and refuses paid/private/disk services. Apply may trigger a deploy and is reserved for final approval.

## Protected Solana state before any funding proof

Read-only state is recorded in [solana-protected-state.json](../evidence/hosted-commerce-completion/solana-protected-state.json).

| Item | Observed state |
|---|---|
| Payer | `5iSWoZSucVSaNjtxeVC5TCJTN1RQBC6nScw8P32X5MZ6` |
| Sponsor / treasury owner | `6QdrzAxbQMZGCSuk2R9ddneHum22VUJdabDM56ZAr6EU` |
| Payer history | 7 entries, 94220 base units committed, including two unsigned 1050 reservations |
| Payer source SHA-256 | `19483c72bfed83abb04fd3bedaf569e0eb33d1806424ac14cb83066122808664` |
| Sponsor history | 6 entries, 25002 fee lamports committed |
| Sponsor source SHA-256 | `1966603b4d08fdfc7f8776f3040346b928c2e94694c5259ab394ac129356f9d4` |
| Real hosted PostgreSQL import | NOT PERFORMED |
| Current caps / authorized headroom | Missing/blank; no current spending policy established |
| Historical cumulative cap / arithmetic headroom | 102000 / 7780; historical figures only, not reauthorized |
| Current balances | UNAVAILABLE from the read-only probe; must be verified before spending |
| Key access controls | Both original files have broad inherited access; apply refuses them |
| Legacy retirement | NOT PERFORMED; no lock/retired markers in originals |
| Exact intended funding amount | NONE; no spend authorized or attempted |

Do not run setup against the missing main-checkout ledger directory. The canonical histories are under the older solana-funding worktree. Do not reset their liabilities or infer a fresh budget.

## Verification

Focused checks passed across providers, existing/new provisioning, generic readiness, dual rails, PostgreSQL import/conflicts/retirement, single-sign sponsor behavior, immutable payment restart behavior and actual hosted service routes. The final focused Solana run passed 33 tests; permission/smoke/transient checks passed 6 tests (47 excluded by the focused name filter).

| Required final gate | Result |
|---|---|
| npm run typecheck | PASS after correcting only integration-fixture tuple/Map typing; failed gate rechecked |
| npm run build | PASS, gateway console artifact included |
| npm run console:typecheck | PASS |
| npm run console:test | PASS, 9 files / 87 tests |
| npm test | Initial run: 73 files passed, 1210 tests passed; one stale migration-count assertion failed (7 vs 8). Corrected assertion and affected service/PostgreSQL suites: 2 files / 12 tests PASS. Full suite was not repeated. |
| git diff --check against base | PASS after trimming two trailing test blank lines |
| Migration ordering/checksums | PASS: contiguous 0001-0008; 0001-0007 byte-identical to authoritative base |
| New migration SHA-256 | `f38ced5ee67552e250ad2072fd65a37f84b896ca94ab66871b5a94259f8541da` |
| Bounded secret scan | PASS across changed candidate files; no new credentials/private-key blocks/64-byte key arrays or env files. One exact pre-existing synthetic Render test token was verified against base and excluded. Pattern scan is not a comprehensive secret audit. |
| Ancestry / status | Authoritative base is an ancestor; isolated branch checkpointed; final completion message records clean status/SHA |

Final gate logs are ignored local files under `.runtime/final-*.log`. Only failing/affected checks were rechecked. There are no new package dependencies or lockfile changes. Source service integration uses real isolated PostgreSQL plus generated test signers/fake RPC; it does not prove Render container/secret mounting, RPC availability, genuinely cold startup or on-chain spending.

## Files changed

- Solana runtime: `clients/solana/{config,hosted,hosted-sponsor,ledger,ledger-port,ledger-import,pg-ledger,pay,policy,signer}.ts`.
- Gateway/shared MCP: `src/funding/solana/{adapter,config}.ts`, `src/channels/hosted-mcp/config.ts`, `src/channels/mcp/{bridge,tools}.ts`, `src/migrations/0008_hosted_solana_ledger.sql`.
- Packaging/provisioning: `Dockerfile.solana`, `Dockerfile.solana.dockerignore`, `deploy/render-solana.yaml`, `deploy/hosted-solana-gateway.env.example`, `render.yaml`, `package.json`, `scripts/{hosted-mcp-smoke,provision-hosted-mcp-render,provision-hosted-solana-render}.mjs`, `scripts/solana/hosted-preflight.ts`.
- Integration tests: `tests/integration/{hosted-mcp,postgres,solana-hosted-service}.test.ts`.
- Unit tests: `tests/unit/{hosted-mcp-config,hosted-solana,mcp-config,payer-readiness,provision-render,provision-solana,solana-hosted-payment,solana-hosted-sponsor,solana-payer-settlement,solana-pg-ledger,solana-signer-permissions}.test.ts`.
- Documentation/evidence: `docs/providers/atlas.md`, `docs/channels/hosted-mcp.md`, `docs/work/{ACTIVE_TASK,HOSTED_COMMERCE_COMPLETION}.md`, `docs/evidence/hosted-commerce-completion/{no-spend-probes,solana-protected-state}.json`.

## Risks and external actions

| Classification | Issue and why it matters | Recommended action | Risk of deferring / accepting |
|---|---|---|---|
| Investigate Now | Two unsigned legacy reservations cannot safely be assumed unsent or reset. | Reconcile original attempts and chain history with operator evidence; retain liabilities. Agree a safe resolution before migration. | Source remains unavailable; clearing them blindly could permit duplicate or unbudgeted spend. |
| Act Now, before apply | Both key files have broad inherited ACLs. | Protect existing files without replacing identities; rerun read-only permission checks. | Provisioner refuses; bypass would expose signing authority. |
| Act Now, before apply/spend | Current caps are blank and balances unverified. | Establish an explicit protected policy and verify payer token/sponsor fee balances; report exact funding amount/headroom. | No defensible authorized budget or funding proof exists. |
| Act Now, at approved migration | Legacy signers/history must not coexist with hosted signing. | Stop all legacy signer instances, freeze/verify both sources, retain permanent retirement locks, then import exact snapshots. | Concurrent signers could bypass cumulative accounting. |
| Investigate Now | Historical fast readiness failure has no captured classification; no genuine live cold acceptance. | Observe sanitized diagnostics at the next real cold/restart and collect the same MCP operation without warm-up. | Infrastructure behavior remains unproven; bounded recovery fails closed. |
| Investigate Now, after deploy | Render container/secret mounting and live dual-source readiness are unproven. | Run public no-spend provider quotes and authenticated source/restart checks after approved deployment. | Local tests cannot establish public reachability, available balances or platform compatibility. |
| Park for Later | Imported marker compares the original immutable entries, so an originally unsigned import cannot later be silently transformed. | Keep the current refusal of incomplete production imports; design explicit audited reconciliation only if required. | Availability may be delayed; relaxing import checks would weaken exact history preservation. |
| Ignore / Accept Risk | Free service sleep and public RPC availability can delay source readiness. | Accept bounded pending/unavailable behavior for the demo; monitor diagnostics without keep-alive spam. | Occasional availability delays, with no payment retry or fallback. |

Integration may proceed on top of the exact Astra base after normal review. Deployment must wait for the listed state blockers and explicit final authorization. Then verify public provider quotes, both sources, import totals and restart behavior before considering one separately bounded funding-only proof. No hotel/flight booking is required to prove the rail.

## Next task / handoff

Use a **fresh chat** for protected-state reconciliation and deployment approval; this implementation chat is long. Read ACTIVE_TASK, this report, and the two sanitized evidence files. The exact next task is to reconcile the two retained unsigned reservations, protect the existing keys, establish current caps/balances, and prepare a reviewable read-only provisioning plan. Exclude history reset, new wallets, merchant E2E, main merge and deployment until the relevant authorization is explicit.

Checkpoint commits: `2e07802` provider/readiness; `421ed55` free public Solana/PG; `e1029a4` final fixture corrections. All candidate work is committed at completion; no additional staging command is needed. Review safely in PowerShell:

```powershell
git -C C:\Dev\t2o-wt-hosted-commerce-completion status --short
git -C C:\Dev\t2o-wt-hosted-commerce-completion log --oneline ca5519ac6abb134b81f5cc194657a55718ec4701..HEAD
git -C C:\Dev\t2o-wt-hosted-commerce-completion diff --stat ca5519ac6abb134b81f5cc194657a55718ec4701 HEAD
```

Stop at this checkpoint and wait. Do not merge or deploy.
