# Coinbase CDP Operational Treasury Lane

Base: `0234d20a11e80285318c88511195c5f2d51c0df8`

Branch: `feat/coinbase-cdp-treasury`

## Role and boundary

This is a CDP-managed Capsule operating wallet demonstration. It is separate from Cardano and Solana customer purchase principal. The lane uses Coinbase's current API Key Wallet SDK, which keeps wallet private keys in Coinbase's Trusted Execution Environment; Capsule receives the public addresses and keeps only the API key ID, API key secret, and Wallet Secret in its private process environment. No wallet private key is exported or written to Capsule files.

The fixed network is Base Sepolia. Capsule's named test treasury and named test recipient are provisioned in the CDP project. Provisioning creates or reuses those names, creates an account-scoped CDP policy, applies it to the treasury, and saves only public identity metadata. Provisioning and balance reads do not sign or send transactions. The optional `--test-transfer` action sends exactly `0.000001 ETH` to the named Capsule recipient. It is a treasury test transfer, never a customer purchase payment.

## Commands and local setup

Copy `.env.cdp.example` into a private environment configuration and set the three CDP credentials plus absolute paths for the public identity and action history. The history directory must be on durable storage with access restricted to the operator account. On Windows, enforce and verify its ACL explicitly; POSIX file mode `0600` alone cannot establish Windows ACL safety. The lane never creates a missing history file during a transfer. `--provision` initializes one only if absent and never replaces an existing or corrupt history.

```powershell
npm run cdp:treasury -- --provision
npm run cdp:treasury -- --read
npm run cdp:treasury -- --test-transfer
```

`--provision` makes CDP wallet and policy API calls but does not spend. `--read` returns the operator readiness projection and Base Sepolia ETH balance. There is no startup action. The transfer command is the only path that submits a transaction.

## Spend and recovery controls

- The sender and recipient names are constants in the adapter. The recipient is resolved from the same CDP project and its public identity is checked before actions.
- The network is fixed to `base-sepolia`; the transfer amount is fixed to `10^12` wei (`0.000001 ETH`). The CDP account policy accepts only this recipient, this action ceiling, and this network. The local action history limits the entire demonstration to one transfer.
- A protected exclusive lock serializes action attempts. The history is atomically updated with the fixed idempotency key before CDP submission. A process crash can leave a lock file; the next action stops until an operator reconciles the lock and chain state.
- A CDP response with unknown outcome retains the reservation. An explicit repeat uses the same CDP idempotency key and identical transaction payload, then independently checks Base Sepolia transaction and receipt fields. If a hash is known, retries only read it back. A confirmed action cannot run again.
- Output contains public addresses, balance, policy ID, status, and transaction hash only. Provider error bodies and signing material are never printed.

## Official product and track research (2026-10-07)

- Current server-side API Key Wallet docs prescribe `@coinbase/cdp-sdk` with API key ID, API key secret, and Wallet Secret. The official npm package was v1.57.0 during research and is pinned exactly here.
- SDK v1.57.0 type declarations show `base-sepolia` supports token balance listing, faucet requests, and transaction sends; `sendTransaction` accepts an idempotency key. Its EVM account API supports stable named `getOrCreateAccount` accounts. The policy API supports account-level rules and the account API supports attaching that policy.
- The official quickstart documents testnet ETH faucet funding and transaction submission. This lane does not request faucet funds automatically. Any faucet action remains an operator action outside the transaction command.
- The TOKEN2049 Origins 2026 public page lists broad build categories (DeFi, infrastructure, NFTs, AI) and requires code/prototype work to start after the hacking period begins. No public Coinbase-specific 2026 challenge wording was found. Confirm any Coinbase prize/track eligibility with the event's private challenge page or organizer before making that claim.
- CDP Node is not required for this adapter. If later enabled, current official docs state a payment method is required beginning January 2026; the listed allowance is 10 million billing units monthly, then $0.50 per million, with 7,500 units per five seconds per project.

## Status and evidence

Current status: **PARTIAL / blocked on private CDP credentials and track confirmation**. User-level and machine-level environment name inventories, the canonical `.env.local` key-name inventory, and the prior local `.env` checkout contained no CDP credential names. No credential values were read. No CDP API call, wallet creation, faucet request, or transfer was attempted in this lane.

Local contract tests and TypeScript checks are recorded in `docs/evidence/coinbase-cdp/local-checks.json`. A real authenticated wallet proof requires private environment injection of `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET`, then explicit provisioning, independent balance readback, and (if still desired) one invocation of `--test-transfer`.

## Review findings

- **Investigate Now** — Confirm the 2026 Coinbase challenge requirements. The public event page does not establish a Coinbase-specific track; claiming prize eligibility without the private challenge wording could misstate track fit. Defer the claim until the organizer/challenge page confirms it.
- **Act Now** — Configure the protected durable identity/history directory and verify Windows ACLs before any transfer. If it is not protected or durable, local history could be lost or modified and the one-action cap/replay guard would not be dependable.
- **Investigate Now** — A stale `.lock` intentionally blocks all future action. Inspect history and public chain evidence before removing it; clearing it blindly risks an unsafe replay.
