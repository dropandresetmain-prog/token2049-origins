# X Layer (OKX) purchase funding lane

Branch: `feat/xlayer-payment-rail`. Base: `739a618c212cb74f2fd806cf32becd4f520e0eb3` (`origin/main`, 13 October 2026). Isolated worktree `C:/Dev/t2o-wt-xlayer`. Sui is the behavioural reference; nothing Sui-, Solana- or Cardano-specific was changed. Integrated into the local candidate `integration/xlayer-candidate` after independent acceptance. Not activated or deployed; hosted migration `0014` is not applied. See [integration record](XLAYER_INTEGRATION.md).

## What shipped

**Native X Layer Testnet USD₮0 ERC-20 transfer. Not x402.** No OKX API credentials, facilitator or seller endpoint are involved. See "x402 decision" below for the evidence behind that choice.

| Fact | Value (verified on-chain 13 October 2026) |
| --- | --- |
| Network | X Layer Testnet, chain id `1952` (both official RPCs return `0x7a0`), CAIP-2 `eip155:1952` |
| Gas token | OKB |
| Token | USD₮0 `0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c` (EIP-1967 proxy → `0x73406f06…2510`), `decimals()=6`, `symbol()="USD₮0"` |
| RPCs (allow-listed, nothing else accepted) | `https://testrpc.xlayer.tech/terigon`, `https://xlayertestrpc.okx.com/terigon` |
| Explorer | `https://www.okx.com/web3/explorer/xlayer-test/tx/<hash>` |
| Rail id / protocol / header | `xlayer` / `xlayer-usdt0-transfer` / `xlayer-payment` |
| Console name | **X Layer (OKX)** |

Mainnet (`196`) is neither configured nor reachable: the gateway accepts only chain `1952` and the pinned token.

## Architecture (same shape as Sui)

```
quote ─► explicit approval (exact quote + selected X Layer option + registered wallet)
      ─► payer: reserve cap ─► build one EIP-1559 transfer(payTo, amount) ─► sign tx + sign binding message ─► persist candidate
      ─► POST /v1/purchases/:id/fund  xlayer-payment: <candidate>
      ─► gateway prepare() persists the exact signed bytes ─► verify(): resubmits nothing that already exists, otherwise sendRawTransaction
      ─► independent receipt + Transfer-event + confirmations read ─► funding evidence ─► merchant executor (unchanged) ─► receipt/proof
```

* Gateway: `src/funding/xlayer/{config,wire,rpc,adapter}.ts`. The gateway holds no key; it submits only already-signed bytes after durable preparation.
* Payer: `clients/xlayer/{config,ledger,pg-ledger,signer,pay,bridge}.ts`; hosted engine in `clients/multiwallet/engines.ts` (+ `policy.ts`), registration/preflight in `scripts/multiwallet/`.
* Shared contract changes are additive: `FundingRail`/`ChainEnvironment` enums, `XLayerFundingSource`, funding-instructions protocol, proof payer format, evidence environment label `xlayer-testnet`, MCP bridge variables, wiring.
* Migration `0014_xlayer_wallet_ledger.sql` (append-only; `0013` already existed): widens the `registered_wallets.rail` check and adds guarded `hosted_xlayer_identity` / `hosted_xlayer_ledger`. No existing table, row, guard or history is modified.
* Script entry points: `npm run payer:xlayer:setup`, `payer:xlayer`, `payer:xlayer:bridge`, `e2e:xlayer`. Environment: `.env.xlayer.example`.

### What the gateway independently verifies before recording funding
chain id; pinned token code/decimals/symbol; transaction `to == token`, `value == 0`, calldata byte-equal to `transfer(treasury, exactAmount)`; type-2 transaction only (no legacy, access-list or EIP-7702 shapes); gas limit × max fee ≤ `XLAYER_MAX_GAS_BUDGET_WEI`; recovered signer equals the approved wallet; a separate payer signature binds the digest to purchase, quote digest, recipient, asset, amount, resource URL, expiry and settlement breakdown; receipt `status == success`; **exactly one** token `Transfer` log whose `from`, `to` and `value` equal payer, treasury and exact amount; at least `XLAYER_CONFIRMATIONS` (default 2) blocks.

## Parity with Sui — unchanged semantics

| Concern | Behaviour |
| --- | --- |
| Denomination | Existing `scaled_testnet` 1:1000 settlement; `validateSettlement` with 6 decimals; no FX claim |
| Caps | Same ceilings as Sui: ≤ 5,100,000 token base units per payment/daily/cumulative, commercial ≤ USD 5,100.00; reservations count as spend; rolling 24 h; gas capped separately (OKB wei) |
| Quote expiry & binding | Application-enforced (EVM transactions carry no deadline). Exact payTo/amount/asset/chain in signed calldata |
| Approval / signer isolation | Unchanged registered-wallet dispatch: `selectedSourceId`, `wallet_signing_authority`, per-instance grant, pinned policy digest; payer ≠ treasury enforced |
| Idempotency | Ledger entry per purchase; repeat request re-reads the gateway and replays the same stored candidate; durable `funding_attempts` + recovery payload |
| Merchant duplicate prevention | Unchanged core/executor checkpointing |
| Unknown outcomes | Candidate retained; `recover` is read-only; `resume` resends only the stored bytes, only before expiry, never an existing hash |

