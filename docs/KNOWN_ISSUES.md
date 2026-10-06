# Known issues and review triage

Implementation checkpoint: `beac0228eec8418380b575e1d90665da3e939989`, reviewed and tested locally on 2026-10-06. No external purchase has passed. Findings below distinguish fixed safety issues from operational blockers and accepted first-lane limits.

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
| One SQLite writer and in-process worker. | Run exactly one gateway instance; preserve persistent state. | No HA/replica support. Scaling without redesign is unsafe. |
| Payer incidental ADA caps are per transaction; principal caps are daily/cumulative. | Use one protected absolute shared ledger and a disposable wallet with bounded ADA; reconcile stale locks manually. | Total fee ADA is bounded by the wallet rather than a daily fee ledger. No production wallet is authorized. |
| Windows mode 0600 is best effort. | Apply Windows ACLs to private wallet/token/ledger directories. | OS file permissions remain an operator responsibility. |
| Unmodified x402 Cardano signer is incompatible with application binding. | Use the supplied committed signer; reject missing metadata. | Third-party payer integration needs the documented signer seam. |
| Shopify discovery searches recent orders with a finite window. | Persist direct order handles and use verified webhook hints; ambiguous/missing readback stays unresolved. | An undiscovered order may require manual lookup; no second checkout is sent. |
| Cross-currency charge anomalies have no automatic valuation. | Preserve original currency reservation, record actual anomaly and require operator review; no automatic release. | Exposure cannot be quantified automatically in another currency. Production use is excluded. |
| Solana, live Masumi/Sokosumi, polished console and submissions remain separate lanes. | Preserve channel/funding contracts and explicit completion matrix. | This first-lane local completion does not mean hackathon completion. |
