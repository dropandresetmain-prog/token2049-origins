# Capsule

<img src="assets/brand/capsule-wordmark-accent.webp" alt="Capsule" width="280">

**Any agent. Agent-native money in. Ordinary commerce out.**

Web3 should not have to rebuild commerce to participate in it. As agents begin to buy on our behalf, they need a way to connect programmable money to the stores, booking platforms and services people already use.

Capsule is a buyer-side commerce gateway for that connection. An assistant uses one MCP interface to find offers, obtain an exact quote and carry an approved purchase through funding, checkout and confirmation. The user stays in the conversation; the Capsule console shows the transaction taking place.

Retail, flights and hotels demonstrate the same idea: let the agent use a common purchasing interface while the provider keeps its existing commerce workflow. Read the [project story](PROJECT_SUBMISSION.md) for the opportunity, implementation and partner contributions.

**Built for TOKEN2049 Origins. Access is currently limited to judges; public access is not open yet.**

<a id="judge-quick-start"></a>
## TOKEN2049 judges — try Capsule

### Get judge access

Ask the Capsule team at TOKEN2049 for your evaluation access code and console key. The code connects your assistant; the key opens the transaction console.

### Connect your assistant

In ChatGPT, open **Plugins → + → Add custom MCP server** and use these settings. The [OpenAI connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) covers the setup.

| Setting | Value |
| --- | --- |
| Name | Capsule |
| MCP server URL | `https://token2049-origins.onrender.com/mcp` |
| Authentication | OAuth |
| Client ID / secret | Leave blank |

Create the connection, enter your evaluation access code on Capsule's consent screen and approve. Start a new conversation with Capsule enabled.

### Make a request

> I forgot my travel adapter. Find me a universal adapter for around S$40.

Choose an offer, review the exact total and select a payment method. Capsule asks for approval before purchasing. Use Cardano for the hosted walkthrough; the [Solana section](PROJECT_SUBMISSION.md#solana) shows its demonstrated funding and booking flow.

### Watch the transaction

Open the [Capsule console](https://token2049-origins.onrender.com/console/) with your console key. Follow payment confirmation, provider execution and the result, then open the receipt and proof. Your assistant is where you approve; the console is where you see what happened. Longer-running steps continue while the assistant checks their progress.

The demonstration uses public-testnet funds and provider sandboxes. Shopify listings come from real stores; demonstration orders run through Capsule's Shopify test store.

## Read more

**[PROJECT_SUBMISSION.md](PROJECT_SUBMISSION.md)** is the written pitch: the problem, why now, our approach, the complete stack and the partner contributions. Cardano, Solana and Chainlink judges can jump directly to their sections: [Cardano](PROJECT_SUBMISSION.md#cardano) · [Solana](PROJECT_SUBMISSION.md#solana) · [Chainlink](PROJECT_SUBMISSION.md#chainlink).

**[ARCHITECTURE.md](ARCHITECTURE.md)** explains how the transaction engine connects agents, funding and commerce. **[DESIGN.md](DESIGN.md)** covers the visual system. The **[documentation index](docs/DOCS_INDEX.md)** leads to developer setup, contracts, runbooks and technical evidence.
