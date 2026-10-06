# Solana Devnet funding — completed checkpoint

State: real funding lane **PASS**, fixture commerce **PASS**, tests/build **PASS**. Branch `codex/solana-funding`, isolated worktree `C:/Users/sethl/.codex/worktrees/solana-funding/token2049-origins`, base `0afd377681fe0e27e0ea86cf2cfaa34cdb970769`. No merge, production deployment, mainnet transaction, or shared environment modification occurred.

## Behavior and boundaries

The runtime registers the real Solana adapter alongside Cardano. Missing/invalid Solana configuration disables only this rail. Shared funding/core contracts, financial schemas and Cardano behavior are unchanged.

The lane uses official **x402 v2 `exact` SVM** requirements/payload/header encoding, `@x402/svm@2.26.0` and `@solana/kit@5.1.0`. The official client builds the v0 transaction, official facilitator verifies and settles it, and the gateway separately reads finalized Devnet execution and historical token balances. No custom protocol is labelled x402.

**Provided payer prerequisite:** before submitting `PAYMENT-SIGNATURE`, the payer calls the authenticated local facilitator `/prepare` extension to obtain the sponsor signature. This is required because the existing synchronous core `prepare` contract must persist Solana's canonical transaction signature before broadcast. `/prepare` reserves fees and co-signs but does not submit. Requirements `extra.preparation`, facilitator `/supported`, readiness detail and this document explicitly advertise that prerequisite. A stock unmodified x402 client that sends only its own partial signature is unsupported; real wire compatibility does not establish plug-and-play stock-client interoperability.

Three roles remain separate:

- Gateway: no wallet key bytes; persists candidate signature and reads independent chain evidence before journal/commerce.
- Payer CLI: its configured key only; exact policy, cumulative amount/fee history and immutable retry header in a protected shared ledger.
- Authenticated loopback facilitator: separate sponsor key only; official scheme plus strict program/account, fee and commitment policy; shared fee reservation before signing.

## Financial invariants

