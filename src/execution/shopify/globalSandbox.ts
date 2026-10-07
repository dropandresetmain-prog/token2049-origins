import type { CommerceExecutor, ExecutionContext, ExecutionResult, ProviderQuote } from '../../contracts/ports.js';
import type { PurchaseIntent, Fulfillment } from '../../contracts/intent.js';
import { SourceOffer, SandboxRepresentation } from '../../contracts/provenance.js';
import { ProviderError } from '../../core/errors.js';
import { ShopifyExecutor, type ShopifyExecutorOptions } from './index.js';
import { GlobalCatalogClient } from './globalCatalog.js';
import { ShadowPreparer } from './shadow.js';
import { ShadowAdminClient } from './shadowAdmin.js';
import { loadShopifyConfig } from './config.js';
import { StorefrontClient } from './storefront.js';
import { systemClock } from '../../infrastructure/clock.js';
import type { Db } from '../../infrastructure/db.js';

/** Additional discovery mode over the same Shopify quote, checkout and reconciliation executor. */
export class GlobalSandboxExecutor implements CommerceExecutor {
  readonly route = 'shopify' as const;
  readonly category = 'retail' as const;
  readonly environment = 'test' as const;
  readonly budgetConversionCurrency = 'USD';
  constructor(private readonly base: CommerceExecutor, private readonly catalog: Pick<GlobalCatalogClient, 'search'>,
    private readonly shadow: Pick<ShadowPreparer, 'prepare'> | null) {}
  readiness() { return this.base.readiness(); }
  async search(intent: PurchaseIntent) {
    if (intent.category === 'retail' && intent.discovery === 'live') return this.catalog.search(intent);
    return this.base.search(intent);
  }
  async quote(offer: { offerId?: string; executionRef: Record<string, unknown>; intent: PurchaseIntent }, fulfillment: Fulfillment): Promise<ProviderQuote> {
    if (!offer.executionRef.sourceOffer) {
      if (offer.intent.category === 'retail' && offer.intent.discovery === 'live') throw new ProviderError('rejected', 'source_missing', 'Live offer provenance is required');
      return this.base.quote(offer, fulfillment);
    }
    if (!this.shadow || !offer.offerId) throw new ProviderError('not_sent', 'shadow_not_configured', 'Shadow preparation requires configured controlled-store publication and a selected Capsule offer');
    const prepared = await this.shadow.prepare(offer.offerId, offer.executionRef.sourceOffer, offer.intent);
    const quote = await this.base.quote({ ...offer, executionRef: { variantId: prepared.sandboxRepresentation.shadowVariantId, quantity: 1 } }, fulfillment);
    const item = quote.breakdown.filter(b => b.kind === 'item');
    if (item.length !== 1 || item[0]!.amount.currency !== prepared.sourceOffer.observedPrice.currency || item[0]!.amount.scale !== prepared.sourceOffer.observedPrice.scale ||
        item[0]!.amount.amountMinor !== prepared.sourceOffer.observedPrice.amountMinor)
      throw new ProviderError('rejected', 'shadow_quote_price_changed', 'Sandbox item must equal the frozen source price');
    return { ...quote, ...prepared,
      terms: [...quote.terms, prepared.sandboxRepresentation.boundary, 'Shipping, tax and total are Capsule sandbox charges, not source merchant charges.'],
      executionRef: { ...quote.executionRef, ...prepared } };
  }
  private async result(ctx: ExecutionContext, retrieve: boolean): Promise<ExecutionResult> {
    if (!ctx.quote.executionRef.sourceOffer) return retrieve ? this.base.retrieve(ctx) : this.base.execute(ctx);
    const source = SourceOffer.parse(ctx.quote.executionRef.sourceOffer);
    const sandbox = SandboxRepresentation.parse(ctx.quote.executionRef.sandboxRepresentation);
    const result = await (retrieve ? this.base.retrieve(ctx) : this.base.execute(ctx));
    // Execution evidence remains first so receipt execution mode cannot be overwritten by discovery.
    return { ...result, evidence: [...result.evidence, { source: 'shopify:global_catalog', environment: 'production',
      evidenceMode: source.evidenceMode, reference: source.variantId, observedAt: source.observedAt,
      details: { sourceOffer: source, sandboxRepresentation: sandbox } }] };
  }
  execute(ctx: ExecutionContext) { return this.result(ctx, false); }
  retrieve(ctx: ExecutionContext) { return this.result(ctx, true); }
}
export function createGlobalSandboxExecutor(env: NodeJS.ProcessEnv, db: () => Db, options: ShopifyExecutorOptions = {}) {
  const base = new ShopifyExecutor(env, options);
  const clock = options.clock ?? systemClock;
  const config = loadShopifyConfig(env);
  const publication = env.SHOPIFY_SANDBOX_PUBLICATION_ID;
  const shadow = config.buyerReady && config.adminReady && config.config.devStoreConfirmed && config.config.bogusGatewayEnabled && publication
    ? new ShadowPreparer({ db, storeDomain: config.config.storeDomain,
      admin: new ShadowAdminClient(config.config, options.fetchImpl ?? fetch, clock, publication),
      storefront: new StorefrontClient(config.config, options.fetchImpl ?? fetch), catalog: new GlobalCatalogClient({ clock, fetchImpl: options.fetchImpl }), clock, sink: options.sink }) : null;
  return new GlobalSandboxExecutor(base, new GlobalCatalogClient({ clock, fetchImpl: options.fetchImpl }), shadow);
}
