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
import { applyDemoProfile, deliveryLabel, type DemoCustomerProfile } from '../../demo/profile.js';

/** Dependencies of the tool layer. `bridges` may be empty: without one `buy` can never move money. */
export interface ToolDeps {
  gateway: GatewayClient;
  bridges?: BridgeClient[];
  /** Secret strings (gateway token, bridge tokens) that must never appear in any output. */
  secrets: string[];
  /**
   * Hosted calls can outlast the host's response window. Search, quoting and purchase handoffs keep running in this process;
   * repeat calls join the operation. Payment handoffs also have a durable gateway claim, so restarts cannot start a second attempt.
   */
  background?: BackgroundJobs;
  /** DEMO configuration: saved customer merged into create_quote fulfillment before validation. Absent => the user must supply every field. */
  profile?: DemoCustomerProfile;
  /** Present on the hosted endpoint: tools declare OAuth security schemes and enforce the token's scopes. */
  auth?: { resourceMetadataUrl: string };
}

interface JobRecord { state: 'running' | 'done' | 'failed'; promise: Promise<void>; value?: unknown; error?: unknown; expires: number }

/** In-process registry of long operations, keyed by a hash of who asked for what. Results are kept briefly so repeated calls are idempotent. */
export class BackgroundJobs {
  private readonly jobs = new Map<string, JobRecord>();
  constructor(readonly waitMs = 45_000, private readonly keepMs = 10 * 60_000, private readonly now: () => number = Date.now) {}

  private wait(ms: number): Promise<'timeout'> {
    return new Promise((resolve) => { const t = setTimeout(() => resolve('timeout'), ms); t.unref?.(); });
  }

  /** Join one job per key. Completed quote results may be retained; other operations are consumed after collection. */
  async run<T>(key: string, start: () => Promise<T>, retain = true): Promise<{ pending: false; value: T } | { pending: true }> {
    for (const [k, j] of this.jobs) if (j.state !== 'running' && j.expires <= this.now()) this.jobs.delete(k);
    let job = this.jobs.get(key);
    if (!job) {
      const created: JobRecord = { state: 'running', expires: Number.POSITIVE_INFINITY, promise: Promise.resolve() };
      created.promise = start().then(
        (v) => { created.state = 'done'; created.value = v; created.expires = this.now() + this.keepMs; },
        (e) => { created.state = 'failed'; created.error = e; created.expires = this.now(); },
      );
      this.jobs.set(key, created);
      job = created;
    }
    await Promise.race([job.promise, this.wait(this.waitMs)]);
    if (job.state === 'running') return { pending: true };
    if (job.state === 'failed') { this.jobs.delete(key); throw job.error; }
    if (!retain) this.jobs.delete(key);
    return { pending: false, value: job.value as T };
  }

  /** Await `promise` for at most waitMs; if it is still running it keeps running (rejections are swallowed here, the durable state is authoritative). */
  async within<T>(promise: Promise<T>): Promise<{ pending: false; value: T } | { pending: true }> {
    const settled = promise.then((value) => ({ pending: false as const, value }));
    settled.catch(() => undefined);
    const first = await Promise.race([settled, this.wait(this.waitMs)]);
    return first === 'timeout' ? { pending: true } : first;
  }
}

const stableKey = (value: unknown): string => JSON.stringify(value, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : v));

/** OAuth scope each tool needs (same names as the gateway's customer scopes). */
const TOOL_SCOPE = { find_offers: 'offers:read', create_quote: 'quotes:write', buy: 'purchases:write', get_purchase: 'purchases:read' } as const;
type ToolName = keyof typeof TOOL_SCOPE;
type ToolContext = { authInfo?: { scopes: string[]; extra?: Record<string, unknown> } };

/** `securitySchemes` is how ChatGPT learns a tool needs OAuth (and which scopes) before it links an account. */
function securityMeta(deps: ToolDeps, tool: ToolName): { _meta: Record<string, unknown> } | Record<string, never> {
  return deps.auth ? { _meta: { securitySchemes: [{ type: 'oauth2', scopes: [TOOL_SCOPE[tool]] }] } } : {};
}

