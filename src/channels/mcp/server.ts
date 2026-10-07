import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from './client.js';
import { BridgeClient } from './bridge.js';
import { secretsOf, type McpConfig } from './config.js';
import { registerTools, type BackgroundJobs } from './tools.js';

export const INSTRUCTIONS = [
  'Capsule is a commerce channel with a strict, user-driven flow: find_offers -> user chooses an offer -> create_quote -> user chooses a payment rail and approves the exact quote -> buy -> get_purchase.',
  'SHORTLIST: find_offers returns a shortlist of at most 3 real offers and interaction.createQuoteAllowedNow=false. Never pick an offer silently and never call create_quote on your own initiative. Present the best 3 viable options (fewer only if fewer exist), mark exactly ONE as "Recommended", give a short concrete reason that uses only the returned facts and the request of the user (never invent attributes), and ask the user which one they want. Do not call create_quote until the user explicitly chooses an option.',
  'QUOTE: call create_quote only after the user chose an offer. It needs real buyer/shipping details from the user; never invent them. Then show the exact terms (merchant total, service fee, payable total, expiry) and every available payment option.',
  'PAYMENT: the user must explicitly select a payment rail/option and explicitly approve the exact quote and that payment choice. Never infer a rail, never default to one, never fall back to another rail. Call buy only after both, passing selectedFundingOptionId, maxTotal and quoteDigest from the quote. Follow the existing purchase with get_purchase. Retry the same buy only to collect a purchase_pending operation, or after paymentAttempt.status=failed AND paymentAttempt.retrySafe=true and the cause is resolved. Never retry an ambiguous payment or create another purchase while reconciling.',
  'SLOW STEPS: search, quote preparation and payer readiness can take time. For search_pending, quote_pending or purchase_pending, tell the user it is in progress, wait about 20 seconds and repeat the SAME tool with EXACTLY the same arguments to collect its outcome. Once a purchaseId is known, follow get_purchase. Operator review or a payment failure ends automatic polling; explain the required action.',
  'SEARCH ONLY: an offer with checkout.status=search_only cannot be purchased in this deployment. Explain that limitation before asking for selection or fulfillment details. Sandbox retail purchases do not imply physical delivery.',
  'OUTCOME: offers are indicative and quotes are exact and immutable. Never tell the user a purchase is complete unless get_purchase/buy returns orderConfirmation. When it does, end your reply with its headline (ORDER CONFIRMED for retail, BOOKING CONFIRMED for hotel, TICKET ISSUED for flight) followed by its references (order/booking/provider reference, receipt id, verified payment). Otherwise follow progress.nextAction; only poll while recovery is pending, and explain failures, expiry or operator attention instead of waiting indefinitely.',
  'Sandbox/testnet only: use synthetic data. Payment is made by a separately hosted bounded payer when one matches the selected option; otherwise buy returns "action_required".',
].join(' ');

/**
 * Build one MCP server bound to one gateway identity. No DB, no core, no payer keys: every tool is a
 * call to the canonical HTTP gateway (plus an optional call to the separate payer bridge).
 */
export function createMcpServer(config: McpConfig, opts: { hosted?: { resourceMetadataUrl: string }; background?: BackgroundJobs } = {}): McpServer {
  const server = new McpServer({ name: 'commerce-gateway', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, {
    gateway: new GatewayClient(config),
    bridges: BridgeClient.fromConfig(config),
    secrets: secretsOf(config),
    ...(opts.hosted ? { auth: opts.hosted } : {}),
    ...(opts.background ? { background: opts.background } : {}),
  });
  return server;
}
