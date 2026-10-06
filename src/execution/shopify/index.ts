import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { CommerceExecutor, ExecutionContext, ExecutionResult, ProviderEvidence, ProviderOffer, ProviderQuote } from '../../contracts/ports.js';
import { RetailIntent, RetailFulfillment, type PurchaseIntent, type Fulfillment } from '../../contracts/intent.js';
import { Money, compareMoney } from '../../contracts/money.js';
import { systemClock, type Clock } from '../../infrastructure/clock.js';
import { ProviderError } from '../../core/errors.js';
import { loadShopifyConfig } from './config.js';
import { StorefrontClient, QUOTE_ATTRIBUTE, cheapestSelections, readCartTotals, readCartTerms, readCartAddress, type StorefrontCart } from './storefront.js';
import { AdminClient, type AdminOrder } from './admin.js';
import { createPlaywrightDriver, isTrustedCheckoutUrl, type CheckoutObserver } from './browserCheckout.js';
import { CheckoutAbort, createStepLogger, type CheckoutDriver } from './checkout.js';
import { toMoney } from './money.js';
import { toProviderError } from './http.js';

const hash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same = (a: Money, b: Money): boolean => a.currency === b.currency && a.scale === b.scale && a.amountMinor === b.amountMinor;
const CheckoutTotalsSchema = z.object({
  total: Money, subtotal: Money, shipping: Money, tax: Money, shippingTitle: z.string().min(1),
});
const Ref = z.object({
  cartId: z.string().min(1), checkoutUrl: z.string(), nonce: z.string().uuid(), country: z.string().regex(/^[A-Z]{2}$/),
  fulfillmentHash: z.string().length(64), cartHash: z.string().length(64), createdAt: z.iso.datetime(),
  shippingTitle: z.string().min(1),
  checkoutTotals: CheckoutTotalsSchema.optional(),
});

/** Hash private provider state without storing buyer fields in evidence or checkpoints. */
export function cartSignature(cart: StorefrontCart, includeSelectedAddress = false): string {
  return hash({ buyer: cart.buyerIdentity, cost: cart.cost, quantity: cart.totalQuantity, lines: cart.lines.nodes,
    delivery: cart.deliveryGroups.nodes.map(g => ({ address: g.deliveryAddress, selected: g.selectedDeliveryOption })),
    attributes: cart.attributes,
    ...(includeSelectedAddress && cart.delivery ? { selectedAddresses: cart.delivery.addresses } : {}) });
}

/** PAID alone can also describe manual payments; require successful test gateway money movement. */
export function hasPaidTestEvidence(order: AdminOrder, expected: Money): boolean {
  if (!order.test || order.displayFinancialStatus !== 'PAID' || !same(toMoney(order.totalPriceSet.presentmentMoney), expected)) return false;
  if (order.transactions.some(t => t.status === 'SUCCESS' && (t.kind === 'REFUND' || t.kind === 'VOID'))) return false;
  const captures = order.transactions.filter(t => t.status === 'SUCCESS' && (t.kind === 'SALE' || t.kind === 'CAPTURE'));
  if (!captures.length || captures.some(t => !t.test || t.gateway !== 'bogus')) return false;
  let total = 0n;
  for (const t of captures) {
    const amount = toMoney(t.amountSet.presentmentMoney);
    if (amount.currency !== expected.currency || amount.scale !== expected.scale) return false;
    total += BigInt(amount.amountMinor);
  }
  return total === BigInt(expected.amountMinor);
}

export interface ShopifyExecutorOptions {
  clock?: Clock;
  fetchImpl?: typeof fetch;
  /** Dependency seams for local fixtures; supplying clients/driver labels evidence local_fixture. */
  storefront?: Pick<StorefrontClient, 'findVariants' | 'createCart' | 'selectDelivery' | 'getCart'>;
  admin?: Pick<AdminClient, 'searchOrders'>;
  driver?: CheckoutDriver;
  sink?: (step: string) => void;
  /** Read-only diagnostics hooks; never installed by gateway composition. */
  checkoutObserver?: CheckoutObserver;
}