/** A token without the tool's scope gets a result that asks ChatGPT to re-link, never a silent downgrade. */
function missingScope(deps: ToolDeps, tool: ToolName, extra: { authInfo?: { scopes: string[] } }): CallToolResult | null {
  if (!deps.auth || extra.authInfo?.scopes.includes(TOOL_SCOPE[tool])) return null;
  const challenge = `Bearer resource_metadata="${deps.auth.resourceMetadataUrl}", error="insufficient_scope", error_description="${TOOL_SCOPE[tool]} is required", scope="${TOOL_SCOPE[tool]}"`;
  return { isError: true, content: [{ type: 'text', text: 'This connection does not grant the permission required by this tool. Reconnect Capsule to approve it.' }], _meta: { 'mcp/www_authenticate': [challenge] } };
}

/** Same shape the core enforces on Idempotency-Key, so we fail fast before any HTTP call. */
const IdempotencyKey = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/, '8-128 chars of A-Z a-z 0-9 . _ : -');

/* ---------------- connected payers ---------------- */

type FundingOptionView = QuoteView['fundingOptions'][number];

/** Identity match is rail + network + asset id, never a ticker or display name. */
export function sourceMatches(source: FundingSource, option: FundingOptionView): boolean {
  return source.readiness === 'configured' && source.rail === option.rail && source.network === option.amount.network && source.assetId === option.amount.assetId;
}

/** Every reachable connected payer with its bridge (and the spend headroom it reports, if any). Read-only: /status never moves money. */
async function connectedPayers(deps: ToolDeps): Promise<Array<{ bridge: BridgeClient; source: FundingSource; headroom?: bigint }>> {
  const all = await Promise.all((deps.bridges ?? []).map(async (bridge) => ({ bridge, status: await bridge.status() })));
  return all.flatMap((p) => (p.status ? [{ bridge: p.bridge, source: p.status.source, ...(p.status.headroomBaseUnits !== undefined ? { headroom: p.status.headroomBaseUnits } : {}) }] : []));
}

