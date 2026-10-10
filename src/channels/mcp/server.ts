import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { GatewayClient } from './client.js';
import { BridgeClient } from './bridge.js';
import { secretsOf, type McpConfig } from './config.js';
import { registerTools, DEMO_DISCLOSURE, type BackgroundJobs } from './tools.js';
import { demoData } from '../../demo/config.js';
import type { DemoCustomerProfile } from '../../demo/profile.js';

export const INSTRUCTIONS = [
  'Capsule is a commerce channel with a strict, user-driven flow: find_offers -> user chooses an offer -> create_quote -> user chooses a payment option and registered wallet and approves the exact quote -> buy -> get_purchase.',
  'SHORTLIST: find_offers returns a shortlist of at most 3 real offers and interaction.createQuoteAllowedNow=false. Never pick an offer silently and never call create_quote on your own initiative. Present the best 3 viable options (fewer only if fewer exist), mark exactly ONE as "Recommended", give a short concrete reason that uses only the returned facts and the request of the user (never invent attributes), and ask the user which one they want. Do not call create_quote until the user explicitly chooses an option.',
  'PROFILE: Capsule has a saved customer profile. Use it for shipping, booking-holder and passenger details: call create_quote with only { category } and the server fills the rest. Do not ask the user for fields the profile already provides (name, email, phone, address, date of birth, gender, nationality, passport). Treat profile values as ordinary saved customer details and never characterize them any other way. Ask only for genuine missing information that a result reports as needs_input, and only for that field. Never invent customer information. Do not repeat contact, date-of-birth or passport details back to the user; "Delivering to Marina Bay Sands, Singapore" is enough.',
  'QUOTE: call create_quote only after the user chose an offer. Then show the exact terms (merchant total, service fee, payable total, expiry) and every available payment option, in plain commerce language.',
  'CURRENCY: S$, SGD, Singapore dollar and Singapore dollars mean canonical currency SGD (scale 2). Preserve that original spendCeiling. For SGD retail budgets, present merchant USD and the frozen SGD reference equivalent separately, with Frankfurter and its reference date. The reference amount includes the service fee. Approval maxTotal stays in the merchant quote currency (quote.payablePrincipal); the original SGD ceiling has already been checked. Funding remains based on the USD quote under the stated testnet policy; it never settles SGD. Never refresh or guess an FX rate. If conversion is unavailable, ask the user to retry with a USD budget.',
  'PAYMENT: the user must explicitly select a payment rail/option and explicitly approve the exact quote and that payment choice. Never infer a rail, never default to one, never fall back to another rail. Call buy only after both, passing selectedFundingOptionId, selectedSourceId for a registered wallet, maxTotal and quoteDigest from the quote. Follow the existing purchase with get_purchase. Retry the same buy only to collect a purchase_pending operation, or after paymentAttempt.status=failed AND paymentAttempt.retrySafe=true and the cause is resolved. Never retry an ambiguous payment or create another purchase while reconciling.',
  'SLOW STEPS: search, quote preparation and payer readiness can take time. For search_pending, quote_pending or purchase_pending, tell the user it is in progress, wait about 20 seconds and repeat the SAME tool with EXACTLY the same arguments to collect its outcome. Once a purchaseId is known, follow get_purchase. Operator review or a payment failure ends automatic polling; explain the required action.',
  'SEARCH ONLY: an offer with checkout.status=search_only cannot be purchased in this deployment. Explain that limitation before asking for a selection.',
  'OUTCOME: offers are indicative and quotes are exact and immutable. Never tell the user a purchase is complete unless get_purchase/buy returns orderConfirmation. When it does, end your reply with its headline (ORDER CONFIRMED for retail, BOOKING CONFIRMED for hotel, TICKET ISSUED for flight) followed by its references (order/booking/provider reference, receipt id, verified payment). Otherwise follow progress.nextAction; only poll while recovery is pending, and explain failures, expiry or operator attention instead of waiting indefinitely.',
  `DEMO DISCLOSURE: state this exactly once, immediately before asking for final approval to buy: "${DEMO_DISCLOSURE}" Do not add sandbox, testnet, test or demo caveats to offers, quotes, progress or the confirmation, and do not append "(test environment)" to it. If the user asks about delivery or the environment, answer truthfully: nothing physical ships and no real money moves. Environment details stay in the structured results.`,
  'Payment is made by a separately hosted bounded payer when one matches the selected option; otherwise buy returns "action_required".',
].join(' ');

/**
 * Build one MCP server bound to one gateway identity. No DB, no core, no payer keys: every tool is a
 * call to the canonical HTTP gateway (plus an optional call to the separate payer bridge).
 */
export function createMcpServer(config: McpConfig, opts: { hosted?: { resourceMetadataUrl: string }; background?: BackgroundJobs; profile?: DemoCustomerProfile | null } = {}): McpServer {
  // The saved demo customer is on for the hosted endpoint (MCP_DEMO_PROFILE=off disables it); stdio and tests opt in via opts.profile.
  const profile = opts.profile !== undefined ? opts.profile : opts.hosted && process.env.MCP_DEMO_PROFILE !== 'off' ? demoData.customerProfile : null;
  const server = new McpServer({ name: 'commerce-gateway', version: '0.1.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, {
    gateway: new GatewayClient(config),
    bridges: BridgeClient.fromConfig(config),
    consolidatedBridge: BridgeClient.consolidated(config),
    secrets: secretsOf(config),
    ...(profile ? { profile } : {}),
    ...(opts.hosted ? { auth: opts.hosted } : {}),
    ...(opts.background ? { background: opts.background } : {}),
  });
  return server;
}