export class ShopifyExecutor implements CommerceExecutor {
  readonly route = 'shopify' as const;
  readonly category = 'retail' as const;
  readonly environment = 'test' as const;
  private readonly report;
  private readonly clock;
  private readonly sf;
  private readonly admin;
  private readonly driver;
  private readonly log;
  private readonly fixture: boolean;
  private readonly attempts = new Map<string, Promise<ExecutionResult>>();

  constructor(env: NodeJS.ProcessEnv, opts: ShopifyExecutorOptions = {}) {
    this.report = loadShopifyConfig(env);
    this.clock = opts.clock ?? systemClock;
    const { config } = this.report;
    this.sf = opts.storefront ?? (this.report.buyerReady ? new StorefrontClient(config, opts.fetchImpl ?? fetch) : null);
    this.admin = opts.admin ?? (this.report.adminReady ? new AdminClient(config, opts.fetchImpl ?? fetch, this.clock) : null);
    this.driver = opts.driver ?? createPlaywrightDriver({ storeDomain: config.storeDomain, executablePath: config.browserExecutable, headless: config.headless, clock: this.clock, observer: opts.checkoutObserver });
    this.log = createStepLogger(opts.sink ?? (() => undefined));
    this.fixture = Boolean(opts.storefront || opts.admin || opts.driver);
  }

  async readiness() {
    const missing = [...new Set([...this.report.missingBuyer, ...this.report.missingAdmin, ...this.report.invalid,
      ...(!this.report.config.devStoreConfirmed ? ['SHOPIFY_DEV_STORE_CONFIRMED'] : []),
      ...(!this.report.config.bogusGatewayEnabled ? ['SHOPIFY_BOGUS_GATEWAY_ENABLED'] : []),
      ...(!this.report.config.browserExecutable ? ['SHOPIFY_BROWSER_EXECUTABLE'] : [])])];
    return { component: 'shopify', status: missing.length ? 'MISSING_CONFIG' as const : 'CONFIGURED_UNVERIFIED' as const,
      environment: 'test', missing, checkedAt: this.clock.now().toISOString(),
      detail: 'Live catalog, exact cart costs, browser selectors and independent paid test readback require external acceptance.' };
  }

