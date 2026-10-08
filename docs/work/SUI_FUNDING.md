# Sui purchase funding lane

Branch: `feat/sui-purchase-funding`. Base: `7c09b37eaaeda2bf3eec94fc1e3456118962f636` (`origin/main`, fetched 8 October 2026). Isolated worktree: `.runtime/sui-funding`. Shared checkout and release ledger untouched.

## Architecture and boundaries

- Native Circle USDC on Sui Testnet through official `@mysten/sui` 2.35.0 and binary gRPC-web. This is **not x402**.
- Payment Kit was investigated: its SDK remains experimental. This lane avoids registry deployment, custom Move, gas sponsorship and bridges.
- Separate Ed25519 payer signs an exact, bounded coin merge/split/transfer or standard framework sender-balance redemption, and an application binding over the transaction digest, persisted purchase, quote digest, recipient, asset, amount, resource, expiry and settlement breakdown. Address-balance gas and USDC use signed Testnet genesis, quote expiry, epoch window and durable reservation nonce.
- Ordinary transfer has **no on-chain purchase commitment or payment registry receipt**. Binding is a payer-signed application statement validated before the core persists the digest. The database associates that digest with one purchase; its unique constraints prevent reuse. Recovery trusts that previously validated association and independently reads transaction bytes and checkpoint evidence.
- The gateway holds no keys. It submits already signed bytes only after durable candidate preparation. `recover` is read-only; `resume` checks the chain first, then can resend only the exact stored authorization within expiry. Unknown outcomes remain pending. Payer reservations and signed candidates survive timeouts and restarts; no new candidate is generated for the same purchase.
- Existing 1:1000 settlement calculations, journal, fees, commerce execution, late received liability and refund assumptions are reused.
- Append-only migration `0010_sui_funding_recovery.sql` adds an immutable signed public recovery payload and terminal failed attempt status. Existing rail/network TEXT columns and candidate/evidence uniqueness cover Sui. Applied migrations are unchanged. Independently finalized failed transactions with matching bytes and zero principal effects release capacity without commerce or funding journal entries.

## Official sources and live readback

