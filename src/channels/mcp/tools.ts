import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PurchaseIntentDraft, FulfillmentDraft, assessPurchaseIntent, assessFulfillment, NeedsInput } from '../../contracts/input.js';
import { projectProgress, type FundingSource } from '../../contracts/presentation.js';
import { createHash } from 'node:crypto';
import { Money, formatMinor } from '../../contracts/money.js';
import { OfferId, PurchaseId, QuoteId } from '../../contracts/common.js';
import type { PurchaseView, QuoteView, OfferView } from '../../contracts/commerce.js';
import { redact, redactString } from '../../infrastructure/redact.js';
import { GatewayClient, GatewayError } from './client.js';
import type { BridgeClient } from './bridge.js';

/** Dependencies of the tool layer. `bridges` may be empty: without one `buy` can never move money. */
export interface ToolDeps {
  gateway: GatewayClient;
  bridges?: BridgeClient[];
  /** Secret strings (gateway token, bridge tokens) that must never appear in any output. */
  secrets: string[];
}

/** Same shape the core enforces on Idempotency-Key, so we fail fast before any HTTP call. */
const IdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/, '8-128 chars of A-Z a-z 0-9 . _ : -');

/* ---------------- connected payers ---------------- */

type FundingOptionView = QuoteView['fundingOptions'][number];

/** Identity match is rail + network + asset id, never a ticker or display name. */
export function sourceMatches(source: FundingSource, option: FundingOptionView): boolean {
  return source.readiness === 'configured' && source.rail === option.rail && source.network === option.amount.network && source.assetId === option.amount.assetId;
}

/** Every reachable connected payer with its bridge. Read-only: /status never moves money. */
async function connectedPayers(deps: ToolDeps): Promise<Array<{ bridge: BridgeClient; source: FundingSource }>> {
  const all = await Promise.all((deps.bridges ?? []).map(async (bridge) => ({ bridge, source: await bridge.source() })));
  return all.flatMap((p) => (p.source ? [{ bridge: p.bridge, source: p.source }] : []));
}

/* ---------------- output sanitising ---------------- */

/** Defence in depth for gateway tokens echoed by a peer. */
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
  if (e instanceof z.ZodError) return failure(deps, 'The supplied request contains invalid values. Correct those fields and retry.', {
    error: { code: 'invalid_request', message: 'request validation failed', issues: e.issues.map(i => ({ path: i.path.join('.'), message: i.code === 'unrecognized_keys' ? 'unknown fields rejected' : i.message })) },
  });
  if (e instanceof GatewayError) {
    if (e.code === 'needs_input') {
      const result = NeedsInput.safeParse(e.details);
      if (result.success) return inputNeeded(deps, result.data);
    }
    const error = { code: e.code, message: e.message, requestId: e.requestId, ...(e.details ? { details: e.details } : {}) };
    const rid = e.requestId ? ` (requestId: ${e.requestId})` : '';
    return failure(deps, `Error [${e.code}]: ${e.message}${rid}`, { error });
  }
  // Unexpected local failure: never leak the raw message, it may carry request internals.
  return failure(deps, 'Error [internal]: unexpected failure in the MCP channel', { error: { code: 'internal', message: 'unexpected failure in the MCP channel', requestId: null } });
}

function inputNeeded(deps: ToolDeps, result: NeedsInput): CallToolResult {
  const retry = result.collectionPhase === 'search' ? 'Merge answers into the search intent and call find_offers again.' : result.collectionPhase === 'fulfillment' ? 'Merge answers into fulfillment and call create_quote again.' : 'Merge answers into the current request, then call this tool again.';
  return success(deps, 'Ask the user for the missing information. ' + retry + ' Do not invent answers.\n' + result.fields.map(f => f.humanLabel + ': ' + f.reason).join('\n'), result);
}

export function describePurchase(p: PurchaseView): string {
  return projectProgress(p).message;
}

function describeOffers(offers: OfferView[]): string {
  if (offers.length === 0) return 'No offers found. Try a different query or a higher spend ceiling.';
  const lines = offers.map((o) => `- ${o.offerId} | ${o.title} | ${o.route} (${o.providerEnvironment}) | indicative ${formatMinor(o.indicativePrice)} | expires ${o.expiresAt}${o.sourceOffer ? ' | source ' + o.sourceOffer.merchantName + ' | ' + o.sourceOffer.productUrl + ' | execution: Capsule Shopify Sandbox' : ''}`);
  return `${offers.length} offer(s). Offers are indicative and NOT executable; call create_quote for exact terms.\n${lines.join('\n')}`;
}