### Deliberate rail-specific differences (EVM)
1. **Nonce discipline.** Sui uses a signed epoch window + durable reservation nonce. EVM has a sequential account nonce, so the payer takes the chain's *pending* transaction count and refuses to sign while a different purchase holds a signed candidate whose nonce is not yet consumed (`nextNonce`). The payer wallet must not be used for any other transaction.
2. **Superseded/dropped transactions.** If the candidate's nonce is consumed at a block ≥ `XLAYER_CONFIRMATIONS` deep and the candidate hash is absent, the signed bytes can never execute: this is a definitive, zero-principal failure and releases capacity (`definitiveFailure`). A mere timeout or absence is never a failure.
3. **Reverted transactions** are a definitive failure only after confirmation depth and only with zero token `Transfer` logs. The reverted transaction's OKB gas is real spend and stays counted in the gas ledger.
4. **Gas** is OKB wei (reservation = `XLAYER_MAX_GAS_BUDGET_WEI`, ceiling 0.01 OKB; cumulative ceiling 0.1 OKB). X Layer is an OP-Stack chain; the L1 data fee is not part of the L2 gas budget the payer can bound. At observed prices (base fee 0.02 gwei) it is negligible; the wallet should hold a small OKB surplus.

## x402 decision

Findings from the official sources (13 October 2026): OKX `exact` uses EIP-3009 `transferWithAuthorization`; the *seller* forwards the signed authorization to the OKX facilitator (`web3.okx.com/api/v6/pay/x402/{supported,verify,settle}`), which broadcasts it. Every facilitator call needs OKX API key/secret/passphrase. All facilitator/SDK pages list only `eip155:196`; only the buyer guide and the official mock merchant mention `eip155:1952`. The mock merchant (`GET https://www.okx.com/api/v1/pay/mock-merchant/resource` → `402`, x402Version 2, `exact` + `aggr_deferred`, amount `10000`) asks for a *different* testnet token (`USDC_TEST`, `0xcb8bf24c…c79d`), not USD₮0. Capsule's Shopify flow has no x402 seller endpoint, and none was fabricated.

**Shipped integration: native X Layer stablecoin transfer only.** No x402 settlement, no Shopify-via-x402 claim. Reaching x402 later needs owner-provided OKX API credentials and confirmation that the facilitator supports `eip155:1952`; the mock-merchant exercise would be protocol evidence only, not a substitute for the end-to-end purchase.

## Honest limitations

* The binding between payment and purchase is a payer-signed application statement, not an on-chain commitment (same as Sui). A signed transaction that leaks remains executable until its nonce is used; late funding after expiry is accounted as unapplied liability and cannot trigger commerce.
* USD₮0 on X Layer Testnet is an upgradeable proxy. Its implementation can change; the gateway pins address, decimals and symbol, not bytecode.
* On-chain testnet settlement does not pay a real merchant; Shopify remains a sandbox with simulated payment capture, exactly as on every other rail.
* Reorg risk is bounded by the confirmation depth (default 2 blocks), not by L1 finality.

## Verification (13 October 2026, local; no deployment, no mainnet)

| Check | Result |
| --- | --- |
| `tsc` backend, console, payer build; `npm run build`; `git diff --check` | PASS |
| Focused X Layer acceptance suite (13 files) | PASS 306/306; see [independent acceptance report](XLAYER_ACCEPTANCE_20261013.json) |
| Core/HTTP/native PostgreSQL integration (`tests/integration/xlayer-funding.test.ts`): explicit option selection + 1:1000 scaling, concurrent fund requests → one broadcast/one funding/one merchant run, loss before verify → exact-candidate resume, loss after acceptance → recover without rebroadcast, late confirmation after expiry → unapplied liability and no merchant, confirmed revert → capacity released, nonce superseded → closed without payment, ambiguous broadcast → 202 pending then recovered without rebroadcast, signed replay into a second purchase → 409 | PASS 8/8 |
| PostgreSQL ledger + migration `0014` + registration (`xlayer-wallet-ledger.test.ts`): identity required, append-only guards, cap race across processes, lost lock session signs nothing, registration disabled + pinned policy | PASS 4/4 |
| MCP/multiwallet DB matrix (retail/hotel/flight × cardano/solana/sui/xlayer) | PASS 20/20 |
| Regression (48 files, 692 tests): contracts, Sui/Solana/Cardano unit + integration, MCP, funding recovery, scaled settlement, wiring, wallet ledgers, hosted MCP, PostgreSQL | PASS (the single failure was the pinned rail list in the wiring test, updated) |
| Console tests (11 files, 124) and production build | PASS |
| Live read-only exercise against the real testnet RPC: `assertNetwork`, `assertAsset`, `latestBlock`, block timestamp, fee caps (base fee 0.02 gwei), pending/historical nonce, absent tx/receipt → null, token balance | PASS |
| `npm run e2e:xlayer -- <env> --preflight` (real RPC readiness + Shopify sandbox search, no purchase) | PASS: `EXTERNAL_CHECK_PASSED`, 1 offer |
| **Genuine testnet transfer + Shopify sandbox order (`--execute`)** | **PASS — fresh nonce-1 transfer, verified receipt and Transfer event, Shopify #1007 simulated capture; idempotent replay reused the transaction** |

The dedicated payer (`0x8e1c8d2f595444b895f022f5f88746b8aceb9105`) and treasury (`0xee38198cce4e690aa24e36c74f678f7ca7185888`) were generated by `payer:xlayer:setup`; keys, ledger and env live outside Git in `C:\Users\sethl\.capsule\xlayer-testnet-20261013`. A read-only `eth_call` simulation shows `mint` is owner-only on USD₮0, and the OKX faucet page documents OKB only. The independently accepted fresh run is recorded in [XLAYER_ACCEPTANCE_20261013.json](XLAYER_ACCEPTANCE_20261013.json). Its Shopify PAID state is simulated merchant capture, not real merchant settlement. Do not repeat a distinct purchase as part of this acceptance.
