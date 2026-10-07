# Capsule

<img src="assets/brand/capsule-wordmark-accent.webp" alt="Capsule" width="280">

**Any agent. Agent-native money in. Ordinary commerce out.**

Capsule is a commerce gateway for AI agents. Your existing assistant finds offers, presents an exact quote and asks for approval; Capsule coordinates payment, provider execution and verification. The Capsule console lets you follow the transaction and inspect its result.

**Capsule is a TOKEN2049 Origins hackathon prototype. It is not available for public use.** The hosted evaluation below is for authorised TOKEN2049 judges, not an open signup or a production purchasing service.

## Start here

| I want to… | Read |
| --- | --- |
| Understand the problem, solution, stack and submission | [PROJECT_SUBMISSION.md](PROJECT_SUBMISSION.md) |
| Review the Main track | [Main-track submission](PROJECT_SUBMISSION.md#main-track) |
| Review Cardano / Agentic Commerce | [Cardano submission and evidence](PROJECT_SUBMISSION.md#cardano) |
| Review Best Use of Solana | [Solana submission and transaction](PROJECT_SUBMISSION.md#solana) |
| Review Best Workflow with CRE | [Chainlink submission and simulation](PROJECT_SUBMISSION.md#chainlink) |
| Understand the technical design | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Review the visual system | [DESIGN.md](DESIGN.md) |
| Find setup, contracts, runbooks and retained evidence | [Documentation index](docs/DOCS_INDEX.md) |

**Track judges:** all three partner write-ups are in `PROJECT_SUBMISSION.md`; there are no separate partner submission documents.

<a id="judge-quick-start"></a>
## TOKEN2049 judges — try Capsule

You need a ChatGPT account/workspace that permits custom MCP connections, plus privately supplied Capsule evaluation access. The MCP consent passcode and the console access key are different credentials. Neither belongs in this repository or in a chat prompt.

### 1. Connect the MCP

In ChatGPT, add a custom MCP server using the [official connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt). Current interfaces use **Plugins → + → Add custom MCP server**; workspace permissions and older interfaces can differ.

| Setting | Value |
| --- | --- |
| Name | `Capsule` |
| Server URL | `https://token2049-origins.onrender.com/mcp` |
| Transport | Streamable HTTP |
| Authentication | OAuth |
| Client ID / secret | Leave empty for dynamic registration |

Complete Capsule's consent screen with the evaluation access supplied privately by the team. Enable Capsule in a new conversation. Capsule's own connection/authentication implementation is documented in [hosted MCP](docs/channels/hosted-mcp.md).

### 2. Ask your assistant

Start with a search, for example:

> I forgot my travel adapter. Find me a universal travel adapter for around S$35.

Choose an offer, review the exact total, select an available payment method and explicitly approve the quote before purchasing. Inventory, shipping and fees can change; the search price is not the final quote. This example does not promise same-day delivery.

The inspected hosted MCP supports automatic **Cardano** funding. Solana has a separately verified supplied-payer path; it is not advertised here as a one-click hosted payment option. See the [Solana evaluation boundary](PROJECT_SUBMISSION.md#solana).

### 3. Watch it happen

Open the [Capsule console](https://token2049-origins.onrender.com/console/) and enter the separately supplied console access key. Use the same evaluation customer as your MCP session to see its purchases.

The console is read-only: it shows progress, payment, merchant confirmation and receipts. Approvals remain in your assistant. The hosted service can take time to wake or complete a quote; pending means pending, not a failed or completed purchase.

### Evaluation boundary

Payments use public-testnet assets with no cash value; commerce executes against provider test environments. Shopify discoveries can come from real stores, but demo orders go to Capsule's test store, not the source merchant. Detailed boundaries and evidence are in [PROJECT_SUBMISSION.md](PROJECT_SUBMISSION.md#evidence).

The URLs above are the repository's documented evaluation endpoints, not a new availability certification. Final judge access and the recorded evaluation path are still tracked in the [submission finalisation checklist](PROJECT_SUBMISSION.md#finalisation). Public visitors should use the documentation rather than attempt to obtain evaluation credentials.

## Developers

For configuration and self-hosted development, start with the [documentation index](docs/DOCS_INDEX.md), [environment reference](docs/ENVIRONMENT.md) and [runbook](docs/RUNBOOK.md). Judge evaluation does not require cloning the repository, running a database or providing wallet keys.