export function describeQuote(q: QuoteView, sources: FundingSource[]): string {
  const fund = q.fundingOptions.map(f => {
    const digits = f.amount.amountBaseUnits.padStart(f.amount.decimals + 1, '0');
    const amount = f.amount.decimals ? digits.slice(0, -f.amount.decimals) + '.' + digits.slice(-f.amount.decimals) : digits;
    const connected = sources.find(s => sourceMatches(s, f));
    const scale = f.settlement?.policy;
    return '- ' + f.rail + ' / ' + f.amount.network + ': ' + amount + ' ' + (f.amount.symbol ?? f.amount.assetId) +
      (scale ? ' · testnet notional ' + scale.numerator + ':' + scale.denominator : '') +
      ' · ' + (connected ? 'Connected wallet ' + connected.displayAddress + ' (configured; balance not verified)' : 'External payment action required') +
      ' · selection ' + f.fundingOptionId;
  });
  return [
    'Exact quote for "' + q.title + '" via ' + q.route + ' (' + q.providerEnvironment + ').',
    'Merchant total ' + formatMinor(q.merchantTotal) + ' + service fee ' + formatMinor(q.serviceFee) + ' = payable ' + formatMinor(q.payablePrincipal) + '.',
    'Fulfillment: ' + q.fulfillmentSummary,
    ...q.terms.map(t => 'Terms: ' + t),
    'Expires ' + q.expiresAt + '.',
    ...(fund.length ? ['Available funding options:', ...fund] : ['No payment source is currently available. Purchase creation is unavailable.']),
    'Nothing has been purchased yet. Show these exact terms to the user, ask them to select one available funding option, then ask for explicit approval of the terms and that payment choice. Only then call buy with selectedFundingOptionId, quoteId, maxTotal and quoteDigest from this quote. Never infer a choice or fabricate customer information.',
  ].join('\n');
}

/* ---------------- tool registration ---------------- */

