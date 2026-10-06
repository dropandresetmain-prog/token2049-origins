# Partner track orchestration

Common base: `0234d20a11e80285318c88511195c5f2d51c0df8` (fresh `git fetch origin main`, 2026-10-07 Singapore).
Protected canonical checkout: `C:/Dev/token2049-origins`; no checkout switch, main merge, or canonical deployment authorized by this work.
This ledger exists only on `codex/partner-track-orchestration` in `C:/Dev/token2049-origins-orchestration`.

| Lane | Branch / worktree | Goal | Dependencies | External/manual blockers | Acceptance evidence | Checkpoint/head | Next action |
|---|---|---|---|---|---|---|---|
| CRE | feat/chainlink-cre / C:/Dev/token2049-origins-chainlink-cre | Independent read-only commerce proof verification | Official CRE SDK/CLI; retained purchase proof | Track wording and simulation/deploy access under investigation | Pending; local and external proof kept distinct | Common base | Official research, select bounded workflow |
| CDP | feat/coinbase-cdp-treasury / C:/Dev/token2049-origins-coinbase-cdp | Dedicated CDP operational test treasury wallet | Current supported CDP SDK; account/API access | Credential/policy/testnet access under investigation | Pending | Common base | Research current Wallets product and account readiness |
| Sokosumi | feat/sokosumi-marketplace / C:/Dev/token2049-origins-sokosumi | Public read-only MIP-003 marketplace task using native remuneration | Existing native Masumi runtime; HTTPS ingress; listing/platform auth | Listing review/platform auth/access under investigation | Existing fee proof preserved; marketplace proof pending | Common base | Research official auth/listing and read-only task seam |
| Hosted Solana | feat/hosted-solana-mcp / C:/Dev/token2049-origins-hosted-solana | Explicit hosted Solana funding beside Cardano | Existing bounded Devnet payer/sponsor; private durable service | Render billing/secrets/provisioning under investigation; spend NOT authorized | Existing local finalized Devnet proof preserved; hosted proof pending | Common base | Select minimum private topology; implement no-spend preflight |

Lanes do not depend on each other. Lane docs: docs/work/{CHAINLINK_CRE,COINBASE_CDP,SOKOSUMI_MARKETPLACE,HOSTED_SOLANA_MCP}.md.
No historical payer/sponsor/Masumi ledger resets; no commerce reruns; no mainnet funds; no blind resend after ambiguity.
Act Now findings must be fixed before PASS. Other review findings use Investigate Now, Park for Later, Ignore / Accept Risk.
Finish with PASS/PARTIAL/BLOCKED matrix and integration recommendation only. Do not start integration.
