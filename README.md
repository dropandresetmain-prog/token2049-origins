# Capsule

## Hosted multiwallet release — 13 October 2026

The existing Render gateway/MCP/OAuth, console, providers and Neon PostgreSQL remain canonical. The consolidated Render payer now runs Cardano Preprod, Solana Devnet, Sui Testnet and X Layer Testnet. X Layer is enabled as the fourth native-transfer funding rail; hosted migration `0014`, wallet registration and the bounded signing grant are in place. Gateway and payer are live at deployment SHA `f959384e74f20eeee4ebf9dd43b343443a14c1d5`. Existing rail histories, policies, spending limits and settlement semantics were preserved.

Hosted X Layer acceptance completed on 13 October: one approved 0.01795 USD₮0 transfer on chain 1952 used nonce 2, confirmed to the configured treasury, and funded one Shopify sandbox order. The persisted receipt and proof are visible in the [Capsule console](https://token2049-origins.onrender.com/console/#/purchases/pur_01M4RVF618Z2V7WTSF9SRR8WYZ). Shopify's PAID state is simulated merchant capture, not real merchant settlement. See the [hosted release report](docs/work/XLAYER_HOSTED_RELEASE_20261013.json), [rail design and verification](docs/work/XLAYER_RAIL.md), [independent acceptance report](docs/work/XLAYER_ACCEPTANCE_20261013.json), and [integration checkpoint](docs/work/XLAYER_INTEGRATION.md).

Implementation/cutover: [consolidated payer record](docs/architecture/CONSOLIDATED_PAYER.md). Runtime/account evidence: [verified boundaries](docs/architecture/RENDER_MULTIWALLET_RUNTIME_EVIDENCE.md). Historical manual acceptance status remains in the [nine-row sheet](docs/demo/MULTIWALLET_MANUAL_ACCEPTANCE.md).


<img src="assets/brand/capsule-wordmark-accent.webp" alt="Capsule" width="280">

**Any agent. Agent-native money in. Ordinary commerce out.**

Web3 should not have to rebuild commerce to participate in it. As agents begin to buy on our behalf, they need a way to connect programmable money to the stores, booking platforms and services people already use.

Capsule is a buyer-side commerce gateway for that connection. An assistant uses one MCP interface to find offers, obtain an exact quote and carry an approved purchase through funding, checkout and confirmation. The user stays in the conversation; the Capsule console shows the transaction taking place.

**Search → exact quote → explicit funding approval → execution → proof.**

Retail, flights and hotels demonstrate the same idea: let the agent use a common purchasing interface while the provider keeps its existing commerce workflow. Read the [project story](PROJECT_SUBMISSION.md) for the opportunity, implementation and partner contributions.

**Built for TOKEN2049 Origins. The live demo console is public; MCP transactions require an access code.**

<a id="judge-quick-start"></a>
## TOKEN2049 judges — try Capsule

### Get judge access

Open the [live Capsule console](https://token2049-origins.onrender.com/console/) to inspect completed purchases, receipts, proof, Treasury and Connections. **No password required.** The console is read-only.

> **JUDGES: Ask Min Htet directly for the Capsule MCP access code before connecting your assistant.**
> The website needs no password. Enter the MCP code only on Capsule's OAuth consent screen.

### Connect your assistant

Follow the [current OpenAI connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) for your account/workspace, using these settings. Copy any required OAuth redirect URI from the host's setup interface.

| Setting | Value |
| --- | --- |
| Name | Capsule |
| MCP server URL | `https://token2049-origins.onrender.com/mcp` |
| Authentication | OAuth |
| Client ID / secret | Leave blank |

Complete the host's connection flow, enter the access code from Min Htet only on Capsule's consent screen and approve. Select **@Capsule** in a conversation. Account and workspace policies may control access to custom MCP servers.

### Make a request

> I forgot my travel adapter. Find me a universal adapter for around S$40.

Choose an offer, review the exact total and select a payment method. Capsule asks for approval before purchasing. Use Cardano for the hosted walkthrough; the [Solana section](PROJECT_SUBMISSION.md#solana) shows its demonstrated funding and booking flow.

### Watch the transaction

Open the [Capsule console](https://token2049-origins.onrender.com/console/) alongside your conversation; no login is needed. Follow payment confirmation, provider execution and the result, then open the receipt and proof. Your assistant is where you approve; the console is where you see what happened. Longer-running steps continue while the assistant checks their progress.

The demonstration uses public-testnet funds and provider sandboxes. Shopify listings come from real stores; demonstration orders run through Capsule's Shopify test store.

## Read more

**[PROJECT_SUBMISSION.md](PROJECT_SUBMISSION.md)** is the written pitch: the problem, why now, our approach, the complete stack and the partner contributions. Cardano, Solana and Chainlink judges can jump directly to their sections: [Cardano](PROJECT_SUBMISSION.md#cardano) · [Solana](PROJECT_SUBMISSION.md#solana) · [Chainlink](PROJECT_SUBMISSION.md#chainlink). The operator-side financial model is in [Treasury and reconciliation](PROJECT_SUBMISSION.md#treasury).

**[ARCHITECTURE.md](ARCHITECTURE.md)** explains how the transaction engine connects agents, funding and commerce. **[DESIGN.md](DESIGN.md)** covers the visual system. The **[documentation index](docs/DOCS_INDEX.md)** leads to developer setup, contracts, runbooks and technical evidence.

## Quick evidence

| Capability | Retained result | Evidence |
| --- | --- | --- |
| Human ChatGPT → Cardano → Shopify | Payment, order, receipt and proof confirmed; transcript acceptance remains partial | [Human run](docs/evidence/human-cardano-shopify-20261007.md) |
| Cardano → Atlas | Sandbox flight ticketed | [Combined run](docs/evidence/atlas-cardano-combined-pass-20261007.md) |
| Solana → Nuitée | Devnet payment finalized; sandbox booking confirmed using supplied payer | [Combined run](docs/evidence/nuitee-solana-combined-pass-20261007.md) |
| Chainlink CRE | Official simulation; fresh Koios verification | [CRE implementation and evidence](docs/work/CHAINLINK_CRE.md) |
| Coinbase CDP | Server Wallet transfer on Base Sepolia via official CLI | [Public-RPC proof](docs/evidence/coinbase-cdp/server-wallet-proof.json) |
| OCBC | Read-only fiat observation and history | [Observation evidence](docs/evidence/ocbc-protocol.md) |

The [latest hosted activation checkpoint](docs/work/FINAL_ACTIVATION.md) proves Solana migration, permanently blocked historical attempts, dual-rail Atlas and Nuitée executable quotes, and controlled restart recovery. The historical Solana/Nuitée payment-and-booking proof is retained in the combined run linked above. Customer funding, operational crypto treasury and observed fiat state are distinct; operator fiat/crypto reconciliation remains manual.