  private enabled(): void {
    if (!this.sf || !this.admin || !this.report.config.devStoreConfirmed || !this.report.config.bogusGatewayEnabled || this.report.invalid.length)
      throw new ProviderError('not_sent', 'shopify_not_configured', 'Shopify development checkout or independent readback is not configured');
  }
  private fulfillment(value: Fulfillment) {
    const f = RetailFulfillment.safeParse(value);
    if (!f.success || !/^[A-Za-z0-9._+-]+@example\.com$/i.test(f.data.email) || f.data.shippingAddress.firstName !== 'Test' || f.data.shippingAddress.lastName !== 'Buyer' || f.data.shippingAddress.phone || (f.data.shippingAddress.province && !/^[A-Z0-9-]{1,6}$/.test(f.data.shippingAddress.province)))
      throw new ProviderError('rejected', 'shopify_test_buyer_required', 'Synthetic Test Buyer fulfillment with example.com email, no phone, and province code is required');
    return f.data;
  }
  private expiry(): string { return new Date(this.clock.now().getTime() + 10 * 60_000).toISOString(); }
  private evidence(reference: string, details: Record<string, unknown>): ProviderEvidence[] {
    return [{ source: 'shopify:admin_graphql', environment: 'test', evidenceMode: this.fixture ? 'local_fixture' : 'fresh_external', reference,
      observedAt: this.clock.now().toISOString(), details }];
  }
  async search(value: PurchaseIntent): Promise<ProviderOffer[]> {
    this.enabled();
    const intent = RetailIntent.safeParse(value);
    if (!intent.success) throw new ProviderError('rejected', 'shopify_retail_required', 'Retail intent required');
    try {
      const variants = await this.sf!.findVariants({ query: intent.data.query, productRef: intent.data.productRef, country: intent.data.shipToCountry });
      return variants.map(v => ({ title: v.title, description: v.description,
        indicativePrice: { ...v.unitPrice, amountMinor: (BigInt(v.unitPrice.amountMinor) * BigInt(intent.data.quantity)).toString() },
        terms: ['Development store; Bogus gateway simulated payment; shipping and tax require exact quote'],
        executionRef: { variantId: v.variantId, quantity: intent.data.quantity }, sourceObservedAt: this.clock.now().toISOString(), expiresAt: this.expiry() }));
    } catch (e) { throw toProviderError(e, 'shopify_search_failed'); }
  }
  async quote(offer: { executionRef: Record<string, unknown>; intent: PurchaseIntent }, fulfillment: Fulfillment): Promise<ProviderQuote> {
    this.enabled();
    const intent = RetailIntent.safeParse(offer.intent);
    const line = z.object({ variantId: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/), quantity: z.number().int().min(1).max(10) }).safeParse(offer.executionRef);
    const f = this.fulfillment(fulfillment);
    if (!intent.success || !line.success || intent.data.quantity !== line.data.quantity || intent.data.shipToCountry !== f.shippingAddress.countryCode)
      throw new ProviderError('rejected', 'shopify_fulfillment_mismatch', 'Retail line and fulfillment must match intent');
    try {
      const nonce = randomUUID();
      let cart = await this.sf!.createCart({ ...line.data, nonce, fulfillment: f });
      const selections = cheapestSelections(cart);
      if (!selections.length) throw new ProviderError('rejected', 'shopify_shipping_unavailable', 'Shipping unavailable for this buyer');
      cart = await this.sf!.selectDelivery(cart.id, selections, intent.data.shipToCountry);
      const terms = readCartTerms(cart);
      if (!isTrustedCheckoutUrl(cart.checkoutUrl, this.report.config.storeDomain)) throw new ProviderError('rejected', 'shopify_untrusted_url', 'Checkout URL is outside configured store');
      const totals = CheckoutTotalsSchema.parse(await this.driver.quote({
        checkoutUrl: cart.checkoutUrl, fulfillment: f, expectedSubtotal: terms.subtotal, expectedShipping: terms.shipping,
        shippingTitle: terms.shippingTitle, storePassword: this.report.config.storePassword, log: this.log,
      }));
      if (!same(totals.subtotal, terms.subtotal) || !same(totals.shipping, terms.shipping) || totals.shippingTitle !== terms.shippingTitle ||
          totals.tax.currency !== totals.total.currency || totals.tax.scale !== totals.total.scale || totals.total.currency !== terms.subtotal.currency || totals.total.scale !== terms.subtotal.scale ||
          BigInt(totals.total.amountMinor) !== BigInt(totals.subtotal.amountMinor) + BigInt(totals.shipping.amountMinor) + BigInt(totals.tax.amountMinor))
        throw new ProviderError('rejected', 'shopify_total_unavailable', 'Checkout breakdown does not match cart terms');
      // The browser may update cart costs. Freeze the cart AFTER quote observation, and verify the
      // requested identity/line/address below before exposing any approvable commercial terms.
      const observedCart = await this.sf!.getCart(cart.id, intent.data.shipToCountry);
      if (!observedCart || observedCart.id !== cart.id) throw new ProviderError('rejected', 'shopify_cart_mismatch', 'Quoted cart is unavailable');
      const observedTerms = readCartTerms(observedCart);
      if (!same(observedTerms.subtotal, terms.subtotal) || !same(observedTerms.shipping, terms.shipping) || observedTerms.shippingTitle !== terms.shippingTitle)
        throw new ProviderError('rejected', 'shopify_cart_mismatch', 'Cart terms changed during quote observation');
      cart = observedCart;
      const actual = readCartAddress(cart);
      const expected = f.shippingAddress;
      const normalized = (s: string | null | undefined) => (s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
      const changedAddressFields = ['firstName','lastName','address1','address2','city','zip'].filter(key =>
        normalized(actual[key as keyof typeof actual]) !== normalized(expected[key as keyof typeof expected]));
      if (cart.buyerIdentity.email !== f.email) changedAddressFields.push('email');
      if (actual.countryCodeV2 !== expected.countryCode) changedAddressFields.push('countryCode');
      if (normalized(actual.provinceCode) !== normalized(expected.province)) changedAddressFields.push('province');
      if (changedAddressFields.length)
        throw new ProviderError('rejected', 'shopify_address_changed', 'Provider fulfillment differs in fields: ' + changedAddressFields.join(','));
      if (!isTrustedCheckoutUrl(cart.checkoutUrl, this.report.config.storeDomain)) throw new ProviderError('rejected', 'shopify_untrusted_url', 'Checkout URL is outside configured store');
      if (compareMoney(totals.total, intent.data.spendCeiling) > 0) throw new ProviderError('rejected', 'shopify_spend_limit', 'Exact total exceeds spending ceiling');
      if (cart.lines.nodes.length !== 1 || cart.lines.nodes[0]!.merchandise.id !== line.data.variantId || cart.lines.nodes[0]!.quantity !== line.data.quantity ||
          !cart.attributes.some(a => a.key === QUOTE_ATTRIBUTE && a.value === nonce)) throw new ProviderError('rejected', 'shopify_cart_mismatch', 'Cart line or quote binding mismatch');
      return { title: cart.lines.nodes[0]!.merchandise.product.title, merchantTotal: totals.total,
        breakdown: [{ kind: 'item', label: 'Items', amount: totals.subtotal }, { kind: 'shipping', label: totals.shippingTitle, amount: totals.shipping }, { kind: 'tax', label: 'Tax', amount: totals.tax }],
        terms: [`Shipping: ${totals.shippingTitle}`, 'Development store; Bogus gateway simulated payment'], fulfillmentSummary: `Synthetic delivery to ${intent.data.shipToCountry}`,
        executionRef: { cartId: cart.id, checkoutUrl: cart.checkoutUrl, nonce, country: intent.data.shipToCountry, fulfillmentHash: hash(f), cartHash: cartSignature(cart, true),
          shippingTitle: totals.shippingTitle, checkoutTotals: totals, createdAt: this.clock.now().toISOString() }, expiresAt: this.expiry() };
    } catch (e) { throw toProviderError(e, 'shopify_quote_failed'); }
  }