/** Whether a payer that reports its headroom can afford this option right now. Unknown headroom is treated as "no known limit". */
function exceedsHeadroom(option: FundingOptionView, headroom: bigint | undefined): boolean {
  return headroom !== undefined && BigInt(option.amount.amountBaseUnits) > headroom;
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

/** Never present more than this many options to the user. */
export const SHORTLIST_SIZE = 3;

/** Comparable facts only, copied from the offer as returned: nothing is ranked, scored or invented here. */
export function shortlistOf(offers: OfferView[]) {
  return offers.slice(0, SHORTLIST_SIZE).map((o) => ({
    offerId: o.offerId,
    title: o.title,
    description: o.description.length > 300 ? o.description.slice(0, 297) + '...' : o.description,
    category: o.category,
    route: o.route,
    providerEnvironment: o.providerEnvironment,
    indicativePrice: formatMinor(o.indicativePrice),
    ...(o.searchConversion ? { searchConversion: o.searchConversion } : {}),
    ...(o.sourceOffer ? { merchant: o.sourceOffer.merchantName, productUrl: o.sourceOffer.productUrl, variant: o.sourceOffer.variantTitle, availability: o.sourceOffer.availability } : {}),
    terms: o.terms.slice(0, 5),
    expiresAt: o.expiresAt,
    observedAt: o.sourceObservedAt,
    ...(o.checkout ? { checkout: o.checkout } : {}),
  }));
}

/** The only instruction find_offers gives: show options and wait. create_quote is explicitly not the next action. */
export function offerSelectionGuide(count: number) {
  return count === 0
    ? { step: 'no_offers', nextAction: 'ask_user_to_refine_search', createQuoteAllowedNow: false }
    : {
        step: 'present_shortlist',
        nextAction: 'present_options_and_ask_user_to_choose',
        createQuoteAllowedNow: false,
        createQuoteAllowedWhen: 'the user has explicitly chosen one of the presented options (use that offerId)',
        presentAtMost: SHORTLIST_SIZE,
        markExactlyOneRecommended: true,
        recommendationMustUseOnlyListedFields: true,
        askUserWhichOption: true,
      };
}

function describeOffers(offers: OfferView[], totalFound: number): string {
  if (offers.length === 0) return 'No offers found. Ask the user to refine the request or raise the spend ceiling. Nothing was bought.';
  const lines = offers.map((o, i) => `${i + 1}. ${o.title} | ${o.category}/${o.route} | indicative ${formatMinor(o.indicativePrice)}${o.sourceOffer ? ' | merchant ' + o.sourceOffer.merchantName + ' | ' + o.sourceOffer.productUrl : ''} | offerId ${o.offerId} | expires ${o.expiresAt}${o.checkout ? ' | SEARCH ONLY: ' + o.checkout.reason : ''}`);
  if (offers.every(o => o.checkout?.status === 'search_only')) return [...lines, 'Checkout is unavailable for these results. Explain the limitation now. Do not collect fulfillment or passenger details and do not call create_quote.'].join('\n');
  const conversion = offers[0]?.searchConversion;
  return [
    `Shortlist: ${offers.length} option(s)${totalFound > offers.length ? ` (the top ${offers.length} of ${totalFound} found)` : ''}. Offers are indicative and NOT executable. Nothing is bought or reserved.`,
    ...lines,
    ...(conversion ? [`Original user budget: ${formatMinor(conversion.userBudget)}. Indicative merchant prices remain USD; the converted inventory bound is not an approval amount. FX reference: Frankfurter, ${conversion.snapshot.referenceDate}. Exact payable including shipping, tax and service fee must still pass this SGD budget.`] : []),
    'NEXT STEP FOR YOU: present these options to the user (no more than 3), mark exactly ONE as "Recommended" with a short, concrete reason that uses only the facts above and the request of the user (never invent attributes), and ask which option they want. Do NOT call create_quote yet. Call it only after the user explicitly chooses one option, using that offerId.',
  ].join('\n');
}

/**
 * The single customer-facing disclosure of the demo environment. It is stated once, immediately before approval/buy;
 * offers, quotes, progress and confirmations stay in normal commerce language. Environment facts remain in structured results.
 */
export const DEMO_DISCLOSURE = 'Demo transaction: payment uses testnet funds and the merchant checkout runs in a sandbox. No real money will be charged.';
export const SOURCE_STORE_NOTE = "The source store receives no order or payment; the demo checkout is completed in Capsule's sandbox store.";
export function demoDisclosure(q: Pick<QuoteView, 'sourceOffer'>): string {
  return q.sourceOffer ? `${DEMO_DISCLOSURE} ${SOURCE_STORE_NOTE}` : DEMO_DISCLOSURE;
}
/** Terms that only restate the demo environment stay in structured output; the one disclosure covers them in text. */
const ENVIRONMENT_TERM = /(sandbox|development store|bogus|simulated|testnet|test)/i;

export function describeQuote(q: QuoteView, sources: FundingSource[], headrooms: Map<string, bigint> = new Map(), delivery: string | null = null): string {
  const fund = q.fundingOptions.map(f => {
    const digits = f.amount.amountBaseUnits.padStart(f.amount.decimals + 1, '0');
    const amount = f.amount.decimals ? digits.slice(0, -f.amount.decimals) + '.' + digits.slice(-f.amount.decimals) : digits;
    const connected = sources.find(s => sourceMatches(s, f));
    const scale = f.settlement?.policy;
    return '- ' + f.rail + ' / ' + f.amount.network + ': ' + amount + ' ' + (f.amount.symbol ?? f.amount.assetId) +
      (scale ? ' · testnet notional ' + scale.numerator + ':' + scale.denominator : '') +
      ' · ' + (connected
        ? (exceedsHeadroom(f, headrooms.get(connected.sourceId))
          ? 'Connected wallet ' + connected.displayAddress + ' BUT its remaining spend cap (' + String(headrooms.get(connected.sourceId)) + ' base units) is below this payment: it would be refused, nothing can be bought with it'
          : 'Connected wallet ' + connected.displayAddress + ' (configured; balance not verified)')
        : 'External payment action required') +
      ' · selection ' + f.fundingOptionId;
  });
  return [
    'Exact quote for "' + q.title + '" via ' + q.route + '.',
    'Merchant total ' + formatMinor(q.merchantTotal) + ' + service fee ' + formatMinor(q.serviceFee) + ' = payable ' + formatMinor(q.payablePrincipal) + '.',
    ...(q.displayConversion ? [
      'Reference equivalent of payable: about ' + formatMinor(q.displayConversion.convertedPayable) + ' (user budget ' + formatMinor(q.displayConversion.userBudget) + ').',
      'FX reference: Frankfurter, ' + q.displayConversion.snapshot.referenceDate + '; 1 ' + q.displayConversion.snapshot.from + ' = ' + q.displayConversion.snapshot.rate + ' ' + q.displayConversion.snapshot.to + '.',
      'Approve the exact USD merchant quote and an explicit funding option. Funding uses the USD payable under its stated testnet policy; SGD is a budget/display reference only. Pass payablePrincipal as maxTotal. This FX reference is frozen.',
    ] : []),
    delivery ?? 'Fulfillment: ' + q.fulfillmentSummary,
    ...q.terms.filter(t => !ENVIRONMENT_TERM.test(t)).map(t => 'Terms: ' + t),
    'Expires ' + q.expiresAt + '.',
    ...(fund.length ? ['Available funding options:', ...fund] : ['No payment source is currently available. Purchase creation is unavailable.']),
    'Nothing has been purchased yet. Show these exact terms to the user, ask them to select one available funding option, then ask for explicit approval of the terms and that payment choice. Only then call buy with selectedFundingOptionId, quoteId, maxTotal and quoteDigest from this quote. Never infer a choice or fabricate customer information. Do not ask for name, email, phone, address or traveller details: the saved customer profile already covers them. Immediately before asking for that final approval, state this once, verbatim: "' + demoDisclosure(q) + '" Do not repeat it elsewhere.',
  ].join('\n');
}

/* ---------------- order confirmation ---------------- */

/** Final label per commerce type, and the one provider status that genuinely proves it. Nothing weaker earns the label. */
const FINAL: Record<PurchaseView['category'], { headline: string; status: PurchaseView['commerceStatus']; referenceLabel: string }> = {
  retail: { headline: 'ORDER CONFIRMED', status: 'paid', referenceLabel: 'Order' },
  hotel: { headline: 'BOOKING CONFIRMED', status: 'confirmed', referenceLabel: 'Booking reference' },
  flight: { headline: 'TICKET ISSUED', status: 'ticketed', referenceLabel: 'Provider order / ticket reference' },
};

/** Human form of a provider reference: a Shopify order name stays as is, a Shopify gid shows its numeric id. */
function displayReference(ref: string): string {
  const gid = /^gid:\/\/shopify\/Order\/(\d+)$/.exec(ref);
  return gid ? `Shopify order ${gid[1]}` : ref;
}

/**
 * Present ONLY when the existing durable completion conditions hold (projectProgress stage "complete": state succeeded, paid commerce
 * and merchant status, receipt issued) AND the provider status is the one that proves this commerce type (retail paid, hotel
 * confirmed, flight ticketed) AND a funding payment was verified. Anything else yields no label, so the agent cannot over-claim.
 */
export function orderConfirmation(p: PurchaseView): Record<string, unknown> | null {
  if (projectProgress(p).stage !== 'complete' || !p.receipt || !p.providerReference) return null;
  const final = FINAL[p.category];
  const r = p.receipt;
  if (p.commerceStatus !== final.status || r.commerceStatus !== final.status) return null;
  const verified = r.funding.filter((f) => ['confirmed', 'escrow_locked', 'released'].includes(f.paymentState));
  if (!verified.length) return null;
  return {
    headline: final.headline,
    commerceType: p.category,
    environment: r.providerEnvironment,
    merchant: r.sourceOffer?.merchantName ?? null,
    product: r.sourceOffer?.productUrl ?? null,
    orderReference: p.providerReference,
    reference: { label: final.referenceLabel, value: displayReference(p.providerReference) },
    receiptId: r.receiptId,
    purchaseId: p.purchaseId,
    quoteId: p.quoteId,
    merchantStatus: r.commerceStatus,
    merchantPaymentStatus: r.merchantPaymentStatus,
    paymentVerified: true,
    principal: formatMinor(r.principal),
    serviceFee: formatMinor(r.serviceFee),
    ...(r.displayConversion ? { displayConversion: r.displayConversion } : {}),
    payments: verified.map((f) => ({ rail: f.rail, network: f.network, transferReference: f.transferReference, verifiedAt: f.verifiedAt })),
    evidenceRefs: r.evidenceRefs,
    limitations: r.limitations,
    issuedAt: r.issuedAt,
  };
}

/** Final copy, led by the headline. The host should end its reply with this block (not paraphrase the label away). */
function confirmationText(c: Record<string, unknown>): string {
  const ref = c.reference as { label: string; value: string };
  const pay = (c.payments as Array<{ rail: string; transferReference: string }>)[0]!;
  return [
    c.headline as string,
    ...(c.merchant ? [`Merchant: ${c.merchant as string}`] : []),
    `${ref.label}: ${ref.value}`,
    `Receipt: ${String(c.receiptId)}`,
    `Payment verified (${pay.rail}): ${pay.transferReference}`,
    `Amount ${String(c.principal)} + service fee ${String(c.serviceFee)}`,
    ...(c.displayConversion ? [
      'Your reference budget equivalent (including service fee): about ' + formatMinor((c.displayConversion as NonNullable<QuoteView['displayConversion']>).convertedPayable) +
      ' · Frankfurter, ' + (c.displayConversion as NonNullable<QuoteView['displayConversion']>).snapshot.referenceDate,
    ] : []),
    `End your reply with "${c.headline as string}" followed by these references.`,
  ].join('\n');
}

/* ---------------- tool registration ---------------- */

export function registerTools(server: McpServer, deps: ToolDeps): void {
  // Wrap the complete operation, including payer readiness, so every hosted reply is bounded.
  const bounded = <T extends Record<string, unknown>>(name: ToolName, handler: (args: T, extra: ToolContext) => Promise<CallToolResult>) => async (args: T, extra: ToolContext) => {
    const denied = missingScope(deps, name, extra);
    if (denied) return denied;
    if (!deps.background) return handler(args, extra);
    const customer = String(extra.authInfo?.extra?.customerId ?? 'anonymous');
    const key = createHash('sha256').update(stableKey({ customer, name, args })).digest('hex');
    const r = await deps.background.run(key, () => handler(args, extra), name === 'create_quote');
    if (!r.pending) {
      const quote = r.value.structuredContent?.quote as QuoteView | undefined;
      if (quote && name === 'create_quote') {
        try { await deps.gateway.getQuote(quote.quoteId, true); }
        catch (e) { return gatewayFailure(deps, e); }
      }
      return r.value;
    }
    return success(deps, 'The operation is still in progress. Wait about 20 seconds, then repeat ' + name + ' with EXACTLY the same arguments to collect the outcome. Do not start another search, order or payment.',
      { status: name === 'create_quote' ? 'quote_pending' : name === 'buy' ? 'purchase_pending' : 'search_pending', retryAfterSeconds: 20, ...('quoteId' in args ? { quoteId: args.quoteId } : {}), ...('offerId' in args ? { offerId: args.offerId } : {}) });
  };
  server.registerTool(
    'find_offers',
    {
      title: 'Find offers',
      description:
        'Search supported retail, hotel and flight offers from a structured purchase intent (retail searches the live product catalog by default). Interpret S$, SGD, Singapore dollar and Singapore dollars as spendCeiling.currency="SGD", scale=2; preserve the user budget. Retail provider prices remain USD; FX reference is for search/budget/display only. Results are indicative and NOT executable. Nothing is bought or reserved. Afterwards present the best 3 options to the user, mark one "Recommended" with a short reason, and let the user choose before calling create_quote.',
      inputSchema: { intent: PurchaseIntentDraft },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      ...securityMeta(deps, 'find_offers'),
    },
    bounded('find_offers', async ({ intent }, extra) => {
      const denied = missingScope(deps, 'find_offers', extra);
      if (denied) return denied;
      try {
        const assessment = assessPurchaseIntent(intent);
        if (assessment.status === 'needs_input') return inputNeeded(deps, assessment);
        // Open retail requests search the live Shopify catalog by default; the controlled test-store catalog is the fallback when live finds nothing.
        const wanted = assessment.value;
        let { offers: found } = wanted.category === 'retail' && wanted.discovery === undefined
          ? await deps.gateway.searchOffers({ ...wanted, discovery: 'live' })
          : await deps.gateway.searchOffers(wanted);
        if (found.length === 0 && wanted.category === 'retail' && wanted.discovery === undefined) found = (await deps.gateway.searchOffers({ ...wanted, discovery: 'controlled_catalog' })).offers;
        // Gateway order is preserved; the host model recommends from these real fields and the user chooses.
        const offers = found.slice(0, SHORTLIST_SIZE);
        const interaction = offers.length && offers.every(o => o.checkout?.status === 'search_only')
          ? { step: 'search_only', nextAction: 'explain_checkout_unavailable', createQuoteAllowedNow: false }
          : offerSelectionGuide(offers.length);
        return success(deps, describeOffers(offers, found.length), { offers, shortlist: shortlistOf(offers), totalFound: found.length, interaction });
      } catch (e) {
        return gatewayFailure(deps, e);
      }
    }),
  );

  server.registerTool(
    'create_quote',
    {
      title: 'Create exact quote',
      description:
        'Turn the offerId the USER CHOSE into an immutable quote with the exact price breakdown, funding requirement, expiry and digest. Call only after the user picked one of the presented offers. Capsule has a saved customer profile for shipping, booking-holder and traveller details: pass `fulfillment: { category }` and it is filled in server-side. Include a fulfillment field only to override it. Do not ask the user for details the profile already covers; ask only for information a result reports as missing. Never invent customer information. Nothing is bought.',
      inputSchema: { offerId: OfferId, fulfillment: FulfillmentDraft },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
      ...securityMeta(deps, 'create_quote'),
    },
    bounded('create_quote', async ({ offerId, fulfillment }, extra) => {
      const denied = missingScope(deps, 'create_quote', extra);
      if (denied) return denied;
      try {
        const assessment = assessFulfillment(deps.profile ? applyDemoProfile(fulfillment, deps.profile) : fulfillment);
        if (assessment.status === 'needs_input') return inputNeeded(deps, assessment);
        const { quote } = await deps.gateway.createQuote(OfferId.parse(offerId), assessment.value);
        const payers = await connectedPayers(deps);
        const fundingSources = payers.map(p => p.source);
        const headrooms = new Map(payers.flatMap(p => (p.headroom !== undefined ? [[p.source.sourceId, p.headroom] as [string, bigint]] : [])));
        return success(deps, describeQuote(quote, fundingSources, headrooms, deliveryLabel(assessment.value)), { quote, fundingSources, demoDisclosure: demoDisclosure(quote) });
      } catch (e) {
        return gatewayFailure(deps, e);
      }
    }),
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
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      ...securityMeta(deps, 'buy'),
    },
    bounded('buy', async ({ quoteId, maxTotal, quoteDigest, selectedFundingOptionId, idempotencyKey }, extra) => {
      const denied = missingScope(deps, 'buy', extra);
      if (denied) return denied;
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
        // The one payer allowed to act for the selected option. Never another rail, never a fallback.
        let payer: BridgeClient | undefined;
        const canAttempt = !purchase || (purchase.state === 'awaiting_funding' && purchase.paymentState === 'not_received' && purchase.paymentAttempt?.status === 'failed' && purchase.paymentAttempt.retrySafe);
        if (canAttempt) {
          if (deps.bridges?.length) {
            const matching = (await connectedPayers(deps)).filter(p => sourceMatches(p.source, option));
            if (matching.length > 1) {
              return failure(deps, 'More than one connected payer claims the selected funding option. Fix the payer configuration. Nothing has been purchased.', { error: { code: 'payer_ambiguous' }, selectedFundingOptionId });
            }
            if (!matching[0]) {
              return success(deps, 'The connected payer cannot use the selected funding option. Connect a matching source or use a channel for external payment. Nothing has been purchased.', { status: 'action_required', quote, selectedFundingOptionId });
            }
            if (exceedsHeadroom(option, matching[0].headroom)) {
              return failure(deps, `The connected payer's remaining spend cap (${String(matching[0].headroom)} base units) is below this payment (${option.amount.amountBaseUnits}). It would be refused. Nothing has been purchased and no purchase was created. Choose a cheaper offer, or ask the operator to review the payer cap.`,
                { error: { code: 'payer_cap_exceeded' }, selectedFundingOptionId, remainingCapBaseUnits: String(matching[0].headroom), requiredBaseUnits: option.amount.amountBaseUnits });
            }
            payer = matching[0].bridge;
          }
          if (!purchase) {
            const key = idempotencyKey ?? 'mcp:' + createHash('sha256').update(quoteId + ':' + selectedFundingOptionId).digest('hex');
            try {
              purchase = (await deps.gateway.createPurchase({ quoteId, approval }, key)).purchase;
            } catch (e) {
              if (!(e instanceof GatewayError) || e.code !== 'conflict') throw e;
              const raced = await deps.gateway.quotePurchase(quoteId);
              if (!raced.purchase || !sameApproval(raced.approval)) throw e;
              purchase = raced.purchase;
            }
          }
        }
        let payment: Record<string, unknown> | undefined;
        let paymentFailed = false;
        // A durable claim precedes network I/O. Unknown/lost handoffs cannot silently initiate another payment.
        if (purchase && canAttempt && payer && purchase.state === 'awaiting_funding' && purchase.paymentState === 'not_received') {
          const claim = await deps.gateway.claimPaymentAttempt(purchase.purchaseId);
          if (claim.claimed && claim.attempt) {
            const result = await payer.pay(purchase.purchaseId);
            await deps.gateway.completePaymentAttempt(purchase.purchaseId, {
              attemptId: claim.attempt.attemptId, status: result.ok ? 'succeeded' : 'failed',
              retrySafe: !result.ok && result.retrySafe === true,
              errorCode: result.ok ? null : (/^[a-z_]{3,40}$/.test(result.code) ? result.code : 'bridge_error'),
            });
            payment = result.ok ? { attempted: true, ok: true, transferReference: result.transferReference }
              : { attempted: true, ok: false, code: result.code, retrySafe: result.retrySafe === true };
          }
          purchase = (await deps.gateway.getPurchase(purchase.purchaseId)).purchase;
        }
        if (!purchase) throw new GatewayError('internal', 'purchase handoff did not return a purchase', null, null);
        paymentFailed = purchase.state === 'awaiting_funding' && purchase.paymentState === 'not_received' && purchase.paymentAttempt?.status === 'failed';

        const status =
          purchase.state === 'awaiting_funding' ? (purchase.paymentState !== 'not_received' ? 'confirmation_pending' : purchase.paymentAttempt?.status === 'running' ? 'payment_in_progress' : paymentFailed ? 'payment_failed' : 'action_required') : purchase.state === 'funded_queued' || purchase.state === 'executing' ? 'execution_pending' : purchase.state;
        const structured: Record<string, unknown> = { status, purchase, progress: projectProgress(purchase), ...(payment ? { payment } : {}) };
        let text = describePurchase(purchase);
        const confirmation = orderConfirmation(purchase);
        if (confirmation) {
          structured.orderConfirmation = confirmation;
          text = confirmationText(confirmation) + '\n' + text;
        }

        if (purchase.state === 'awaiting_funding' && purchase.paymentState === 'not_received') {
          structured.fundingInstructions = purchase.fundingInstructions;
          structured.message = purchase.paymentAttempt ? projectProgress(purchase).message : 'Payment required: fund via a bounded payer client; no purchase has been made yet.';
          text = `${structured.message as string}\n${text}`;
        } else if (purchase.state === 'funded_queued' || purchase.state === 'executing') {
          text = `Execution is pending. Call get_purchase with purchaseId ${purchase.purchaseId} to check progress.\n${text}`;
        }
        return paymentFailed ? failure(deps, text, structured) : success(deps, text, structured);
      } catch (e) {
        return gatewayFailure(deps, e);
      }
    }),
  );

  server.registerTool(
    'get_purchase',
    {
      title: 'Get purchase status',
      description:
        'Read the status and receipt of a purchase. Reports funding (paymentState), provider order (commerceStatus) and merchant payment separately: a held or unpaid order is not complete, and "unresolved" means the outcome is still being reconciled. Set includeEvents for the most recent redacted events.',
      inputSchema: { purchaseId: PurchaseId, includeEvents: z.boolean().optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
      ...securityMeta(deps, 'get_purchase'),
    },
    async ({ purchaseId, includeEvents }, extra) => {
      const denied = missingScope(deps, 'get_purchase', extra);
      if (denied) return denied;
      try {
        const { purchase } = await deps.gateway.getPurchase(purchaseId);
        const structured: Record<string, unknown> = { purchase, progress: projectProgress(purchase) };
        let text = describePurchase(purchase);
        const confirmation = orderConfirmation(purchase);
        if (confirmation) {
          structured.orderConfirmation = confirmation;
          text = confirmationText(confirmation) + '\n' + text;
        }
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
