import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { Fulfillment, PurchaseIntent } from '../../contracts/intent.js';
import { Money, formatMinor } from '../../contracts/money.js';
import { OfferId, PurchaseId, QuoteId } from '../../contracts/common.js';
import type { PurchaseView, QuoteView, OfferView } from '../../contracts/commerce.js';
import { redact, redactString } from '../../infrastructure/redact.js';
import { GatewayClient, GatewayError } from './client.js';
import type { BridgeClient } from './bridge.js';

/** Dependencies of the tool layer. `bridge` is optional: without it `buy` can never move money. */
export interface ToolDeps {
  gateway: GatewayClient;
  bridge?: BridgeClient;
  /** Secret strings (gateway token, bridge token) that must never appear in any output. */
  secrets: string[];
}

/** Same shape the core enforces on Idempotency-Key, so we fail fast before any HTTP call. */
const IdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/, '8-128 chars of A-Z a-z 0-9 . _ : -');

/* ---------------- output sanitising ---------------- */

/** Gateway API tokens are `t2o_<base64url>`; redact() has no pattern for them, so catch any that a peer echoes back. */
const GATEWAY_TOKEN_SHAPE = /\bt2o_[A-Za-z0-9_-]{16,}/g;

/** Deep-replace every known secret (and anything shaped like a gateway token) in all strings: defence in depth on top of redact(). */
function scrub<T>(value: T, secrets: string[]): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return secrets.reduce((s, sec) => (sec.length >= 8 ? s.split(sec).join('[REDACTED]') : s), v).replace(GATEWAY_TOKEN_SHAPE, '[REDACTED]');
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Everything leaving this process goes through redact() and then secret scrubbing. */
function clean<T>(deps: ToolDeps, value: T): T {
  return scrub(redact(value), deps.secrets);
}

function cleanText(deps: ToolDeps, text: string): string {
  return scrub(redactString(text), deps.secrets);
}

function success(deps: ToolDeps, text: string, structured: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: cleanText(deps, text) }], structuredContent: clean(deps, structured) };
}

function failure(deps: ToolDeps, text: string, structured: Record<string, unknown>): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: cleanText(deps, text) }], structuredContent: clean(deps, structured) };
}

/** Gateway failure (ErrorBody or transport problem) -> MCP tool error with code, message and requestId. */
function gatewayFailure(deps: ToolDeps, e: unknown): CallToolResult {
  if (e instanceof GatewayError) {
    const error = { code: e.code, message: e.message, requestId: e.requestId, ...(e.details ? { details: e.details } : {}) };
    const rid = e.requestId ? ` (requestId: ${e.requestId})` : '';
    return failure(deps, `Error [${e.code}]: ${e.message}${rid}`, { error });
  }
  // Unexpected local failure: never leak the raw message, it may carry request internals.
  return failure(deps, 'Error [internal]: unexpected failure in the MCP channel', { error: { code: 'internal', message: 'unexpected failure in the MCP channel', requestId: null } });
}

/* ---------------- plain-language status ---------------- */

/** Provider order statuses that must never be described as a completed purchase. */
const NOT_COMPLETE_COMMERCE = new Set(['held', 'order_created_unpaid', 'payment_pending', 'ticketing', 'not_started', 'unknown']);

/**
 * Honest one-paragraph status. The word "succeeded" appears only when state === 'succeeded';
 * held/unpaid orders and unresolved outcomes are called out explicitly.
 */
