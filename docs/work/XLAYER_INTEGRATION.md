# X Layer integration checkpoint — 13 October 2026

> Historical local integration checkpoint. Its statements below describe the pre-hosted-activation state; the hosted release and E2E are complete. See [hosted release closeout](XLAYER_HOSTED_RELEASE_20261013.json) for the current status and evidence.

- Target baseline: `origin/main` at `739a618c212cb74f2fd806cf32becd4f520e0eb3`.
- Accepted implementation: `85f93b06b3c54268db4df142ed51d0a9122ce895` on `feat/xlayer-payment-rail`.
- Independent acceptance evidence was committed separately as `2473f7e4233412222d2059f00dfcd643176a38d1`, whose parent is the exact accepted implementation SHA. It includes `docs/work/XLAYER_ACCEPTANCE_20261013.json`; the original `docs/work/XLAYER_LIVE.json` remains preserved.
- Integration method: fast-forward only; no conflict resolution or payment-code edits were made during integration.
- X Layer implementation and its evidence are present on `integration/xlayer-candidate`. The owner authorized a fast-forward push to `main`; the push may trigger the existing gateway auto-deploy, but it does not enable X Layer payments.
- Independent E2E: X Layer Testnet chain 1952; nonce 1; USD₮0 transfer of 17,950 base units; transaction `0xfa39b5fd57670e30be51b8b29db2d9839c55afe0dc2e7552c18aca8588d8cbc1`; purchase `pur_01M4RK7M8EVPX46H8WQY0ZHKJ2`; receipt `rcp_01M4RK92SYDGXVDK0NDA7K60BX`; Shopify sandbox order #1007 (simulated merchant capture). Full independent verification and database counts are in the acceptance JSON.
- Post-integration checks on the final source and docs candidate: 19 focused files, 590/590 tests passed serially; backend and console typechecks passed; `npm run build` passed. The first parallel attempt hit local PostgreSQL fixture timeouts/cleanup contention (18 failures); the identical subset passed with one Vitest worker. The retained acceptance schema was not used.
- The feature preserves Cardano, Solana and Sui history/behavior.
- Hosted boundary: no Render deployment, hosted Neon migration `0014`, wallet registration, signing grant, permission change, spending-cap change or new transaction was performed by integration.
- At this historical checkpoint, hosted Neon migration `0014`, X Layer wallet registration and its signing grant had not yet been applied, and no hosted payment had been made. The 13 October hosted release supersedes this status; see [hosted release closeout](XLAYER_HOSTED_RELEASE_20261013.json).
