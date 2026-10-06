# Known issues and review triage

Implementation checkpoint: `beac0228eec8418380b575e1d90665da3e939989`, reviewed and tested locally on 2026-10-06. No external purchase has passed. Findings below distinguish fixed safety issues from operational blockers and accepted first-lane limits.

## PostgreSQL migration findings

| Classification | Finding / affected files / evidence | Recommendation | Risk of deferring |
|---|---|---|---|
| Act Now — resolved | Startup reclaimed other workers' live leases; stale workers could complete/reschedule a newer claim. src/core/worker.ts. Independent-connection lease/expiry regression passes. | Recover only expired leases; fence status writes; lock purchase work across provider I/O. | Concurrent retrieval or repeated job ownership changes. |
| Act Now — resolved | Async confirmation could turn an already applied proof into an unapplied obligation after another confirmer committed. src/core/worker.ts. Recheck pending_confirmation in the transaction. | Keep transactional proof/state rechecks and unique journal/proof constraints. | Misclassified customer obligation or duplicate financial processing. |
| Investigate Now | Free Render database expires 5 November 2026, 14:55 Singapore time; 1 GB and no managed backups. Official CLI metadata and Render free-plan docs. | Export before expiry; obtain explicit authorization before any paid upgrade. | Loss of access and eventual deletion; no durable hosted retention claim beyond the trial. |
| Ignore / Accept Risk | Core writes serialize through one short PostgreSQL advisory lock. src/infrastructure/db.ts; capacity/idempotency tests across pools pass. | Keep one worker for this hackathon; external calls remain outside transactions. | Limited write throughput; lock timeouts fail safely rather than oversubscribe capacity. |

Provider/payer policy findings from the separate review lane are excluded; this migration changes no
Atlas gate, Cardano funding contract, Shopify/Nuitée payment behavior, MCP authority or payer policy.

## Act Now — resolved locally

| Finding / why it matters | Action implemented | Risk if omitted; remaining evidence |
|---|---|---|
| Settlement could precede durable funding evidence and lose a real receipt on crash. Same-hash retries could collide with completed jobs. | Persist candidate and recovery job before settlement; candidate-specific dedupe; startup job repair; one immutable replay reference. | Lost customer funds or stranded recovery. Real database restart and same-header fixture regressions pass; live crash recovery still unverified. |
| Pre-settlement rejection could lock a purchase forever. | Explicit `settlementAttempted:false` clears only proven pre-settlement candidates; ambiguous outcomes keep recovery and refuse another transfer. | Invalid signatures could hold capacity or a retry could double spend. Local rejection/ambiguity tests pass. |
| Expiry could cross async readiness/verification/confirmation or provider preparation. Late submitted evidence could lose confirmation work. | Signed transaction TTL must end by quote expiry; recheck after awaited gates and at provider commit markers; continue confirmation after closure; record late funds as unapplied liability. | Unapproved expired spend or unrecorded customer receipts. Local late/expired boundary tests pass. |
| Recovery could change commitment/payee after deployment origin or config changes. | Freeze funding resource URL; confirmation/recovery use stored payee/asset/commitment; missing credentials remain pending. | Actual old transfers could be falsely invalidated. Rotation/origin/restart tests pass; legacy records require their old origin. |
| Refresh could regress a paid receipt or stop silently on transport errors/retry exhaustion. | Forward-only consistent paid ticketing-to-ticketed refresh; read-only hourly continuation and manual-required events for funding/ticket jobs. | False receipt facts or abandoned confirmation. Local unknown/thrown-error/threshold tests pass. |
| Unauthorized charge currency/scale/amount could release capacity and recognize principal. | Keep unresolved exposure, retain greater same-unit reservation, preserve anomaly event and prohibit automatic later success/cancellation from erasing it. | Unfunded liabilities or capacity reuse. Local monetary mismatch tests pass; manual financial reconciliation has no mutation API. |
| Nuitée HTTP 408/5xx could be treated as definite rejection; readback could omit purchase identities. | Ambiguous status takes precedence; exact booking/client/hotel identities required before completion/cancellation. | Released exposure or unsupported success. Fake-provider regression tests pass. |
| Atlas order totals could omit extra fees or readback amount/reference. | Require explicit zero fees before payment, plus independent order identity and observed charged amount/currency. | Unauthorized fee or false paid claim. No fee-bearing route is enabled; live response semantics need verification. |
| Test-balance usage could be booked as card payable. | Separate provider-test-balance account/capacity usage and truthful receipt limitation. | Misleading liabilities and claimed card settlement. Balanced local journal tests pass. |
| Numeric provider handles could be redacted in restart checkpoints. | Preserve opaque private checkpoint reference; redact public event/PII/token outputs. | Lost reconciliation handles. Numeric-reference and token-redaction regressions pass. |
| MCP could send bearer authority to remote cleartext gateway/bridge. | HTTPS except loopback gateway; loopback-only bridge; ambiguous URLs and redirects refused; default MCP scope excludes funding. | Credential/payer authority disclosure. URL and real local redirect tests pass. |
| Environment-only evidence list could label a fixture as fresh external proof. | Persisted receipt/result provenance wins; execution-evidence status distinguishes source fallback from execution proof. | Fabricated external acceptance. Fixture-under-test-environment regression passes. |