export function describePurchase(p: PurchaseView): string {
  const dims = `state=${p.state}; paymentState=${p.paymentState}; commerceStatus=${p.commerceStatus}; merchantPaymentStatus=${p.merchantPaymentStatus}`;
  const reason = p.statusReason ? ` Reason: ${p.statusReason}` : '';
  let head: string;
  switch (p.state) {
    case 'awaiting_funding':
      head = `NOT purchased. The purchase (${formatMinor(p.payablePrincipal)}) is awaiting funding; nothing has been bought and no merchant spend has occurred.`;
      break;
    case 'funded_queued':
      head = 'Funding was received but the order has NOT been placed yet: execution is queued. Do not treat this as purchased; call get_purchase to check progress.';
      break;
    case 'executing':
      head = 'The order is being executed with the provider right now. The outcome is not final; call get_purchase to check progress.';
      break;
    case 'succeeded':
      head = `Purchase succeeded${p.providerReference ? ` (provider reference ${p.providerReference})` : ''}.`;
      if (NOT_COMPLETE_COMMERCE.has(p.commerceStatus)) {
        head += ` Caution: the provider commerce status is "${p.commerceStatus}", which is not a completed order by itself; read the receipt limitations.`;
      }
      break;
    case 'failed':
      head = 'The purchase FAILED; no completed order was produced.';
      break;
    case 'unresolved':
      head = 'The provider outcome is UNRESOLVED: it is not yet known whether the order exists, and the gateway is reconciling it. Do not assume success or failure and do not buy again; call get_purchase later.';
      break;
    case 'requires_reauthorization':
      head = 'NOT purchased: terms changed and fresh approval is required. Create a new quote and ask the user to approve it.';
      break;
    case 'expired':
      head = 'The purchase expired before it was funded; nothing was bought.';
      break;
  }
  const unpaid = p.state !== 'succeeded' && (p.commerceStatus === 'held' || p.commerceStatus === 'order_created_unpaid')
    ? ' A held or unpaid provider order is not a completed purchase.'
    : '';
  return `${head}${unpaid}${reason}\n${dims}`;
}

function describeOffers(offers: OfferView[]): string {
  if (offers.length === 0) return 'No offers found. Try a different query or a higher spend ceiling.';
  const lines = offers.map((o) => `- ${o.offerId} | ${o.title} | ${o.route} (${o.providerEnvironment}) | indicative ${formatMinor(o.indicativePrice)} | expires ${o.expiresAt}`);
  return `${offers.length} offer(s). Offers are indicative and NOT executable; call create_quote for exact terms.\n${lines.join('\n')}`;
}

function describeQuote(q: QuoteView): string {
  const fund = q.fundingOptions.map((f) => `${f.amount.amountBaseUnits} base units of ${f.amount.assetId} on ${f.amount.network}`).join('; ');
  return [
    `Quote ${q.quoteId} for "${q.title}" via ${q.route} (${q.providerEnvironment}).`,
    `Merchant total ${formatMinor(q.merchantTotal)} + service fee ${formatMinor(q.serviceFee)} = payable ${formatMinor(q.payablePrincipal)}.`,
    `Funding required: ${fund || 'none listed'}.`,
    `Expires ${q.expiresAt}. Digest ${q.digest}.`,
    'Nothing has been bought. To buy, the user must approve these exact terms; then call buy with quoteId, maxTotal (>= payable) and this digest.',
  ].join('\n');
}

/* ---------------- tool registration ---------------- */

