# Local verification record — 2026-10-06

- Implementation: `beac0228eec8418380b575e1d90665da3e939989`, `build/commerce-core`.
- Environment: Windows ARM64, PowerShell, Node v24.15.0, worktree `C:\Dev\token2049-origins-core`.
- Dependencies: existing pinned package-lock; no dependency changes in this continuation.
- Evidence mode: **local_fixture / offline validation only**. No external funding, provider purchase or bank observation is claimed.

| Command / check | Result | Evidence and limit |
|---|---|---|
| `npm run typecheck` | PASS, exit 0 | Strict full-source/test compile; final run 2026-10-06. |
| `npm test` | PASS, exit 0 | Vitest 4.1.11; 21 files, 396 tests passed; final run started 14:00:44 UTC. Uses fake external transports and local servers only. |
| `npm run build` | PASS, exit 0 | `tsc -p tsconfig.build.json`; includes gateway and scripts, excludes payer clients from gateway image build. |
| Compiled entry point `node dist/src/main.js` | PASS | Child-process probe with APP_ENV=test, in-memory DB, loopback port 18787. Health/capabilities/inspect 200 and protected evidence 401; child stopped after probe. |
| Compiled `dist/scripts/create-client.js` | PASS | Disposable isolated DB/token directory; default MCP lacks fund scope; payer has read/fund and same customer; operator has operator read. No token values printed; disposable directory removed after resolved-path verification. |
| `npm run readiness` | PASS as informational command, exit 0 | All five rows MISSING_CONFIG. This is not external acceptance. |
| `npm run readiness -- --strict` | Expected nonpassing gate, exit 1 | Correctly refuses missing external configuration. |
| `git diff --check`, staged whitespace check | PASS | Exact source/example/test paths staged; no `.env`, wallet, token, ledger or database staged. |
| Docker build/runtime/browser/volume checks | PASS, exit 0 | Linux ARM64; non-root Chromium, scoped auth and database/token persistence across restart. See container-verification. Public deployment/live checkout NOT_RUN. |

The compiled smoke used an inline Node `spawn` probe with explicit loopback/in-memory configuration, native fetch for health/capabilities/inspect/evidence, and `spawnSync` for the three CLI roles. Unit/integration source reproduces auth and wiring boundaries in `tests/integration/wiring.test.ts`; fault/restart checks are in `funding-recovery.test.ts`. A failed newly added test originally referenced a helper outside its describe scope; that test-only error was corrected before the final passing run. No failed run is presented as PASS.

## Sanitized readiness output (unconfigured process environment)

```text
appEnv=development database=set
shopify MISSING_CONFIG env=test
  missing=SHOPIFY_STORE_DOMAIN,SHOPIFY_STOREFRONT_TOKEN,SHOPIFY_CLIENT_ID,SHOPIFY_CLIENT_SECRET,SHOPIFY_DEV_STORE_CONFIRMED,SHOPIFY_BOGUS_GATEWAY_ENABLED,SHOPIFY_BROWSER_EXECUTABLE
atlas MISSING_CONFIG env=sandbox
  missing=ATLAS_BASE_URL,ATLAS_CLIENT_ID,ATLAS_CLIENT_SECRET
  payment gate disabled; holds are never paid
nuitee MISSING_CONFIG env=sandbox
  missing=NUITEE_API_KEY
cardano MISSING_CONFIG env=cardano-preprod
  missing=CARDANO_NETWORK,CARDANO_FACILITATOR_URL,CARDANO_TREASURY_ADDRESS,CARDANO_ASSET_UNIT,CARDANO_ASSET_DECIMALS,BLOCKFROST_PROJECT_ID
ocbc MISSING_CONFIG env=sandbox
  missing=OCBC_API_CLIENT_ID,OCBC_API_CLIENT_SECRET
```

Environment example files were not loaded for this report. External completion rows remain BLOCKED_EXTERNAL; configuration-only or SDK round-trip fixture tests do not establish real Preprod settlement or merchant-side paid sandbox behavior. Provider protocol references live beside this record and in `docs/providers/`.