- [Sui clients](https://sdk.mystenlabs.com/sui/clients/grpc), [transaction APIs](https://sdk.mystenlabs.com/sui/clients/executing), [signatures](https://sdk.mystenlabs.com/sui/cryptography/keypairs).
- [Payment Kit status](https://github.com/MystenLabs/ts-sdks/blob/main/packages/docs/content/payment-kit/payment-kit-sdk.mdx), [standard](https://docs.sui.io/onchain-finance/payment-kit).
- [Circle Sui quickstart](https://developers.circle.com/stablecoins/quickstart-setup-transfer-usdc-sui), [official USDC faucet](https://faucet.circle.com/), [SUI faucet](https://faucet.sui.io/).
- Official Testnet fullnode live read returned genesis `69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD`, native Circle USDC package and metadata with 6 decimals. Default text gRPC-web failed; binary format succeeded. One initial null metadata response resolved on subsequent read; readiness fails closed.

## Checkpoints

- Protocol/architecture: complete.
- Adapter, separate payer, durable ledger and minimal shared compatibility: implemented and locally verified.
- 256 focused unit tests passed across 11 files: Sui adapter (44), independent RPC (16), payer builder (9), payer ledger (9), payer HTTP/restart/caps (14), and targeted Cardano/Solana/presentation/config regression coverage.
- Six Sui HTTP/core/native PostgreSQL integration tests passed: explicit multi-rail selection, loss before verification, loss after acceptance, late confirmation/unapplied liability, finalized failure/capacity release, ambiguous outcome/replay.
- 87 tests passed across native PostgreSQL contract, MCP dual-rail, Solana funding, scaled settlement, funding recovery and wiring suites. No MCP-host acceptance was performed.
- 88 console tests passed. `npm run typecheck`, `npm run console:typecheck`, `npm run build` and `git diff --check` passed.
- Initial temporary PGlite regression failures were caused by absent session isolation; those results are discarded. Final DB checks used a separate native PostgreSQL 18.6 linux/arm64 container at loopback port 55434 with UUID schemas. Existing port 55432/container data was not changed.
- Official Sui identity/asset readiness and genuine controlled Shopify search preflight passed; one external sandbox offer returned. No merchant purchase was created by preflight.
- Real Testnet payment: not executed.
- External merchant E2E: not executed.

## Dedicated acceptance setup

- Payer: `0x99eb4437d493fae3b8c43830e18b2710cd285f9cdd40264e0056d275eb86d20b`.
- Treasury: `0x450e23b2c8d3d6b6103c878b67fa7687b09422ee2f874851b87f1dba87d05f56`.
- Protected secrets/history outside Git: `C:\Users\sethl\.capsule\sui-testnet-20261008` (`payer.key`, `treasury.key`, `.env.sui`, `bridge-token.txt`, `sui-ledger.json`). Gateway token and one-purchase manifest are created there during acceptance; existing signer histories are untouched.
- Official automatic SUI faucet succeeded: `BTyEmbFQcSibFSzqbxh3PsaakARHowujYRwwAQ6knx6Y`, independently checkpointed at 392452450; payer received 1 SUI in address balance. USDC remains unfunded. Manual Circle faucet requires reCAPTCHA; request its 20 Testnet USDC grant on Sui Testnet. Acceptance payer cap is 0.1 USDC per payment, 0.5 daily, 1 cumulative; gas budget is 0.01 SUI per payment.
- Persistent isolated acceptance database: container `origins-sui-funding-acceptance-20261008`, volume `capsule-sui-testnet-acceptance-20261008`, loopback 55435, PostgreSQL 18.6. Set `SUI_E2E_DATABASE_URL=postgresql://origins:origins_local_only@127.0.0.1:55435/origins` for `npm run e2e:sui -- <private-env-file> --execute`. Never replace the retained manifest or schema to retry an uncertain outcome.
- `scripts/sui/live-e2e.ts` uses the existing Shopify executor and ordinary quote/approval/purchase API, invokes the separate payer with an allowlisted environment, and independently checks checkpoint, paid test order, receipt/proof, single funding journal and same-candidate repeat. Sanitized live evidence will be written to `docs/work/SUI_LIVE.json` only when executed.

## Reproduction

Run from this feature worktree. On Windows set TEMP/TMP/TMPDIR to `.runtime/test-temp` (absolute), and use the isolated DB URL on port 55434 for DB tests.

```powershell
npm run typecheck
npm run console:typecheck
npm run build
npm run console:test -- --maxWorkers 2
npx vitest run --maxWorkers 2 tests/unit/sui-funding.test.ts tests/unit/sui-rpc.test.ts tests/unit/sui-payer.test.ts tests/unit/sui-build.test.ts tests/unit/sui-ledger.test.ts tests/unit/solana-funding.test.ts tests/unit/cardano-adapter.test.ts tests/unit/cardano-binding.test.ts tests/unit/funding-source.test.ts tests/unit/presentation.test.ts tests/unit/mcp-config.test.ts
npx vitest run tests/integration/sui-funding.test.ts
npx vitest run --maxWorkers 2 tests/contracts tests/unit/mcp-dual-rail.test.ts tests/integration/solana-funding.test.ts tests/integration/scaled-settlement.test.ts tests/integration/funding-recovery.test.ts tests/integration/wiring.test.ts
```

## Risks

- **Act Now — resolved:** durable exact-candidate resume and terminal finalized-failure handling closed review gaps; native PostgreSQL recovery/regression checks passed. Merchant secrets are excluded from the payer subprocess environment.
- **Investigate Now:** execute the bounded live USDC/Shopify acceptance after faucet funding. Until then, external settlement and genuine merchant completion remain unverified; branch is not yet ready for main integration.
- **Ignore / Accept Risk:** application binding is not an on-chain registry. Keep the exact signed candidate and unique digest association; stronger on-chain order receipts would require a separate protocol milestone.
- **Ignore / Accept Risk:** stale payer locks and reservations without signed payload fail closed for operator reconciliation and retain caps. A transient builder failure can block that purchase; automatic history reset or rebuilding after an uncertain signing crash could weaken spending guarantees.
- **Park for Later:** hosted Sui payer provisioning, production/mainnet operation, distributed payer coordination and Payment Kit migration. No production/deploy work is authorized.