The Docker access/build concern was resolved through permitted local access: image build, non-root Chromium, auth and persistent-volume restart checks PASS on Linux ARM64. Deployment remains NOT_RUN; repeat checks for its actual architecture/environment.

## Investigate Now — open

| Issue / why it matters | Recommended action | Risk of deferring |
|---|---|---|
| All provider/funding credentials absent. | Provision privately and follow TEST_CHECKLIST fresh funded acceptance sequence. | Local success cannot substantiate a working external purchasing demo. Every external row remains BLOCKED_EXTERNAL. |
| Atlas payment-path approval and all-in fee semantics are unresolved. | Founder explicitly approves bounded sandbox test balance, or supplies an evidenced permitted card/VCC mechanism. Verify actual latest fee field; retain zero-fee fail-closed rule. | No paid Atlas demo; enabling the flag or guessing fee semantics risks unauthorized spending claims. Flag remains false. |
| Shopify dev-store provisioning and live checkout/GraphQL behavior are unverified. | Provision own dev store, Bogus gateway, tokens/read_orders access and installed browser; verify exact tax/shipping and selectors using synthetic identities. | Missing permissions, unstable checkout or incomplete tax quote could block the run. No Admin mark-paid workaround is permitted. |
| Nuitée sandbox key/identity/paid response fields unverified against this account. | Confirm sandbox entitlement and exact independent booking/client/hotel identity fields before acceptance. | Strict adapter may remain unknown; do not drop identity checks to manufacture success. |
| OCBC subscriptions/session and card API contracts remain unverified. | Verify current entitled account/card/history endpoints from official documentation and fresh masked read-only calls; record 403/900908 and historical dates honestly. | Inaccessible or obsolete APIs; bank evidence cannot be claimed. Account Swagger/hackathon references alone are insufficient. |

## Park for Later

| Issue / why it matters | Recommended action | Risk of deferring |
|---|---|---|
| Write-only purchase clients cannot retrieve idempotent retry results. | Return the owner-scoped view within write retry or define a combined scope requirement. Defaults already include read. | Custom minimal clients get authorization failures on retries. |
| Masked bank last-four identities can collide when projecting latest balances. | Persist a private stable pseudonymous source identity separately from display masking. | Distinct observations can collapse. Journal/capacity is unaffected. |
| No operator mutation/refund automation is supplied. | Design audited, independently verified manual reconciliation/refund workflows as a separate milestone. | Liabilities/held exposure need manual investigation; refunds are not automatically sent. Never repair through raw mark-paid/journal edits. |

## Ignore / Accept Risk — bounded launch constraints

| Constraint / why acceptable here | Action / guard | Risk accepted |
|---|---|---|
| One gateway and in-process worker remain the launch topology. | PostgreSQL row/session locks protect accidental competing processes; preserve persisted jobs and attempt markers. | HA/replica operations are not validated or supported as a deployment architecture. |
| Payer incidental ADA caps are per transaction; principal caps are daily/cumulative. | Use one protected absolute shared ledger and a disposable wallet with bounded ADA; reconcile stale locks manually. | Total fee ADA is bounded by the wallet rather than a daily fee ledger. No production wallet is authorized. |
| Windows mode 0600 is best effort. | Apply Windows ACLs to private wallet/token/ledger directories. | OS file permissions remain an operator responsibility. |
| Unmodified x402 Cardano signer is incompatible with application binding. | Use the supplied committed signer; reject missing metadata. | Third-party payer integration needs the documented signer seam. |
| Shopify discovery searches recent orders with a finite window. | Persist direct order handles and use verified webhook hints; ambiguous/missing readback stays unresolved. | An undiscovered order may require manual lookup; no second checkout is sent. |
| Cross-currency charge anomalies have no automatic valuation. | Preserve original currency reservation, record actual anomaly and require operator review; no automatic release. | Exposure cannot be quantified automatically in another currency. Production use is excluded. |
| Solana, live Masumi/Sokosumi, polished console and submissions remain separate lanes. | Preserve channel/funding contracts and explicit completion matrix. | This first-lane local completion does not mean hackathon completion. |

## External acceptance hardening review disposition

