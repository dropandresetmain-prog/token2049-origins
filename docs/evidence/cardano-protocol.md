# Cardano funding and separate payer

Offline safety tests plus one bounded live Preprod funding acceptance completed on 2026-10-06. The merchant was a local fixture; no live hotel, FX or bank settlement is claimed. See [Cardano funding fix evidence](../work/CARDANO_FIX.md). Setup tests generate disposable offline wallet files only and remove them.

Pinned SDKs remain `@x402/*@2.26.0` and `@evolution-sdk/evolution@0.5.14`.

The adapter accepts plain `exact` transfers on `cardano:preprod`. It calls the SDK HTTP facilitator verify and settle before returning evidence. It independently checks Preprod network magic, response transaction hashes, treasury outputs, metadata and newer-block depth using Blockfrost. Unindexed or unavailable independent evidence stays submitted and cannot execute commerce; mismatched outputs or commitments are invalid. A rejected SDK verify never adopts a historic chain transfer. Core owns durable transaction replay consumption and funding application. `prepare(header, requirement)` validates locally and returns the canonical transaction reference without external effects; core must persist that candidate and immutable requirement before calling verify. `recover(reference, requirement)` independently retrieves chain evidence without SDK resettlement and accepts expired immutable requirements only for core recovery/refundable-obligation handling. Never call recover for arbitrary client-supplied hashes; only previously persisted prepared attempts are authorized.

The standard SDK default signer ignores arbitrary application `extra` fields. This payer implements its `ClientCardanoSigner` seam with the pinned Evolution transaction builder's `attachMetadata` method. Metadata label 2049 carries only a SHA-256 digest of this JSON array:

`["commerce-funding-v1", resourceUrl, purchaseId, quoteId, quoteDigest, expiresAt, network, asset, amountBaseUnits, payTo, settlement, chainDecimals]`

New scaled obligations include the validated settlement breakdown and chain decimals. Legacy records
without settlement retain the original ten-element array; their amounts/commitments are never
recomputed from current demo config. The bounded demo payer requires scaled_testnet 1/1000 and exact
commercial/chain arithmetic, and compares the complete breakdown to the purchase funding option.

The adapter recomputes the digest from its immutable requirement, verifies auxiliary data against the signed transaction body's auxiliary hash, then checks Blockfrost `/txs/:hash/metadata`. Changing metadata without changing the body fails the hash check; changing the body invalidates the original witness signature. Compatible payers must produce this application commitment. Unmodified default x402 Cardano wallets fail closed.

## Process and configuration

Gateway imports only `src/funding/cardano`; payer mnemonic loading lives in `clients/payer`. Configure gateway `CARDANO_NETWORK=cardano:preprod`, `CARDANO_FACILITATOR_URL`, `CARDANO_TREASURY_ADDRESS`, `CARDANO_ASSET_UNIT`, `CARDANO_ASSET_DECIMALS`, `BLOCKFROST_PROJECT_ID`; `BLOCKFROST_BASE_URL` defaults to Preprod. Only the exact SDK-default or documented Masumi-dispenser Preprod tUSDM identity supports the USD testnet notional policy; they are distinct assets and cannot substitute for one another. Both require six decimals. New demo settlement uses 1:1000, not parity or FX.

The payer requires `PAYER_GATEWAY_URL`, `PAYER_GATEWAY_TOKEN_FILE`, `PAYER_CARDANO_NETWORK=cardano:preprod`, `PAYER_CARDANO_MNEMONIC_FILE`, `BLOCKFROST_PROJECT_ID`, `PAYER_ALLOWED_ASSET_UNIT`, `PAYER_EXPECTED_PAY_TO`, `PAYER_MAX_PER_PAYMENT_BASE_UNITS`, `PAYER_MAX_DAILY_BASE_UNITS`, `PAYER_MAX_CUMULATIVE_BASE_UNITS`, `PAYER_MAX_FEE_LOVELACE`, `PAYER_MAX_ADA_OUTPUT_LOVELACE`. `PAYER_LEDGER_FILE` is explicitly required, with no relative fallback; use the same absolute protected path for every CLI/bridge process holding this wallet authority. Blockfrost credentials go only to the exact official Preprod API host/path or a deliberately configured trusted loopback proxy. URLs reject credentials/query/fragment; gateway requests reject redirects and always use the configured gateway plus fixed purchase routes. Challenge resources must match the full configured funding URL.

