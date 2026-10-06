# Partner track orchestration

Common base: `0234d20a11e80285318c88511195c5f2d51c0df8` (fresh `git fetch origin main`, 2026-10-07 Singapore).
Newer origin/main discovered after branching: 57fde8a64e3a3065c9db938e2b7c2e07b51309fa (free public HTTPS Cardano payer/PostgreSQL ledger/provisioner). All lanes retain the common base; no rebase/merge. Solana requires reconciliation with removed private bridge helpers; preserve canonical Cardano behavior.

Protected canonical checkout: `C:/Dev/token2049-origins`; no checkout switch, main merge, or canonical deployment authorized by this work.
This ledger exists only on `codex/partner-track-orchestration` in `C:/Dev/token2049-origins-orchestration`.

| Lane | Branch / worktree | Goal | Dependencies | External/manual blockers | Acceptance evidence | Checkpoint/head | Next action |
|---|---|---|---|---|---|---|---|
| CRE | feat/chainlink-cre / C:/Dev/token2049-origins-chainlink-cre | Independent read-only commerce proof verification | Official CRE SDK1.23.0/CLI1.37.0; retained Atlas proof | Deploy account access unproved; detailed track rubric pending | Real Koios Preprod asset/recipient/22870 amount readback; workflow simulation pending | Implementation underway at common base | Build/simulate workflow; primary review |
| CDP PARTIAL | feat/coinbase-cdp-treasury / C:/Dev/token2049-origins-coinbase-cdp | Dedicated CDP operational test treasury wallet | SDK1.57.0; API Key Wallet credentials | CLI keyring sandbox verified; API Key Wallet/Wallet Secret path unproved; no public Coinbase track | 10/10 contract tests + typecheck; authenticated CLI2.0.102 sandbox Accounts list,0accounts; no Wallet API/transfer | ff35547 pushed; deliberate review complete | Human APIKeyWallet access+WalletSecret; real dedicated wallet/policy/testnet proof before PASS |
| Sokosumi PARTIAL | feat/sokosumi-marketplace / C:/Dev/token2049-origins-sokosumi | Public read-only MIP-003 marketplace task using native remuneration | Existing native runtime; remote MPS; fresh task schema | Existing MPS loopback; platform-to-agent auth/nonce unproved; No exact sampledmatch; discoverypagination inconsistent | JSONHTTP200 91/92reported; discoveryincomplete. Full976/976; finalaffected23/23; old fee proof preserved | 5ee7d87 pushed; deliberate review complete | Remote MPS+freshschema/auth then actualmarketplacetask/listingreview |
| Hosted Solana PARTIAL | feat/hosted-solana-mcp / C:/Dev/token2049-origins-hosted-solana | Explicit hosted Solana funding beside Cardano | Existing bounded Devnet payer/sponsor; one private service+1GBdisk | Render No card on file; $7.25/mo; dedicated identities/secrets; spend NOT authorized | Full978/978; final affected70/70; build/typecheck; compiled no-config fail-closed smoke. No hosted proof | c8d8899 pushed; HIGH newermainconflicts | Reconcileprivatehelperslater; human billing/provision then private readiness/restart/MCP no-spend checks |

Lanes do not depend on each other. Lane docs: docs/work/{CHAINLINK_CRE,COINBASE_CDP,SOKOSUMI_MARKETPLACE,HOSTED_SOLANA_MCP}.md.
No historical payer/sponsor/Masumi ledger resets; no commerce reruns; no mainnet funds; no blind resend after ambiguity.
Act Now findings must be fixed before PASS. Other review findings use Investigate Now, Park for Later, Ignore / Accept Risk.
Finish with PASS/PARTIAL/BLOCKED matrix and integration recommendation only. Do not start integration.
