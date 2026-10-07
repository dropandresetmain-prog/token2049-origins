# Public judge console release checkpoint

## Authority and scope
- Branch: release/public-judge-console; isolated checkout C:/Dev/t2o-wt-judge-release.
- Current origin/main and all three live services: 743e0475a3f02b8263aea4e4b73b1b6eae7531e1.
- Existing tag token2049-submission resolves to that prior freeze; preserve it.
- Founder reopened freeze to remove the website password and accepted public synthetic/demo observations.
- Highlight in README: judges ask Min Htet directly for the MCP OAuth access code.
- No private submission access field assumed. No credential is published or decrypted for this release.
- Shared checkout and completed activation worktree remain untouched.

## Lane convergence
- Final Activation completed and included: a02216ccb69e78e6800a45c81cd349021fd834ef.
- Atlas test-balance setting approved in the other chat and deployed; retain it.
- Hosted Atlas/Nuitee executable dual-rail quotes PASS; historical actual E2Es retained.
- Extra Solana/Nuitee recording cancelled by founder; no new payment/order for cleanup.
- Submission narrative source 835de08c709f5802d63ab21d4e62575f47baa406 included in main.
- CDP proof, CRE simulation/fresh Koios, Cardano/Shopify, OCBC and historical evidence retained.
- Sokosumi further work skipped by explicit founder decision.

## Access behavior
- Explicit MCP_PUBLIC_CONSOLE_READ_ONLY=true publishes fixed cus_HOSTEDMCPDEMO reads.
- Anonymous GET: list, owned status/detail/proof, Treasury and bank observations only.
- Read scopes exactly purchases:read, evidence:read, operator:read; no caller-selected ownership.
- Purchase/evidence redaction retained; other customers inaccessible; invalid bearer rejected.
- All mutations, OAuth, quote APIs, payment/signing and payer endpoints retain authentication.
- Browser connects without a credential; optional quote reads skipped; live polling retained.
- Public Treasury aggregates/masked sandbox bank values approved by founder as demo data.
- Existing protected-console acceptance artifact retained as historical evidence.

## Protected runtime
- Solana payer 7 rows/94220 committed units; sponsor 6 rows/25002 fee lamports.
- Two historical 1050-unit candidates remain unresolved, permanently blocked, exposure retained.
- Source identities/import markers/caps/retired signer locks must stay unchanged.
- Active Solana incomplete=0; Cardano signing/signed=0 at prior freeze.
- Cardano 5 accepted rows/94820 committed units; preserved caps/history.
- CDP official CLI Server Wallet/Base Sepolia operational treasury; not exact adapter proof.
- OCBC read-only fiat observation; internal ledger/manual reconciliation; no automatic conversion/rebalancing.

## Validation
- Backend 1219 tests/76 files PASS; console 88 tests/9 files PASS.
- Backend and console typechecks PASS; console production build PASS.
- Current public auth tests verify read allowlist, ownership, default-off, invalid bearer and mutation denial.
- Full gateway build PASS; 117 important links PASS; 440 files/270 history blobs scanned, no findings.
- Fresh anonymous deployed browser: Purchases/Proof/Receipt/Treasury/Connections PASS; no password/bearer; all GET.
- Candidate gateway 93841120401c215b9f68cd1f8f7436c2586ba7f7 LIVE, dep-db36pfrbc2fs73cq43g0.
- Acceptance: docs/evidence/release/public-console-20261008.json; no new payment/order.

## Deployment and freeze
- GitHub PUBLIC/default main; current frozen services main/auto-deploy off.
- Release is sole Render deployment owner; gateway adds only public read flag.
- Candidate code accepted; final promotion includes only acceptance JSON and checkpoint in addition to tested code.
- Exact final main SHA is required on all three services; final deployment remains next.
- Preserve previous tag; create token2049-submission-public-console only after verified final deployment.

## Next action
- Re-read before deployment, main promotion and completion.
- Run build/scans, commit exact files, push candidate and deploy gateway exact candidate SHA.
- Verify fresh anonymous Purchases/Proof/Receipt/Treasury/Connections and GET-only requests.
- Promote tested candidate safely; deploy exact main SHA to all services and verify protected state.
- Freeze and provide README file to Min Htet. No new orders/payments.