CLI: `node --env-file=.env.payer --import tsx clients/payer/pay.ts --purchase pur_...`.

Bridge: set `PAYER_BRIDGE_TOKEN_FILE` (at least 24 random characters) and optional `PAYER_BRIDGE_PORT` (default 8788), then `node --env-file=.env.payer --import tsx clients/payer/bridge.ts`. It binds 127.0.0.1 and accepts authenticated non-browser `POST /pay` with exactly `{ "purchaseId": "pur_..." }`. It rejects Origin headers and non-loopback Host/remote addresses. It serializes requests; ledger locking also prevents CLI/bridge process races. Responses omit signed headers and keys.

Request/daily/cumulative base-unit caps count the exact settlement total (principal plus scaled fee) in the configured asset. Before signing, the unsigned transaction fee must satisfy `PAYER_MAX_FEE_LOVELACE`; for native-token transfers its treasury ADA output must satisfy `PAYER_MAX_ADA_OUTPUT_LOVELACE`. These incidental tADA caps are per transaction; daily/cumulative caps remain principal asset caps. Fund only a disposable test wallet with a bounded ADA balance. Daily means UTC date; outstanding signing/signed reservations from any date consume today's cap conservatively. Accepted payments consume the acceptance day's cap; the cumulative cap never resets automatically. The ledger is authoritative cap history and signed payload storage, so never delete or share it while spending authority is active. Protect its directory with Windows ACLs; POSIX mode 0600 is only best effort on Windows. Crash locks require manual reconciliation after verifying all payer processes have stopped; never automatically remove a lock or reset reservations to recover capacity.

## Verification and remaining acceptance

Offline tests cover SDK challenge/header round trips; wrong amount/asset/network/payee; expiry/decimal/resource/quote mismatches; real signed CBOR metadata tampering; independent chain metadata/hash/depth; pending confirmations; settlement ambiguity; replay response; caps, cross-process locking, corrupt history, identical retry payloads, and bridge auth/origin/host/request guards.

External acceptance requires a configured reachable x402 v2 exact Preprod facilitator with l1Confirmations >= 1, a Preprod Blockfrost project, controlled treasury address, separately provisioned test-only payer mnemonic, configured gateway token and bridge token, test tUSDM plus fee/min-UTXO tADA, and explicit authorization for a bounded live test transfer. The bounded acceptance evidence is recorded in the linked work report. A facilitator losing settlement state can reject ordinary retry verification because inputs are spent. The core recovery path must use a previously durably prepared reference to independently retrieve accepted chain evidence; arbitrary unprepared hash adoption remains forbidden.

## Demo settlement policy

The hackathon demo uses a disclosed **1:1000 notional scale** for public-testnet stablecoins:
USD 183.40 commercial principal -> 0.183400 tUSDM on Cardano Preprod (183,400 base units at 6 decimals).
These test assets have no real-world value. This is a testnet notional scale, not an FX rate.
The chain transfer demonstrates payment authorization, amount binding, transaction settlement,
purchase gating and reconciliation. It does not prove USD redemption, crypto-to-fiat conversion,
Visa settlement, bank settlement or equivalent economic value. Provider sandbox commerce continues
at its full commercial test amount. SERVICE_FEE_BPS remains 0 by default; a configured non-zero fee
uses the same scale as principal.

Canonical secret-free scenario data: [demo/demo-data.json](../../demo/demo-data.json), validated by
[src/demo/config.ts](../../src/demo/config.ts). Runtime endpoints, secrets, exact asset identities,
protocol constants and independent signer/security caps remain runtime configuration or code.
See [current settlement decision](../decisions/scaled-testnet-settlement.md).
