# Coinbase CDP Operational Treasury Lane

Base: `0234d20a11e80285318c88511195c5f2d51c0df8`

Branch: `feat/coinbase-cdp-treasury`

## Role and boundary

This is a CDP-managed Capsule operating wallet demonstration. It is separate from Cardano and Solana customer purchase principal. The lane uses Coinbase's current API Key Wallet SDK, which keeps wallet private keys in Coinbase's Trusted Execution Environment; Capsule receives the public addresses and keeps only the API key ID, API key secret, and Wallet Secret in its private process environment. No wallet private key is exported or written to Capsule files.

The fixed network is Base Sepolia. Capsule's named test treasury and named test recipient are provisioned in the CDP project. Provisioning creates or reuses those names, creates an account-scoped CDP policy, applies it to the treasury, and saves only public identity metadata. Provisioning and balance reads do not sign or send transactions. The optional `--test-transfer` action sends exactly `0.000001 ETH` to the named Capsule recipient. It is a treasury test transfer, never a customer purchase payment.

## Commands and local setup

Copy `.env.cdp.example` into a private environment configuration and set the three CDP credentials plus absolute paths for the public identity and action history. On first explicit provisioning, the history directory ACL is restricted to the current operator account and verified. POSIX directories are set to `0700`; history files use `0600`. Existing history ACLs are verified, never repaired silently. Store the directory on durable storage. The lane never creates a missing history file during a transfer, and provisioning fails before API writes if an existing public identity has lost its history.

```powershell
npm run cdp:treasury -- --provision
npm run cdp:treasury -- --read
npm run cdp:treasury -- --test-transfer
```

`--provision` makes CDP wallet and policy API calls but does not spend. `--read` returns the operator readiness projection and Base Sepolia ETH balance. There is no startup action. The transfer command is the only path that submits a transaction.

## Spend and recovery controls

- The sender and recipient names are constants in the adapter. The recipient is resolved from the same CDP project and its public identity is checked before actions.
- The network is fixed to `base-sepolia`; the transfer amount is fixed to `10^12` wei (`0.000001 ETH`). The CDP account policy accepts only this recipient, this action ceiling, and this network. The local action history limits the entire demonstration to one transfer.
- A protected exclusive lock serializes action attempts. The history is atomically updated with its persisted UUIDv4 idempotency key before CDP submission. A process crash can leave a lock file; the next action stops until an operator reconciles the lock and chain state.
- A CDP response with unknown outcome retains the reservation. If the transaction hash is unknown, subsequent commands never resubmit; they stop for read-only operator reconciliation. If a hash is known, commands only read it back from Base Sepolia. A confirmed action cannot run again.
- The account policy accepts only the named recipient, fixed action ceiling, and Base Sepolia, followed by explicit reject rules for other EVM sends and signing operations. Provisioning refuses to attach a new policy if the dedicated treasury already has any policy, avoiding changes to previously broader wallet authority.
- Output contains public addresses, balance, policy ID, status, and transaction hash only. Provider error bodies and signing material are never printed.

## Official product and track research (2026-10-07)

- Current server-side API Key Wallet docs prescribe `@coinbase/cdp-sdk` with API key ID, API key secret, and Wallet Secret. The official npm package was v1.57.0 during research and is pinned exactly here.
- SDK v1.57.0 type declarations show `base-sepolia` supports token balance listing, faucet requests, and transaction sends; `sendTransaction` accepts an idempotency key. Its EVM account API supports stable named `getOrCreateAccount` accounts. The policy API supports account-level rules and the account API supports attaching that policy. See Coinbase's [API Key Wallet quickstart](https://docs.cdp.coinbase.com/wallet-api/v2/introduction/quickstart), [policy API schema](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/policy-engine/create-policy), and [EVM account update API](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/evm-accounts/update-an-evm-account).
- Coinbase's [API conventions](https://docs.cdp.coinbase.com/api-reference/payment-apis/conventions) specify UUIDv4 idempotency keys. Their current schema exposes `accept`/`reject`, operation names, and per-operation criteria; Capsule puts a narrow accept rule before explicit empty-criteria reject rules so the permitted action matches before the reject-all fallback. A dedicated account with any pre-existing policy is left untouched.
- The official quickstart documents testnet ETH faucet funding and transaction submission. This lane does not request faucet funds automatically. Any faucet action remains an operator action outside the transaction command.
- The TOKEN2049 Origins 2026 public page lists broad build categories (DeFi, infrastructure, NFTs, AI) and requires code/prototype work to start after the hacking period begins. No public Coinbase-specific 2026 challenge wording was found. Confirm any Coinbase prize/track eligibility with the event's private challenge page or organizer before making that claim.
- CDP Node is not required for this adapter. If later enabled, current official docs state a payment method is required beginning January 2026; the listed allowance is 10 million billing units monthly, then $0.50 per million, with 7,500 units per five seconds per project.

## Status and evidence

Current status: **PARTIAL / blocked on private CDP Wallet credentials and track confirmation**. Process/user/machine environment name inventories, recent Downloads and `C:\Dev` config-file key-name inventories, PowerShell profile names, and canonical `.env.local` key names contained no CDP Wallet credentials. A recent portal sandbox API-key page may refer to a separate product surface; it has not been assumed to authenticate API Key Wallet. No credential values were read. No CDP API call, wallet creation, faucet request, or transfer was attempted in this lane.

Local contract tests and TypeScript checks are recorded in `docs/evidence/coinbase-cdp/local-checks.json`. A real authenticated wallet proof requires private environment injection of `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, and `CDP_WALLET_SECRET`, then explicit provisioning, independent balance readback, and (if still desired) one invocation of `--test-transfer`.

## Review findings

- **Investigate Now** — Confirm the 2026 Coinbase challenge requirements. The public event page does not establish a Coinbase-specific track; claiming prize eligibility without the private challenge wording could misstate track fit. Defer the claim until the organizer/challenge page confirms it.
- **Act Now — resolved** — Use UUIDv4 idempotency keys accepted by CDP's current API. Non-UUID keys can be rejected, preventing safe transaction creation; policy/create/update and transfer keys now conform, while the transaction key is persisted before submission.
- **Act Now — resolved** — Never resend after an unknown transaction result without a hash. CDP idempotency retention is not established as an unlimited deduplication guarantee; unknown/pending reservations now block all resubmission and require read-only reconciliation.
- **Act Now — resolved** — Do not recreate missing action history for a provisioned wallet. Doing so resets the one-action cap; provisioning now checks identity/history consistency before any API writes and fails closed.
- **Act Now — resolved** — Suppress arbitrary provider exception text. It may contain authorization material; the CLI now prints only exact safe usage/credential messages or a generic sanitized failure.
- **Act Now — resolved** — Enforce history ACLs and reject symbolic links. A writable or shared history can defeat spend caps and replay safety; first provisioning restricts the configured directory and all operations validate directory/file ACLs and Unix modes.
- **Act Now — resolved** — Make the account policy fail closed. The official schema exposes `accept` and `reject` actions but does not describe unmatched-rule behavior; the policy includes explicit reject-all rules for EVM send and signing operations, and provisioning refuses wallets with any pre-existing attached policy.
- **Investigate Now** — A stale `.lock` intentionally blocks all future action. Inspect history and public chain evidence before removing it; clearing it blindly risks an unsafe replay.