  execute(ctx: ExecutionContext): Promise<ExecutionResult> {
    const existing = this.attempts.get(ctx.attemptId);
    if (existing) return existing;
    // Retain resolved attempts too: the same process cannot submit the same attempt again.
    const promise = this.run(ctx);
    this.attempts.set(ctx.attemptId, promise);
    return promise;
  }
  private async run(ctx: ExecutionContext): Promise<ExecutionResult> {
    if (ctx.checkpoints.pay_click || ctx.checkpoints.shopify_started) return this.retrieve(ctx);
    let payCommitted = false;
    try {
      this.enabled();
      const ref = Ref.parse(ctx.quote.executionRef);
      const f = this.fulfillment(ctx.fulfillment);
      if (hash(f) !== ref.fulfillmentHash || this.clock.now().getTime() >= Date.parse(ctx.quote.expiresAt))
        return { kind: 'terms_changed', reason: 'Quote expired or fulfillment changed', evidence: [] };
      const cart = await this.sf!.getCart(ref.cartId, ref.country);
      if (!cart || !this.matchesFrozenCart(cart, ref, ctx.quote.merchantTotal))
        return { kind: 'terms_changed', reason: 'Cart contents, delivery or total changed', evidence: [] };
      await ctx.checkpoint('shopify_started', { at: this.clock.now().toISOString() });
      await this.driver.complete({ checkoutUrl: ref.checkoutUrl, fulfillment: f, expectedTotal: ctx.quote.merchantTotal,
        shippingTitle: ref.shippingTitle, expectedCheckoutTotals: ref.checkoutTotals, storePassword: this.report.config.storePassword, log: this.log,
        checkpoint: async (step, data) => {
          if (step !== 'pay_click' && step !== 'order') throw new CheckoutAbort('step_failed');
          if (step === 'pay_click') {
            const current = await this.sf!.getCart(ref.cartId, ref.country);
            if (!current || !this.matchesFrozenCart(current, ref, ctx.quote.merchantTotal)) throw new CheckoutAbort('total_mismatch');
          }
          await ctx.checkpoint(step, data);
          ctx.checkpoints[step] = data;
          if (step === 'pay_click') payCommitted = true;
        },
      });
      return await this.retrieve(ctx);
    } catch (e) {
      const reason = e instanceof CheckoutAbort ? `Checkout stopped: ${e.code}` : 'Shopify operation failed';
      if (payCommitted || ctx.checkpoints.pay_click) return { kind: 'unknown', reason, providerReference: this.reference(ctx), evidence: [] };
      if (e instanceof CheckoutAbort && e.code === 'total_mismatch') return { kind: 'terms_changed', reason, evidence: [] };
      return { kind: 'failed_definite', reason, providerReference: null, evidence: [] };
    }
  }
  private matchesFrozenCart(cart: StorefrontCart, ref: z.infer<typeof Ref>, expected: Money): boolean {
    if (cartSignature(cart, Boolean(ref.checkoutTotals)) !== ref.cartHash) return false;
    try {
      // Legacy quotes retain the original exact-cart check. New quotes use checkout evidence for
      // payable totals, while the API still binds the same buyer, line, address and delivery method.
      if (!ref.checkoutTotals) return same(readCartTotals(cart).total, expected);
      const terms = readCartTerms(cart);
      return same(ref.checkoutTotals.total, expected) && same(terms.subtotal, ref.checkoutTotals.subtotal) &&
        same(terms.shipping, ref.checkoutTotals.shipping) && terms.shippingTitle === ref.checkoutTotals.shippingTitle;
    } catch { return false; }
  }

