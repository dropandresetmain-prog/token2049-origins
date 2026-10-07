# Human ChatGPT, Cardano and Shopify — retained run

Observed 7 October 2026. The controller verified a completed Cardano-funded Shopify sandbox purchase and a fresh MCP response of **ORDER CONFIRMED**. Full human acceptance remains **PARTIAL**: the approval transcript and authorization to raise the original S$35 budget to S$40 were not captured. The completed backend outcome is not a claim that the original budget or approval UX passed.

| Fact | Retained value |
| --- | --- |
| Purchase | pur_01M4B0089ZRHS1J0MGMHA8Z9D5 |
| Quote | quo_01M4AZYSQQ6T6WX9PX6MPN6VZA |
| Funding option | fop_01M4AZYSQQR19E89PYC7H0GQQZ |
| Cardano Preprod transaction | d7f24c68b37613342390ff5e5a6b1510e9c22e375c9ed2723fcb5d50231c5a53 |
| Test-token amount | 27,990 base units / 0.027990 tUSDM |
| Commercial amount | USD 27.99 / S$35.78 at reference USD/SGD 1.2781 |
| Funding | confirmed and applied; one confirmation recorded |
| Shopify order | gid://shopify/Order/18934659776569 |
| Receipt | rcp_01M4B05156B4F3PJFN861M9SN3 |
| Purchase / commerce state | succeeded / paid |
| Merchant payment state | simulated_paid |
| Execution attempts | one, succeeded |
| Proof | complete; Shopify Admin GraphQL readback recorded |
| Run source SHA | 5343235ebe6c341abdda95450065950a3d1051b7 |
| Console merchant-copy fix SHA | 2833c79b0d423cf58fe28142d27bdc510a9bb0a0 |

The selected source merchant was ORICO. Capsule executed the equivalent order in its Shopify test store; ORICO received no order or payment. The payment uses the disclosed 1:1000 testnet notional scale.

Approval-to-receipt latency was 156.492 seconds. Sampled memory reached 508.19 MiB of a 512 MiB limit; no purchase-time restart/OOM was observed. These are retained measurements, not a current benchmark.

Source: the completed human-E2E controller report and its authenticated evidence/proof reconciliation. The private transcript, customer fulfillment data and raw local monitoring files are intentionally excluded. Cleanup performed no new payment or order.

**Investigate Now:** verify the human approval transcript and budget-change authorization before claiming full user-journey acceptance. Deferring preserves a gap in authority evidence, despite the confirmed backend outcome.