| Finding | Class | Status / action | Why it matters / risk of deferring |
|---|---|---|---|
| AN-1 Atlas funding with closed gate | Act Now | Resolved locally: quote/funding guard and execution guard before any write; gate remains false. | Customer funding or supplier hold could precede rejection. Offline regressions pass. |
| IN-4 relative/missing payer ledger | Act Now | Resolved locally: required absolute path, exclusive setup initialization, pay/bridge require existing valid history. | Lost history could reset signer caps. Operator reconciliation required after loss. |
| PG-2 swallowed worker database errors | Act Now | Resolved locally: sanitized tick/job machine-code logs, no lifecycle redesign. | Acceptance failures would otherwise disappear; retry/recovery remains durable. |
| PG-5 unscaled service fee | Act Now | Resolved locally: frozen scaled principal/fee/total allocation; non-zero fee regression. | Unscaled fee could exceed scaled funding and corrupt completion accounting. |
| Shopify IN-1 hosted fields/forced click | Investigate Now | Unchanged; later UNFUNDED live rehearsal. | Unverified hosted fields or forced click can invalidate payment-safety/acceptance assumptions. |
| Atlas IN-2 ambiguous pay.do results | Investigate Now | Unchanged payment blocker; preserve gate false. | Ambiguous outcomes may be misclassified; no Atlas payment acceptance yet. |
| Atlas IN-3 final fee readback / runbook overstatement | Investigate Now | Unchanged payment blocker; verify independently before enabling payment. | Final fees may not match prior zero-fee assumptions; documentation is not external proof. |
| Legacy unstructured/full-notional obligations | Ignore / Accept Risk | Stored amounts and original commitments preserved; new payer rejects them. Requote for new demo payments, retain old recovery records. | No silent history rewrite, but old challenges cannot be signed by the hardened demo payer. |
| Windows protected ledger permissions | Ignore / Accept Risk | Apply OS ACLs; mode 0600 is best effort as before. | Absolute paths and initialization do not replace filesystem access control. |
| Full Chromium runtime packaging/live selectors | Investigate Now | Build-stage packaging only; no browser rehearsal or runtime image verification here. | Host tests cannot establish actual store selector behavior; acceptance remains NOT_RUN. |

P-1 through P-12, PG-1 and other PG findings remain outside this lane. No unrelated remediation or
provider-routing redesign was performed. The owner-supplied accepted Opus verdict/findings and PostgreSQL review reconciliation pasted in
Hackathon Build Recommendation were used. Original full core report was absent in inspected worktrees;
its accepted findings are carried through that reconciliation. Independent review
must check the combined financial-policy and human-orchestration branch before acceptance.

## Human orchestration findings and limits

| Finding | Class | Evidence / affected files | Action and deferral risk | Blocks first external acceptance? |
|---|---|---|---|---|
| Missing user fields could not reach MCP handlers; HTTP exposed generic validation errors | Act Now | `contracts/input.ts`, HTTP/core/MCP and input/HTTP tests | Resolved locally with strict drafts and controlled 422 `needs_input`. Deferring would encourage fabricated customer fields. | Resolved locally; review required |
| Default Cardano choice and approval did not name a stored funding option | Act Now | `contracts/api.ts`, `commerce.ts`, core/service/worker, MCP and funding-selection tests | Resolved locally: opaque quote-scoped IDs, no independent rail/default, persisted approval and execution guard. Deferring could spend using an unselected source. | Resolved locally; review required |
| Repeated buy could ask payer again while funding was submitted/uncertain or after a refusal | Act Now | MCP tools/client, quote-purchase lookup and MCP regressions | Resolved locally: owner-scoped follow-existing approval plus payment-state/attempt guard. Durable payer ledger remains the process/restart safeguard. Deferring could create duplicate funding interactions. | Resolved locally; review required |
| Missing payer identity and opaque state/JSON-first proof obscured what actually happened | Act Now | Payer status allowlist, shared progress, proof projection/page and tests/browser fixture checks | Resolved locally without exposing signing material or raw provider/fulfillment data. Deferring would undermine truthful approval/demo evidence. | Resolved locally; review required |
| Proof read shares the existing core advisory transaction lock | Ignore / Accept Risk | Evidence router/proof and PostgreSQL DB transaction helper | Keep bounded read-only queries for a coherent projection. At greater volume, move to a reviewed repeatable-read snapshot. Current bounded demo can tolerate brief read/write contention. | No |
| Bridge status is configuration/public identity, not balance or spend-cap acceptance | Ignore / Accept Risk | `Payer.source`, strict FundingSource, MCP preflight and UI text | Clearly label configured/unverified balance; payer still enforces caps before signing. Quote may be valid but payment can refuse for funds/caps. Never switch source automatically. | No, operator must provision the bounded demo source |
| Stronger human/wallet-session attestation | Park for Later | Approval event records channel-submitted exact terms; source metadata is channel/payer display only | Separate milestone if physical-human or unchanged-wallet attestation is needed. Current approval must not claim that proof. | No for bounded hackathon scope |
| Legacy quotes lack selectable option IDs | Ignore / Accept Risk | Optional persisted FundingOption ID and strict new purchase approval | Requote for new buys; retain old frozen amounts/receipts/recovery. Avoid inventing IDs or changing old digests. Old legacy quote cannot start a new purchase through this API. | No |

No new unresolved acceptance blocker was found in this lane. Shopify IN-1 (hosted-field allowlist /
forced click), Atlas IN-2 (ambiguous payment result), and Atlas IN-3 (fee readback/runbook claim) stay
**Investigate Now** blockers. Their affected provider files were not changed. Resolve through the
already-defined acceptance work only after independent review; this lane ran no external calls.
