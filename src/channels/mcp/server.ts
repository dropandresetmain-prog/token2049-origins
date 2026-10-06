import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from './client.js';
import { BridgeClient } from './bridge.js';
import { secretsOf, type McpConfig } from './config.js';
import { registerTools } from './tools.js';

export const INSTRUCTIONS = [
  'Capsule is a commerce channel with a strict, user-driven flow: find_offers -> user chooses an offer -> create_quote -> user chooses a payment rail and approves the exact quote -> buy -> get_purchase.',
  'SHORTLIST: after find_offers, never pick an offer silently and never call create_quote on your own initiative. Present the best 3 viable options (fewer only if fewer exist), mark exactly ONE as "Recommended", say briefly why (judge from the request of the user and the offers actually returned: fit to the request, price, merchant, expiry), and ask the user which one they want.',
  'QUOTE: call create_quote only after the user chose an offer. It needs real buyer/shipping details from the user; never invent them. Then show the exact terms (merchant total, service fee, payable total, expiry) and the available payment options.',
  'PAYMENT: the user must explicitly select a payment rail/option and explicitly approve the exact quote and that payment choice. Never infer a rail, never default to one, never fall back to another rail. Call buy only after both, passing selectedFundingOptionId, maxTotal and quoteDigest from the quote.',
  'OUTCOME: offers are indicative and quotes are exact and immutable. Never tell the user an order is confirmed unless get_purchase/buy reports status "succeeded" with orderConfirmation present; then lead with "Order confirmed" and give the merchant, order reference, receipt id, amounts and payment reference. If the status is pending or unresolved, say so and poll get_purchase.',
  'Sandbox/testnet only: use synthetic data. Payment is made by a separately hosted bounded payer when one matches the selected option; otherwise buy returns "action_required".',
].join(' ');

/**
 * Build one MCP server bound to one gateway identity. No DB, no core, no payer keys: every tool is a
 * call to the canonical HTTP gateway (plus an optional call to the separate payer bridge).
 */
export function createMcpServer(config: McpConfig, opts: { hosted?: { resourceMetadataUrl: string } } = {}): McpServer {
  const server = new McpServer({ name: 'commerce-gateway', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, {
    gateway: new GatewayClient(config),
    bridges: BridgeClient.fromConfig(config),
    secrets: secretsOf(config),
    ...(opts.hosted ? { auth: opts.hosted } : {}),
  });
  return server;
}
