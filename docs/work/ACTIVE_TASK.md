# Judge-ready release checkpoint

## Scope and authority
- Release branch: release/judge-ready; isolated checkout C:/Dev/t2o-wt-judge-release.
- Initial authoritative origin/main: 2833c79b0d423cf58fe28142d27bdc510a9bb0a0.
- Shared checkout and activation checkout are not edited by this lane.
- Sokosumi: skipped by explicit founder decision.

## Active lanes
- Activate final Capsule candidate completed PARTIAL at fa9d688cd068348ea409d402563bec6c239b8efb.
- Original partial report had SAFE TO MERGE = NO; superseded by completed Option B activation and founder acceptance of existing proof. Release review verified permanent replay guards and preserved exposure; full candidate suite PASS. SAFE TO MERGE = YES for the completed, reviewed candidate.
- Reconcile Solana candidates CLOSED COMPLETE at a02216ccb69e78e6800a45c81cd349021fd834ef (pushed); runtime/deployed afa59b1459aec6fad545ab5eeec1b2b37a15445c. Full latest approval and closure reports read.
- Atlas exact setting approved and deployed; Atlas/Nuitee executable dual-rail quotes PASS. Founder cancelled recording/new live E2E and accepted existing slides/videos/proof; no booking remains pending.
- Completed activation: hosted import retains 7 payer / 6 sponsor rows; exact hashes/identities/totals verified; original IDs reject replay (403); active incomplete count zero; restart PASS.
- No new payment/booking in activation; new live E2E cancelled by founder. Completed runtime/evidence are integrated into the release candidate; original historical proof retained.
- Submission docs remote tip: 835de08; narrative rewrite complete with track/CDP/OCBC update.
- Remote docs incorporated for release review per founder request; its tracker is excluded. No independent narrative rewrite.

## GitHub / deployment
- GitHub repository PUBLIC; default branch main verified with gh. Repository About now points to the live console and Capsule one-liner.
- Initial worktrees and all local/remote branch heads inventoried.
- Local main is behind origin/main; do not switch shared checkout.
- Initial gateway deployed SHA independently verified: 974a39bfb59adb0a317d0db05a12268bbbb6242d.
- Latest live Render inventory: gateway, Cardano payer and Solana payer all branch integration/final-activation, SHA afa59b1459aec6fad545ab5eeec1b2b37a15445c, auto-deploy no, free plan.
- All three live deploy statuses independently verified through Render GET API. Release lane changed no Render setting.
- Activation is idle/closed. Release assumes sole deployment ownership after reviewed integration.
- Initial hosted DB PASS: purchase list/detail/proof all HTTP 200; exact human-run transaction and receipt re-read. Treasury/bank HTTP 403 as expected before access fix deploy. Final candidate recheck required.
- Final deployed SHA: NOT FROZEN.
- Final submission SHA / tag: NOT CREATED.

## Judge access
- Current hashed console client: cli_HOSTEDCONSOLE.
- Current scopes purchases:read + evidence:read, missing operator:read.
- Treasury and bank GET require operator:read.
- Important risk: bank refresh POST also accepts operator:read and inserts observations.
- GET-only enforcement implemented for cli_HOSTEDCONSOLE in shared HTTP authentication; bank refresh and all mutations denied.
- Registered scopes exactly purchases:read, evidence:read, operator:read; existing rows upgraded preserving owner and revocation.
- Browser keeps bearer only in memory; sign-in input is already password type.
- Password copy implemented and production console build passes.
- Dedicated password generated in operator-only DPAPI storage outside Git; plaintext never committed or disclosed. Automatic approval review rejected decrypt/print into tool transcript before deployment; password remains sealed. Founder explicitly chose to keep it sealed until live access passes; do not disclose it before successful live verification. No Render hash changed yet. Live acceptance waits for deployment handover.

## Evidence convergence
- Main has historical Atlas/Cardano and Nuitée/Solana combined PASS evidence.
- Human Cardano/Shopify report retained at docs/evidence/human-cardano-shopify-20261007.md.
- Payment/order/receipt/proof and fresh MCP ORDER CONFIRMED verified by controller; budget/approval transcript acceptance remains partial. Release retained fresh curated GET proof JSON.
- CRE source/evidence imported from feat/chainlink-cre bounded paths; six verifier tests and typecheck pass.
- Remote submission documents imported from 835de08, excluding its ACTIVE_TASK tracker; factual/access/link reconciliation only.
- CDP c74ff8b is work note only; original proof copied from independent CDP proof worktree and byte preservation verified.
- Added exact .gitignore exception for curated server-wallet-proof.json, avoiding prior broad wallet-name exclusion.
- Preserve CLI provenance: CDP operational treasury, not runtime-adapter proof.
- OCBC read-only observations, no customer settlement or automatic conversion/rebalancing.
- Release README uses remote submission narrative with verified access/evidence corrections; stale main remains unchanged until promotion.

## Gates
- Final merged bounded scan: 438 current text files and 247 introduced history blobs; no secret or evidence-PII findings. Exact prepared password scan of tracked files and own introduced history PASS.
- Earlier full-tip scan: 532 unique blobs; only documented local/sample DB credential URLs, no real secret findings.
- Re-scan final runtime history and exact password before promotion.
- Root/index/architecture/CRE/CDP navigation: final 117 relative links, anchors and image paths PASS after partial activation evidence retained. Original CDP proof bytes match SHA-256 0d138a9d8a6d6cc4aa6e23acf561ec61042be78725e37abb6fda07f0a294ba78.
- Anonymous GitHub release branch renders README and evidence matrix; public Sign in control confirms no owner session. Logo loads (1024px intrinsic); architecture page headings render anonymously. Final default-branch recheck pending promotion.
- Current public /health HTTP 200; fresh console tab woke free gateway and reached old Access key prompt. Final Password prompt and authenticated cold test pending.
- Final integrated candidate: backend 1216 tests / 75 files PASS; console 87 tests / 9 files PASS; backend/console typechecks and production build PASS. Corrected migration-count expectation and short-deadline search collection fixture.
- No real payment/order initiated by release lane.
- Main promotion / exact final deployment / freeze: pending completed candidate integration, security/tests, judge-access installation and cold acceptance. No Atlas approval or recording blocker remains.
- Earlier GitHub HTTP 500 publication failures recovered; corrected release checkpoint bbb6af2 pushed successfully.
- Release candidate includes completed activation a02216c, docs source 835de08, CRE/CDP/human evidence, and GET-only judge auth; publish exact merged candidate before deployment.

## Next action
- No founder Atlas/recording approval remains. Activation idle/completed; release may assume deployment ownership after final integration checks.
- Release: review the completed a02216c candidate and merge only after verifying retained protection and safe completed state.
- If safe, integrate its final SHA, preserving judge GET-only auth and the release tracker.
- Run final candidate checks; take deployment ownership only after activation stops.
- Install the dedicated password hash, deploy exact candidate, cold-test all four views, then promote/freeze.
- Re-read this file before lane integration, promotion, deployment, or completion.
