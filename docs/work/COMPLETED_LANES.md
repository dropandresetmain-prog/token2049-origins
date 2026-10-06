# Completed lanes ready for integration

Prepared 2026-10-06 23:31 Singapore time. Branch **codex/crypto-integration**, worktree `C:/Users/sethl/.codex/worktrees/crypto-integration/token2049-origins`. It starts from the current application commit `63df582c6e837b6ae3c35aefb9ec97d90347dd99` and combines the completed changes below. The active Shopify checkout remains unchanged; no deployment or further paid provider write was performed.

## Integrated source checkpoints

| Change | Integration commit | Behavior |
| --- | --- | --- |
| Cardano | e46be835a2645e2aed92f267206d5e1d8cb80735 | Canonical sha256-prefixed quote binding; exact documented dispenser tUSDM asset support. |
| Solana | 765255dbe73cc417d2028e1af24d3124190f2cb4 | Official x402 Devnet adapter, separate payer/sponsor, protected signer history, finalized independent chain verification and durable recovery. |
| OCBC | 9714f03d066a7e55f89d84af8dc852f0e28f7bdf | Verified account-history endpoint with literal-path regression and meaningful provider failures. |

Cardano/Solana were cherry-picked cleanly from their isolated checkpoints; OCBC's exact reviewed three-file patch applied cleanly. Software tip is `9714f03d066a7e55f89d84af8dc852f0e28f7bdf`; any later report-only checkpoint does not change tested behavior.

Files changed: 42 before this report. Product areas are `clients/payer/payer.ts`, `src/funding/cardano/{adapter,config}.ts`, new `src/funding/solana/` and `clients/solana/`, `src/wiring.ts`, and `src/banking/ocbc/client.ts`. The remainder is pinned manifests, placeholder Solana configuration, targeted tests, acceptance tools and sanitized evidence/reports. No credentials or private signer history were copied.

## Checks on the combined branch

- Ordinary `npm ci --no-fund`: PASS, 252 packages, zero audit findings.
- `npm run typecheck`: PASS.
- `npm run build`: PASS, including migration copy.
- `npm test -- --maxWorkers=2 --no-file-parallelism`: **544/544 tests, 30/30 files PASS** in 71.93 seconds. Temporary test schemas only; no real funding/provider execution.
- `git diff --check 63df582c6e837b6ae3c35aefb9ec97d90347dd99 HEAD`: PASS. Integration worktree was clean after source checkpoints.
- Original lane configured/generated-secret scans: PASS. Root sanitized report/JSON verification is recorded in `C:/Dev/token2049-origins/integration-e2e/verification.json`.

No live payment was repeated for consolidation. Original evidence remains explicit about real integration steps and external fixtures:

| Lane | Verified outcome | Limit |
| --- | --- | --- |
| Cardano | Real 1020-base-unit Preprod funding, independent chain proof, response-loss restart recovery, one fixture merchant execution. | Shared protected payer budget is exhausted. Preserve history; never reset it. |
| Solana | One independently finalized 1050-base-unit Devnet transfer; 10001-lamport fee; one fixture merchant execution and recovery/replay checks. | Provided payer requires authenticated /prepare. Stock unmodified clients unsupported. Preserve payer/sponsor ledgers. |
| OCBC | 12 real masked sandbox balance/card/history observations from corrected adapter. | Historical sandbox data; no bank debit or settlement claim. |
| Nuitée | Real sandbox booking/readback/recovery; USD96.24 final total including USD3.84 fee confirmed by user. | Only the tested ACC_CREDIT_CARD sandbox flow; no source change needed. |
| Atlas | Real USD30.81 sandbox balance payment and ticketing/readback. | Unknown-create order lookup remains unproved; do not repeat an ambiguous create. |
| MCP | Real stdio and HTTP purchase-to-receipt protocol journeys with actual core/Postgres. | Merchant/funding fixtures; ChatGPT host connection remains unverified. |

## Remaining work and risks

- **Act Now:** Integrate this branch and provision its private rail configuration with the existing protected histories before signing. Source consolidation does not activate credentials or move ledger files. Deferral leaves the active application without these fixes; resetting ledgers could permit duplicate spending.
- **Investigate Now:** Atlas unknown-create lookup and actual ChatGPT-host connectivity are separate acceptance gaps. Deferral leaves those recovery/host paths unverified.
- **Investigate Now:** Solana stock-client support requires a distinct durable preparation design. Use the provided payer; otherwise stock requests will be rejected.
- **Ignore / Accept Risk:** Current Nuitée fee inclusion is grounded in the exercised booking and direct user confirmation. Do not generalize it to another payment method without evidence.

Masumi/Sokosumi is **excluded from this branch** and continues in `codex/masumi-sokosumi`. Its native task/lock/result and restart completed with real chain evidence; merchant/principal are labelled fixtures. Native automatic withdrawal is enabled for the owned local process, preserving its ten-minute grace: earliest normal withdrawal trigger **15:43:13 UTC / 23:43:13 Singapore**, then 20 confirmations. Actual payout remains pending. Its full final checks/checkpoint continue independently. Actual Sokosumi marketplace delivery is still PARTIAL: discovery/auth passed, but public endpoint, approved listing metadata and platform-to-agent authentication/task delivery remain unproved. Prepared steps: `C:/Dev/token2049-origins/integration-e2e/masumi-sokosumi/SOKOSUMI_NEXT_STEPS.md`.

## Exact next step

The current application checkout shares this repository's Git refs. If it still has the recorded clean base and its owning Shopify work is ready, this fast-forward command integrates the completed source without rewriting history:

```powershell
git -c safe.directory=C:/Dev/t2o-e2e-acceptance -C C:/Dev/t2o-e2e-acceptance merge --ff-only codex/crypto-integration
```

If it reports divergence, stop and reconcile the new changes in the integration branch; do not reset or force. No merge into that active checkout has been performed here because the user said they would integrate the rest while this lane continues.

Stay in this chat for the pending Masumi completion. Use a fresh chat for a larger combined deployment/configuration milestone, carrying this report, the exact source checkpoints and the protected-ledger locations from the lane reports. Full Cardano and Solana reports are in this worktree's `docs/work/CARDANO_FIX.md` and `docs/work/SOLANA_FIX.md`.