export function registerTools(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    'find_offers',
    {
      title: 'Find offers',
      description:
        'Search supported retail, hotel and flight offers from a structured purchase intent. Results are indicative and NOT executable: call create_quote on an offerId for exact terms. Nothing is bought or reserved.',
      inputSchema: { intent: PurchaseIntent },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ intent }) => {
      try {
        const { offers } = await deps.gateway.searchOffers(PurchaseIntent.parse(intent));
        return success(deps, describeOffers(offers), { offers });
      } catch (e) {
        return gatewayFailure(deps, e);
      }
    },
  );

  server.registerTool(
    'create_quote',
    {
      title: 'Create exact quote',
      description:
        'Turn an offerId into an immutable quote with the exact price breakdown, funding requirement, expiry and digest. Takes buyer/shipping/traveller details in `fulfillment`. In sandbox, ALWAYS use synthetic traveller and shipping data (fake names, example.com emails, fake addresses and document numbers); never use a real person\'s personal data. Nothing is bought.',
      inputSchema: { offerId: OfferId, fulfillment: Fulfillment },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ offerId, fulfillment }) => {
      try {
        const { quote } = await deps.gateway.createQuote(OfferId.parse(offerId), Fulfillment.parse(fulfillment));
        return success(deps, describeQuote(quote), { quote });
      } catch (e) {
        return gatewayFailure(deps, e);
      }
    },
  );

  server.registerTool(
    'buy',
    {
      title: 'Buy a quote',
      description:
        'Create the purchase for an approved quote and, if a bounded payer is configured, fund it. Call ONLY after the user explicitly approved the exact quote; maxTotal and quoteDigest must come from that quote. Retries with the same quote are idempotent. Never claim the item was purchased unless the result status is "succeeded": "action_required" means payment is still needed, "execution_pending" means funded but not yet ordered (use get_purchase).',
      inputSchema: {
        quoteId: QuoteId,
        maxTotal: Money,
        quoteDigest: z.string().min(1),
        idempotencyKey: IdempotencyKey.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ quoteId, maxTotal, quoteDigest, idempotencyKey }) => {
      try {
        const key = idempotencyKey ?? `mcp:${quoteId}`;
        const created = await deps.gateway.createPurchase(
          { quoteId, approval: { maxTotal, quoteDigest }, fundingRail: 'cardano' },
          key,
        );
        let purchase = created.purchase;
        let payment: Record<string, unknown> | undefined;
        let paymentFailed = false;

        // Only an unfunded purchase is ever sent to the payer; replays of already-funded purchases are not re-paid.
        if (purchase.state === 'awaiting_funding' && deps.bridge) {
          const paid = await deps.bridge.pay(purchase.purchaseId);
          // Always re-read: the gateway is the source of truth, and a bridge timeout may hide a successful payment.
          purchase = (await deps.gateway.getPurchase(purchase.purchaseId)).purchase;
          if (paid.ok) payment = { attempted: true, ok: true, transferReference: paid.transferReference };
          else {
            payment = { attempted: true, ok: false, code: paid.code, message: paid.message };
            paymentFailed = purchase.state === 'awaiting_funding';
          }
        }

        const status =
          purchase.state === 'awaiting_funding' ? (paymentFailed ? 'payment_failed' : 'action_required') : purchase.state === 'funded_queued' || purchase.state === 'executing' ? 'execution_pending' : purchase.state;
        const structured: Record<string, unknown> = { status, purchase, ...(payment ? { payment } : {}) };
        let text = describePurchase(purchase);

        if (purchase.state === 'awaiting_funding') {
          structured.fundingInstructions = purchase.fundingInstructions;
          structured.message =
            paymentFailed && payment
              ? `Payment attempt failed [${String(payment.code)}]: ${String(payment.message)}. No purchase has been made yet.`
              : 'Payment required: fund via a bounded payer client; no purchase has been made yet.';
          text = `${structured.message as string}\n${text}`;
        } else if (purchase.state === 'funded_queued' || purchase.state === 'executing') {
          text = `Execution is pending. Call get_purchase with purchaseId ${purchase.purchaseId} to check progress.\n${text}`;
        }
        text = `Purchase ${purchase.purchaseId}. ${text}`;
        return paymentFailed ? failure(deps, text, structured) : success(deps, text, structured);
      } catch (e) {
        return gatewayFailure(deps, e);
      }
    },
  );

  server.registerTool(
    'get_purchase',
    {
      title: 'Get purchase status',
      description:
        'Read the status and receipt of a purchase. Reports funding (paymentState), provider order (commerceStatus) and merchant payment separately: a held or unpaid order is not complete, and "unresolved" means the outcome is still being reconciled. Set includeEvents for the most recent redacted events.',
      inputSchema: { purchaseId: PurchaseId, includeEvents: z.boolean().optional() },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ purchaseId, includeEvents }) => {
      try {
        const { purchase } = await deps.gateway.getPurchase(purchaseId);
        const structured: Record<string, unknown> = { purchase };
        let text = `Purchase ${purchase.purchaseId}. ${describePurchase(purchase)}`;
        if (includeEvents) {
          const { events } = await deps.gateway.getEvents(purchaseId);
          const recent = events.slice(-10);
          structured.events = recent;
          text += `\nRecent events: ${recent.map((ev) => `#${ev.sequence} ${ev.type}`).join(', ') || 'none'}`;
        }
        return success(deps, text, structured);
      } catch (e) {
        return gatewayFailure(deps, e);
      }
    },
  );
}