export function registerTools(server: McpServer, deps: ToolDeps): void {
  const paymentAttempts = new Set<string>();
  server.registerTool(
    'find_offers',
    {
      title: 'Find offers',
      description:
        'Search supported retail, hotel and flight offers from a structured purchase intent. Results are indicative and NOT executable: call create_quote on an offerId for exact terms. Nothing is bought or reserved.',
      inputSchema: { intent: PurchaseIntentDraft },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ intent }) => {
      try {
        const assessment = assessPurchaseIntent(intent);
        if (assessment.status === 'needs_input') return inputNeeded(deps, assessment);
        const { offers } = await deps.gateway.searchOffers(assessment.value);
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
        'Turn an offerId into an immutable quote with the exact price breakdown, funding requirement, expiry and digest. Takes buyer/shipping/traveller details in `fulfillment`. In sandbox, ask the user to supply synthetic traveller and shipping data. Never invent required customer information or silently fill demo defaults. Nothing is bought.',
      inputSchema: { offerId: OfferId, fulfillment: FulfillmentDraft },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    async ({ offerId, fulfillment }) => {
      try {
        const assessment = assessFulfillment(fulfillment);
        if (assessment.status === 'needs_input') return inputNeeded(deps, assessment);
        const { quote } = await deps.gateway.createQuote(OfferId.parse(offerId), assessment.value);
        const fundingSources = (await connectedPayers(deps)).map(p => p.source);
        return success(deps, describeQuote(quote, fundingSources), { quote, fundingSources });
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
        'Create the purchase for an approved quote and, if a bounded payer is configured, fund it. Call ONLY after the user explicitly approved the exact quote; maxTotal and quoteDigest must come from that quote, and selectedFundingOptionId must be the option the user explicitly selected. Missing choices return needs_input; never infer Cardano. Retries with the same quote are idempotent. Never claim the item was purchased unless the result status is "succeeded": "action_required" means payment is still needed, "execution_pending" means funded but not yet ordered (use get_purchase).',
      inputSchema: {
        quoteId: QuoteId,
        maxTotal: Money.optional(),
        quoteDigest: z.string().min(1).optional(),
        selectedFundingOptionId: z.string().regex(/^fop_[0-9A-Za-z]{10,40}$/).optional(),
        idempotencyKey: IdempotencyKey.optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ quoteId, maxTotal, quoteDigest, selectedFundingOptionId, idempotencyKey }) => {
      try {
        const { quote } = await deps.gateway.getQuote(quoteId);
        if (!selectedFundingOptionId) return inputNeeded(deps, {
          status: 'needs_input', phase: 'funding_selection', fields: [{ path: 'selectedFundingOptionId', humanLabel: 'Funding option', expectedType: 'string', reason: quote.fundingOptions.length ? 'Ask the user to select an available option from the exact quote' : 'No payment source is currently available; request a fresh quote once configured', issue: 'missing', allowedValues: quote.fundingOptions.flatMap(o => o.fundingOptionId ? [o.fundingOptionId] : []) }],
        });
        const option = quote.fundingOptions.find(o => o.fundingOptionId === selectedFundingOptionId);
        if (!option) return failure(deps, 'Selected funding option is absent from this quote. Request a fresh quote and explicit approval.', { error: { code: 'invalid_request' } });
        const fields: NeedsInput['fields'] = [];
        if (!maxTotal) fields.push({ path: 'maxTotal', humanLabel: 'Approved maximum', expectedType: 'object', reason: 'Show the commercial amount and collect explicit approval', issue: 'missing' });
        if (!quoteDigest) fields.push({ path: 'quoteDigest', humanLabel: 'Exact quote approval', expectedType: 'string', reason: 'Collect approval of this exact quote and selected payment choice', issue: 'missing' });
        if (fields.length) return inputNeeded(deps, { status: 'needs_input', phase: 'approval', fields });
        const approval = { maxTotal: maxTotal!, quoteDigest: quoteDigest!, selectedFundingOptionId };
        const sameApproval = (a: typeof approval | null) => a && a.quoteDigest === approval.quoteDigest && a.selectedFundingOptionId === selectedFundingOptionId && a.maxTotal.currency === maxTotal!.currency && a.maxTotal.scale === maxTotal!.scale && a.maxTotal.amountMinor === maxTotal!.amountMinor;
        const existing = await deps.gateway.quotePurchase(quoteId);
        let purchase = existing.purchase;
        if (purchase && !sameApproval(existing.approval)) {
          // Only a purchase with no payment and no merchant activity may be re-authorized from a fresh quote.
          const untouched = purchase.state === 'awaiting_funding' && purchase.paymentState === 'not_received';
          const message = untouched
            ? 'A purchase already exists with different approved terms or funding choice. Request a fresh quote and authorization.'
            : `Purchase ${purchase.purchaseId} already has payment or merchant activity. Follow it with get_purchase. Do not create another purchase.`;
          return failure(deps, message, { error: { code: 'conflict' }, purchase, progress: projectProgress(purchase) });
        }
        let newlyCreated = false;
        // The one payer allowed to act for the selected option. Never another rail, never a fallback.
        let payer: BridgeClient | undefined;
        if (!purchase) {
          if (deps.bridges?.length) {
            const matching = (await connectedPayers(deps)).filter(p => sourceMatches(p.source, option));
            if (matching.length > 1) {
              return failure(deps, 'More than one connected payer claims the selected funding option. Fix the payer configuration. Nothing has been purchased.', { error: { code: 'payer_ambiguous' }, selectedFundingOptionId });
            }
            if (!matching[0]) {
              return success(deps, 'The connected payer cannot use the selected funding option. Connect a matching source or use a channel for external payment. Nothing has been purchased.', { status: 'action_required', quote, selectedFundingOptionId });
            }
            payer = matching[0].bridge;
          }
          const key = idempotencyKey ?? 'mcp:' + createHash('sha256').update(quoteId + ':' + selectedFundingOptionId).digest('hex');
          try {
            purchase = (await deps.gateway.createPurchase({ quoteId, approval }, key)).purchase;
            newlyCreated = true;
          } catch (e) {
            if (!(e instanceof GatewayError) || e.code !== 'conflict') throw e;
            const raced = await deps.gateway.quotePurchase(quoteId);
            if (!raced.purchase || !sameApproval(raced.approval)) throw e;
            purchase = raced.purchase;
          }
        }
        let payment: Record<string, unknown> | undefined;
        let paymentFailed = false;
        // A repeated interaction follows durable truth. Submitted/unknown payments are never sent again.
        if (newlyCreated && purchase.state === 'awaiting_funding' && purchase.paymentState === 'not_received' && payer && !paymentAttempts.has(purchase.purchaseId)) {
          paymentAttempts.add(purchase.purchaseId);
          const paid = await payer.pay(purchase.purchaseId);
          purchase = (await deps.gateway.getPurchase(purchase.purchaseId)).purchase;
          if (paid.ok) payment = { attempted: true, ok: true, transferReference: paid.transferReference };
          else {
            payment = { attempted: true, ok: false, code: paid.code, message: paid.message };
            paymentFailed = purchase.state === 'awaiting_funding' && purchase.paymentState === 'not_received';
          }
        }

        const status =
          purchase.state === 'awaiting_funding' ? (purchase.paymentState !== 'not_received' ? 'confirmation_pending' : paymentFailed ? 'payment_failed' : 'action_required') : purchase.state === 'funded_queued' || purchase.state === 'executing' ? 'execution_pending' : purchase.state;
        const structured: Record<string, unknown> = { status, purchase, progress: projectProgress(purchase), ...(payment ? { payment } : {}) };
        let text = describePurchase(purchase);

        if (purchase.state === 'awaiting_funding' && purchase.paymentState === 'not_received') {
          structured.fundingInstructions = purchase.fundingInstructions;
          structured.message =
            paymentFailed && payment
              ? `Payment attempt failed [${String(payment.code)}]: ${String(payment.message)}. No purchase has been made yet.`
              : 'Payment required: fund via a bounded payer client; no purchase has been made yet.';
          text = `${structured.message as string}\n${text}`;
        } else if (purchase.state === 'funded_queued' || purchase.state === 'executing') {
          text = `Execution is pending. Call get_purchase with purchaseId ${purchase.purchaseId} to check progress.\n${text}`;
        }
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
        const structured: Record<string, unknown> = { purchase, progress: projectProgress(purchase) };
        let text = describePurchase(purchase);
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
