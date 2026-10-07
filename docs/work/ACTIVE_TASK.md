# Judge-ready release checkpoint

## Scope and authority
- Release branch: release/judge-ready; isolated checkout C:/Dev/t2o-wt-judge-release.
- Initial authoritative origin/main: 2833c79b0d423cf58fe28142d27bdc510a9bb0a0.
- Shared checkout and activation checkout are not edited by this lane.
- Sokosumi: skipped by explicit founder decision.

## Active lanes
- Activate final Capsule candidate completed PARTIAL at fa9d688cd068348ea409d402563bec6c239b8efb.
- Full final report read: SAFE TO MERGE = NO; candidate not deployed.
- Reconcile Solana candidates is active in the activation worktree, implementing approved Option B historical quarantine.
- Do not integrate activation, deploy, modify protected Solana state, or retire any signer until that lane completes.
- Submission docs remote tip: 835de08; narrative rewrite complete with track/CDP/OCBC update.
- Latest docs tracker requests founder review of track/treasury update; inspect approved scope before final convergence.

## GitHub / deployment
- GitHub repository PUBLIC; default branch main verified with gh.
- Initial worktrees and all local/remote branch heads inventoried.
- Local main is behind origin/main; do not switch shared checkout.
- Reported existing gateway deployed SHA: 974a39bfb59adb0a317d0db05a12268bbbb6242d; live API verification pending.
- Live Render inventory: gateway branch main, SHA 974a39bfb59adb0a317d0db05a12268bbbb6242d, auto-deploy yes, free plan.
- Cardano branch main, SHA d7ae869a358410e20b47e23901d6879fb8e348fc, auto-deploy no, free plan.
- Activation remains the sole deployment owner while active; settings unchanged by release lane.
- Database health: pending.
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
- Dedicated password generated in operator-only DPAPI storage outside Git; plaintext never printed or committed. No Render hash changed yet. Live acceptance waits for deployment handover.

## Evidence convergence
- Main has historical Atlas/Cardano and Nuitée/Solana combined PASS evidence.
- Human Cardano/Shopify report retained at docs/evidence/human-cardano-shopify-20261007.md.
- Payment/order/receipt/proof and fresh MCP ORDER CONFIRMED verified by controller; budget/approval transcript acceptance remains partial.
- CRE source/evidence imported from feat/chainlink-cre bounded paths; six verifier tests and typecheck pass.
- Remote submission documents imported from 835de08, excluding its ACTIVE_TASK tracker; factual/access/link reconciliation only.
- CDP c74ff8b is work note only; original proof copied from independent CDP proof worktree, byte preservation to verify.
- Added exact .gitignore exception for curated server-wallet-proof.json, avoiding prior broad wallet-name exclusion.
- Preserve CLI provenance: CDP operational treasury, not runtime-adapter proof.
- OCBC read-only observations, no customer settlement or automatic conversion/rebalancing.
- Main README has stale deployment/MCP/UI/Shopify claims; use submission narrative, reconcile runtime facts.

## Gates
- Bounded scan: 377 current text files and 129 introduced doc/CRE/CDP history blobs; no secret or evidence-PII findings.
- Earlier full-tip scan: 532 unique blobs; only documented local/sample DB credential URLs, no real secret findings.
- Re-scan final runtime history and exact password before promotion.
- Root/index/architecture/CRE/CDP navigation: 116 relative links, anchors and image paths PASS. Original CDP proof bytes match SHA-256 0d138a9d8a6d6cc4aa6e23acf561ec61042be78725e37abb6fda07f0a294ba78.
- Anonymous GitHub repository HTTP 200 verified without Authorization; final default-branch rendering remains pending promotion.
- Current public /health HTTP 200; fresh console tab woke free gateway and reached old Access key prompt. Final Password prompt and authenticated cold test pending.
- Auth/evidence regressions: 51 tests PASS; console: 85 tests PASS; backend/console typechecks and production build PASS.
- No real payment/order initiated by release lane.
- Main promotion / exact final deployment / freeze: blocked on active lane and final gates.

## Next action
- Read-only Render service/deploy inventory.
- Inspect auth middleware and focused tests; implement narrow read-only judge access.
- Inspect submission docs and CRE/CDP evidence before importing approved paths.
- Re-read this file before lane integration, promotion, deployment, or completion.