  private reference(ctx: ExecutionContext): string | null {
    const r = ctx.checkpoints.order?.providerReference ?? ctx.checkpoints.webhook_order?.providerReference;
    return typeof r === 'string' && /^(#[0-9]{3,}|[A-Z0-9]{6,12}|gid:\/\/shopify\/Order\/\d+)$/.test(r) ? r : null;
  }
  async retrieve(ctx: ExecutionContext): Promise<ExecutionResult> {
    const unknown = (reason: string, reference = this.reference(ctx), evidence: ProviderEvidence[] = []): ExecutionResult => ({ kind: 'unknown', reason, providerReference: reference, evidence });
    try {
      this.enabled();
      const ref = Ref.parse(ctx.quote.executionRef);
      const hint = this.reference(ctx);
      const orders = await this.admin!.searchOrders({ createdAfter: ref.createdAt,
        ...(hint?.startsWith('gid:') ? { orderId: hint } : hint?.startsWith('#') ? { name: hint } : hint && !hint.startsWith('gid:') ? { confirmationNumber: hint } : {}) });
      const matches = orders.filter(o => o.customAttributes.some(a => a.key === QUOTE_ATTRIBUTE && a.value === ref.nonce));
      if (matches.length !== 1) return unknown(matches.length ? 'Multiple orders share quote binding; operator review required' : 'No independently bound order visible; reconciliation required');
      const order = matches[0]!;
      const evidence = this.evidence(order.id, { test: order.test, financialStatus: order.displayFinancialStatus,
        transactionKinds: order.transactions.map(t => t.kind), transactionStatuses: order.transactions.map(t => t.status) });
      await ctx.checkpoint('order', { providerReference: order.id, kind: 'gid' });
      if (!hasPaidTestEvidence(order, ctx.quote.merchantTotal)) return unknown('Order lacks exact successful test SALE/CAPTURE payment evidence', order.id, evidence);
      return { kind: 'succeeded', providerReference: order.id, commerceStatus: 'paid', merchantPaymentStatus: 'simulated_paid', chargedAmount: ctx.quote.merchantTotal, evidence };
    } catch { return unknown('Independent Shopify readback unavailable; reconciliation required'); }
  }
}

export function createShopifyExecutor(env: NodeJS.ProcessEnv = process.env, options: ShopifyExecutorOptions = {}): ShopifyExecutor {
  return new ShopifyExecutor(env, options);
}
