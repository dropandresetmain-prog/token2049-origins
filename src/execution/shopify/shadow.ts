import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Db } from '../../infrastructure/db.js';
import { SourceOffer, SandboxRepresentation, type SourceOffer as Source } from '../../contracts/provenance.js';
import type { PurchaseIntent } from '../../contracts/intent.js';
import { ProviderError } from '../../core/errors.js';
import type { StorefrontClient } from './storefront.js';
import { ShadowAdminClient, type ShadowProduct, SANDBOX_STORE } from './shadowAdmin.js';
import { GlobalCatalogClient, SANDBOX_BOUNDARY, assertLiveIntent, MAX_SOURCE_ITEM_MINOR } from './globalCatalog.js';
import { systemClock, type Clock } from '../../infrastructure/clock.js';
import { toMoney } from './money.js';

export const sourceDigest = (source: Source) => createHash('sha256').update(JSON.stringify(SourceOffer.parse(source))).digest('hex');
interface Mapping { source_digest: string; source_json: string; state: string; representation_json: string | null; created_at: string }
export class ShadowPreparer {
  constructor(private readonly deps: {
    db: () => Db; admin: Pick<ShadowAdminClient, 'assertSandbox' | 'find' | 'create' | 'publish' | 'publicationId'>;
    storefront: Pick<StorefrontClient, 'findVariants'>; catalog: Pick<GlobalCatalogClient, 'refresh'>;
    storeDomain: string; clock?: Clock;
  }) {}
  async prepare(offerId: string, rawSource: unknown, intent: PurchaseIntent): Promise<{ sourceOffer: Source; sandboxRepresentation: SandboxRepresentation }> {
    const source = SourceOffer.parse(rawSource);
    const retail = assertLiveIntent(intent);
    if (!/^off_[0-9A-Za-z]{10,40}$/.test(offerId) || this.deps.storeDomain !== SANDBOX_STORE || source.observedPrice.currency !== 'USD' ||
        source.observedPrice.scale !== 2 || BigInt(source.observedPrice.amountMinor) <= 0n || BigInt(source.observedPrice.amountMinor) > MAX_SOURCE_ITEM_MINOR ||
        BigInt(source.observedPrice.amountMinor) > BigInt(retail.spendCeiling.amountMinor))
      throw new ProviderError('rejected', 'shadow_source_constraint', 'Selected offer exceeds sandbox currency, quantity or item-price constraints');
    const db = this.deps.db();
    const digest = sourceDigest(source);
    for (let attempt = 0; attempt < 300; attempt++) {
      const locked = await db.withExclusiveLock('shopify-shadow:' + this.deps.storeDomain + ':' + offerId, async () => {
        const owned = await db.get<{ execution_ref_json: string }>('SELECT execution_ref_json FROM offers WHERE id=$1 AND route=$2', offerId, 'shopify');
        if (!owned || sourceDigest(SourceOffer.parse(JSON.parse(owned.execution_ref_json).sourceOffer)) !== digest)
          throw new ProviderError('rejected', 'shadow_offer_binding', 'Selected source must match the durable Capsule offer');
        const now = (this.deps.clock ?? systemClock).now().toISOString();
        const row = await db.get<Mapping>('SELECT * FROM shopify_shadow_mappings WHERE offer_id=$1 AND store_domain=$2', offerId, this.deps.storeDomain);
        if (row && row.source_digest !== digest) throw new ProviderError('rejected', 'shadow_source_changed', 'Source snapshot is frozen; search again');
        await this.deps.admin.assertSandbox();
        if (row?.state === 'ready') return { sourceOffer: SourceOffer.parse(JSON.parse(row.source_json)), sandboxRepresentation: SandboxRepresentation.parse(JSON.parse(row.representation_json!)) };
        if (!row) {
          await this.deps.catalog.refresh(source, intent);
          await db.run(`INSERT INTO shopify_shadow_mappings(offer_id,store_domain,source_digest,source_json,state,created_at,updated_at) VALUES($1,$2,$3,$4,'preparing',$5,$5)`,
            offerId, this.deps.storeDomain, digest, JSON.stringify(source), now);
        }
        // Readback by Shopify's unique custom ID closes crash/timeout gaps before the DB mapping.
        let product = await this.deps.admin.find(offerId);
        if (!product) product = await this.deps.admin.create(offerId, source, digest, row?.created_at ?? now);
        this.verify(product, offerId, digest, source);
        if (!product.publishedOnPublication) await this.deps.admin.publish(product.id);
        product = await this.deps.admin.find(offerId);
        if (!product || !product.publishedOnPublication) throw new ProviderError('not_sent', 'shadow_not_published', 'Shadow publication not independently visible');
        this.verify(product, offerId, digest, source);
        const variantId = product.variants.nodes[0]!.id;
        const visible = await this.deps.storefront.findVariants({ productRef: variantId, includeSandboxShadows: true, country: retail.shipToCountry });
        if (visible.length !== 1 || visible[0]!.variantId !== variantId || visible[0]!.unitPrice.currency !== source.observedPrice.currency ||
            visible[0]!.unitPrice.amountMinor !== source.observedPrice.amountMinor || visible[0]!.unitPrice.scale !== source.observedPrice.scale)
          throw new ProviderError('not_sent', 'shadow_not_visible', `Sandbox product is unavailable for ${retail.shipToCountry} at its frozen USD price. Operator must verify market publication, inventory and shipping setup; nothing was purchased.`);
        const representation = SandboxRepresentation.parse({ provider: 'shopify', environment: 'test', boundary: SANDBOX_BOUNDARY,
          shadowProductId: product.id, shadowVariantId: variantId, publicationId: this.deps.admin.publicationId, sourceDigest: digest });
        await db.run(`UPDATE shopify_shadow_mappings SET state='ready',representation_json=$1,updated_at=$2 WHERE offer_id=$3 AND store_domain=$4 AND source_digest=$5`,
          JSON.stringify(representation), now, offerId, this.deps.storeDomain, digest);
        return { sourceOffer: source, sandboxRepresentation: representation };
      });
      if (locked.acquired) return locked.value;
      await delay(100);
    }
    throw new ProviderError('not_sent', 'shadow_prepare_busy', 'Shadow preparation in progress; retry the same selected offer', true);
  }
  private verify(product: ShadowProduct, offerId: string, digest: string, source: Source) {
    const variant = product.variants.nodes[0];
    if (product.identity?.value !== offerId || product.digest?.value !== digest || product.title !== '[CAPSULE SANDBOX] ' + source.productTitle.slice(0, 230) ||
        product.variants.nodes.length !== 1 || !variant || variant.inventoryItem.tracked || !variant.inventoryItem.requiresShipping || product.sellingPlanGroups.nodes.length ||
        toMoney({ amount: variant.price, currencyCode: 'USD' }).amountMinor !== source.observedPrice.amountMinor)
      throw new ProviderError('rejected', 'shadow_identity_mismatch', 'Shadow source identity, price or lifecycle conflicts; operator review required');
  }
}