Only official `https://api.devnet.solana.com`, the full Devnet genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, canonical x402 CAIP-2 network `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`, exact standard SPL Token mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`, and 6 decimals are supported. This is valueless Devnet notional; no USD parity/redemption claim is made.

The SHA-256 memo commits network, mint, decimals, treasury owner and token account, exact base-unit total, purchase/quote IDs, quote digest, resource URL, expiry and independently validated principal/fee settlement breakdown. The full 256-bit hash uses base64url, keeping its 47-byte UTF-8 memo within the SDK default compute budget. Hex encoding was rejected by live simulation because the 68-byte memo exceeded that budget; no broadcast occurred for those rejected candidates.

Policy requires exactly four instructions: bounded compute limit, bounded price, standard `TransferChecked`, and exactly one memo. No lookup tables, additional programs/accounts/signers, ATA creation, fee-payer fund access, or Token-2022 extensions. Both required signatures are locally verified using the official SDK decoder. The sponsor never occurs in instruction accounts. Amounts and fees use exact integer/base-unit math.

Gateway candidate is durable before settlement; sponsor/payer entries precede signing/send. Retries preserve identical message, signature and header. Core advisory locking and globally consumed references prevent duplicate settlement/journal application. After an ambiguous core attempt, recovery reads only the persisted reference and cannot submit again.

Only **finalized**, successful on-chain execution with the exact signature, instruction/memo binding, historical source mint/owner/decimals/exact debit and historical destination mint/owner/decimals/exact credit yields confirmed evidence. `confirmations:null` denotes Solana finality, not an invented numeric depth. Later source or destination ATA closure does not invalidate historical received funds. Expiry is rechecked after awaited verification and immediately at payer signing, sponsor signing and broadcast. Already received late/late-observed funds are still liabilities; the core records them as unapplied/refundable and prevents commerce.

Wallet ledgers are owner-address-specific under one absolute configured directory, locked across processes with exclusive creation, fsynced and atomically replaced. Missing, corrupt, duplicate, differently owned, linked or insufficiently protected history fails closed. Windows ACLs restrict files to the current user, SYSTEM and Administrators. Initialization scans complete retained finalized wallet history, with a bounded maximum that aborts rather than truncates; each new signing reservation reconciles external history. Gross outbound token transfers are counted even when simultaneous incoming tokens mask the net change. Fees, old history and failed/unbroadcast reservations are retained conservatively. A crashed lock or incomplete reservation requires manual reconciliation; no automatic reset or new transaction is generated.

## Real execution evidence

One actual transaction funded a commercial fixture hotel principal of **USD 1.00** and service fee **USD 0.05**, disclosed `1:1000` testnet scale: principal **1000**, fee **50**, total **1050** base units. Sponsor paid **10001 lamports**. Caps were 10000 base units per purchase/cumulative, commercial ceiling 1000 USD cents, and cumulative sponsor fee cap 100000 lamports; no shared environment file was changed.

Actual gateway HTTP, PostgreSQL/core, separate payer process, authenticated sponsor, official SDK and real Devnet funding passed. Merchant search, quote, booking and merchant payment were explicitly **fixtures**; receipt reports `providerEnvironment:fixture` and `merchantPaymentStatus:simulated_paid`. Funding evidence separately reports `fresh_external`. No real Nuitee booking/card charge/bank settlement is claimed.

- Execution timestamp: `2026-10-06T14:20:52.634Z` (22:20 Singapore).
- Signature: `4tY5vmXqeQKPBnwRPU97FEKQDpksxr1SHEHvEMg4WLM8dTyGjWBZw4kK585EbKvvusUwH1JjYVi3zqNv1rqm8X8c`.
- Finalized slot: `508121205`.
- Historical payer balance: `20000000 -> 19998950`; treasury: `20000000 -> 20001050`, exact opposing 1050-unit deltas.
- Raw transaction SHA-256: `99dd0972f846da93417aa6233adc891e04397bc8c4745e80ca8debc0a94581a3`.
- Funding evidence count: 1; fixture merchant execution count: 1; repeat funding HTTP status: 409.
- Independent read-only recheck after final hardening: `2026-10-06T14:53:43.224Z`. No second live transfer was run.
- Final implementation content SHA-256: `bacefe4dde99878d2d9ea3ed96945ec4085f19e4acd27ee8a2a4ab3c564b2e27` (ordered implementation/manifest paths/bytes in `scripts/solana/verify-live.ts`).
- Sanitized artifact: `docs/work/SOLANA_LIVE.json`, SHA-256 `171f05267fea9311bb1677b1a09b02a41e5cf7d110fa1aaed5a2b88f29d772d0`.

Initial readonly RPC throttling and fixture approval-ceiling correction caused no signing/broadcast. Two long-memo simulation failures reserved partial payer candidates but did not obtain sponsor/send success. Their history remains. Final payer ledger committed amount is 3150 base units, including those two rejected 1050 reservations and the one paid 1050. Sponsor ledger retained four historical entries plus this payment; total committed fee 15001 lamports. These protected files and all private keys/tokens are ignored and are not in Git.

## Files changed

- `src/funding/solana/{adapter,config,index,rpc,wire}.ts`: real funding port, official wire decoding, independent RPC evidence, exact binding and configuration.
- `clients/solana/{config,facilitator,ledger,pay,policy,signer}.ts`: separate bounded payer/sponsor, common ledger and secret loading.
- `src/wiring.ts`: minimal additional rail registration.
- `.env.solana.example`, `package.json`, `package-lock.json`: explicit supported configuration, pinned official dependencies and CLI scripts.
- `scripts/solana/{setup,live-e2e,verify-live}.ts`: non-signing protected history setup, real isolated E2E, and existing-transaction read-only recheck.
- `tests/support/solana.ts`, `tests/unit/solana-{funding,ledger,sponsor}.test.ts`, `tests/integration/solana-funding.test.ts`, `tests/integration/wiring.test.ts`: signed negative/finality/recovery/financial checks and runtime registration expectation.
- This completion report and sanitized live evidence.

## Validation

Ordinary clean `npm ci` without flags: PASS (252 packages, zero audit findings). Root TypeScript remains 6.0.3. Final `tsc -p tsconfig.json --noEmit`: PASS. Final build compiler and migration copy: PASS. Full Vitest suite: **536/536 tests, 30/30 files PASS**, including existing Cardano/core/funding/MCP regressions and 22 Solana-specific checks. Diff hygiene: PASS. Exact changed/staged-files/root-secret/generated-token scan: PASS. Initial substring findings were limited to an existing public repository identity coinciding with a configured development-store password; exact credential occurrences outside that pre-existing identity and generated bearer tokens were absent.

Solana checks include exact/wrong mint, amount, recipient, quote, network, genesis, expiry and cryptographic signature; missing finalized data; expiry crossing awaited verification/sign/send boundaries; response loss and process restart with one settlement; concurrent core funding; one journal application; late refundable liability; source/treasury account closure; owner/history corruption, exclusive ledger locking, cumulative caps, and gross-outbound history reconciliation. Offline RPC mocks are explicitly distinguished from the real execution above.

## Supported local setup and use

Keep gateway, provided payer and authenticated loopback sponsor on the configured local machine. Put configuration in an ignored `.env.solana.local` using `.env.solana.example`; provide the application's PostgreSQL/core configuration separately. Both payer and sponsor must use **the same canonical protected ledger directory** for these wallet addresses. Reuse this worktree's existing ledger directory when continuing this signer; if integrating elsewhere, perform a controlled migration that preserves every entry/lock/candidate. Never initialize another empty ledger to regain headroom. Keep key/token files outside Git and protect the gateway token too.

Install with ordinary `npm ci`. The exact official Solana Kit 5.1.0 pin is within x402's supported range, matches its program packages' Kit 5 peers, and permits the repository's TypeScript 6 compiler. No override, legacy-peer flag, npm configuration, or compiler downgrade is required. The one live submission used Kit 6.1.0; after selecting the compatible final 5.1.0 pin, ordinary clean install, all 536 tests, build, and independent read-only verification of the existing finalized transaction passed. No additional transfer was made. Both dependency sets are explicit in the sanitized evidence.

PowerShell examples (replace only the purchase ID and configured paths):

```powershell
& 'C:/Program Files/nodejs/node.exe' --env-file='.env.solana.local' --import tsx scripts/solana/setup.ts
& 'C:/Program Files/nodejs/node.exe' --env-file='.env.solana.local' --import tsx clients/solana/facilitator.ts
& 'C:/Program Files/nodejs/node.exe' --env-file='.env.solana.local' --import tsx src/main.ts
& 'C:/Program Files/nodejs/node.exe' --env-file='.env.solana.local' --import tsx clients/solana/pay.ts 'pur_REPLACEWITHPURCHASEID'
```

Run sponsor and gateway in separate processes. `/prepare` requires the same protected facilitator bearer token that gateway and payer load from `SOLANA_FACILITATOR_TOKEN_FILE`. Ordinary application API authentication stays separate in `SOLANA_GATEWAY_TOKEN_FILE`. The provided payer validates the declared preparation endpoint against its fixed configured facilitator before granting authority.

`npm run e2e:solana` is a **spending harness**, not a read-only readiness probe. It explicitly selects fixture merchants, creates an isolated PostgreSQL schema and preserves wallet ledgers. Do not rerun merely to reconfirm the current evidence. Read-only command:

```powershell
& 'C:/Program Files/nodejs/node.exe' --import tsx scripts/solana/verify-live.ts 'C:/Dev/token2049-origins/.env.local'
```

## Remaining issues and integration notes

| Classification | Issue / why it matters | Recommended action | Risk of deferral / acceptance |
|---|---|---|---|
| Act Now | None remaining in this scoped Devnet checkpoint after peer-review fixes. | Review and integrate the tested commit and preserved runtime history. | No outstanding known blocker to the provided local payer flow. |
| Investigate Now | `/prepare` is an application co-sign prerequisite, not the stock x402 client flow. | Use the provided payer. Before promising third-party client support, design a scoped async candidate preparation or equally durable canonical recovery flow. | Stock clients with only payer signatures are rejected; no claim of universal interoperability. |
| Park for Later | Stale signer locks/incomplete reservations and definitely expired unbroadcast candidates need operator reconciliation; caps deliberately retain them. | Add a separately reviewed recovery tool with proof-based release of reservations, never file deletion/reset. | Lower remaining demo headroom; safety is retained, not silent extra spending. |
| Park for Later | Mainnet, Token-2022, ALTs, smart wallets, remote/distributed sponsor hosting and non-local ledgers are outside this implementation. | Keep this lane restricted to supported Devnet/local processes. Design/test these as distinct milestones if requested. | Those clients/deployments fail policy checks or are unsupported. |
| Ignore / Accept Risk | Public Devnet RPC can throttle. SDK requests may fail even though gateway read-only RPC has bounded retries. | Retry the same immutable candidate; recover persisted transfers independently. | Delay/manual attention; no new transaction or lost cap history. |
| Ignore / Accept Risk | A privileged operator can edit local config/history or independently use a signer outside this shared ledger. | Keep sole signing access and one canonical ledger directory; preserve history during integration. | Cross-process guarantees apply to configured processes using that ledger, not an administrator bypassing it. |

Next task: review/cherry-pick this isolated checkpoint into the canonical hardening branch; retain the protected ledger history and configure both processes before selecting Solana. Do not rewrite Cardano, merchant adapters, Masumi or schemas. Use a fresh chat for integration if combining other rail milestones; same chat is sufficient for a small review of this checkpoint.

Primary sources inspected: [x402 exact SVM specification](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md), [official SVM client](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/svm/src/exact/client/scheme.ts), [official facilitator](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/svm/src/exact/facilitator/scheme.ts), [Solana transactions](https://solana.com/docs/core/transactions), [Solana getTransaction RPC](https://solana.com/docs/rpc/http/gettransaction). Installed pinned SDK source was also inspected for memo enforcement, signature verification, and sponsor isolation.
