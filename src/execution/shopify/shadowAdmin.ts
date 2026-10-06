import { z } from 'zod';
import { AdminTransport } from './adminTransport.js';
import { ProviderError } from '../../core/errors.js';
import type { SourceOffer } from '../../contracts/provenance.js';
import type { ShopifyConfig } from './config.js';
import type { Clock } from '../../infrastructure/clock.js';

export const SANDBOX_STORE = 'token2049-test-store.myshopify.com';
export const ID_NAMESPACE = 'capsule_sandbox';
export const ID_KEY = 'offer_id';
const Errors = z.array(z.object({ code: z.string().optional() }));
export const ShadowProduct = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/), title: z.string(),
  identity: z.object({ value: z.string() }).nullable(), digest: z.object({ value: z.string() }).nullable(),
  publishedOnPublication: z.boolean(),
  variants: z.object({ nodes: z.array(z.object({ id: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/), price: z.string(), inventoryItem: z.object({ tracked: z.boolean(), requiresShipping: z.boolean() }) })) }),
  sellingPlanGroups: z.object({ nodes: z.array(z.object({ id: z.string() })) }),
});
export type ShadowProduct = z.infer<typeof ShadowProduct>;
const FIELDS = `id title identity: metafield(namespace: "${ID_NAMESPACE}", key: "${ID_KEY}") { value }
  digest: metafield(namespace: "${ID_NAMESPACE}", key: "source_digest") { value }
  publishedOnPublication(publicationId: $publication) variants(first: 2) { nodes { id price inventoryItem { tracked requiresShipping } } }
  sellingPlanGroups(first: 1) { nodes { id } }`;
const customId = (offerId: string) => ({ namespace: ID_NAMESPACE, key: ID_KEY, value: offerId });
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function shadowPayload(offerId: string, source: SourceOffer, digest: string, createdAt: string) {
  const price = BigInt(source.observedPrice.amountMinor);
  return {
    title: '[CAPSULE SANDBOX] ' + source.productTitle.slice(0, 230), status: 'ACTIVE',
    descriptionHtml: `<p>Controlled sandbox representation. Source merchant receives no order or payment.</p><p>Source: ${escapeHtml(source.merchantName)}; ${escapeHtml(source.productUrl)}; ${escapeHtml(source.productId)}; ${escapeHtml(source.variantId)}. Capsule offer: ${escapeHtml(offerId)}.</p>`,
    tags: ['capsule-sandbox', 'capsule-retained-demo', offerId],
    productOptions: [{ name: 'Title', position: 1, values: [{ name: 'Default Title' }] }],
    variants: [{ price: `${price / 100n}.${String(price % 100n).padStart(2, '0')}`,
      optionValues: [{ optionName: 'Title', name: 'Default Title' }], taxable: true,
      inventoryItem: { tracked: false, requiresShipping: true } }],
    metafields: [
      customId(offerId),
      { namespace: ID_NAMESPACE, key: 'source_digest', type: 'single_line_text_field', value: digest },
      { namespace: ID_NAMESPACE, key: 'created_at', type: 'date_time', value: createdAt },
      { namespace: ID_NAMESPACE, key: 'lifecycle', type: 'single_line_text_field', value: 'retained_demo' },
    ],
  };
}
/** Product-only mutations. No order creation, payment or source-merchant transport exists here. */
export class ShadowAdminClient extends AdminTransport {
  private identityReady = false;
  constructor(private readonly config: ShopifyConfig, fetchImpl: typeof fetch, clock: Clock, readonly publicationId: string) {
    super(config, fetchImpl, clock);
    if (config.storeDomain !== SANDBOX_STORE || !config.devStoreConfirmed || !config.bogusGatewayEnabled || !/^gid:\/\/shopify\/Publication\/\d+$/.test(publicationId))
      throw new ProviderError('not_sent', 'shadow_config', 'Controlled development store, Bogus gate and explicit publication ID required');
  }
  async assertSandbox(): Promise<void> {
    const result = await this.gql('query ShadowBoundary { shop { myshopifyDomain currencyCode plan { partnerDevelopment } } }', {},
      z.object({ shop: z.object({ myshopifyDomain: z.string(), currencyCode: z.string(), plan: z.object({ partnerDevelopment: z.boolean() }) }) }));
    if (result.shop.myshopifyDomain !== this.config.storeDomain || !result.shop.plan.partnerDevelopment || result.shop.currencyCode !== 'USD')
      throw new ProviderError('rejected', 'shadow_store_boundary', 'Shopify store must be the controlled USD partner development store');
  }
  private async ensureIdentityDefinition() {
    if (this.identityReady) return;
    const read = () => this.gql(`query ShadowIdentityDefinition { metafieldDefinitions(first: 2, ownerType: PRODUCT, namespace: "${ID_NAMESPACE}", key: "${ID_KEY}") { nodes { type { name } } } }`, {},
      z.object({ metafieldDefinitions: z.object({ nodes: z.array(z.object({ type: z.object({ name: z.string() }) })) }) }));
    let definitions = (await read()).metafieldDefinitions.nodes;
    if (!definitions.length) {
      // Definition creation is idempotent across offers: a race is accepted only after readback.
      await this.gql('mutation ShadowIdentityDefinitionCreate($definition: MetafieldDefinitionInput!) { metafieldDefinitionCreate(definition: $definition) { userErrors { code } } }',
        { definition: { name: 'Capsule selected offer', namespace: ID_NAMESPACE, key: ID_KEY, type: 'id', ownerType: 'PRODUCT' } },
        z.object({ metafieldDefinitionCreate: z.object({ userErrors: Errors }) }));
      definitions = (await read()).metafieldDefinitions.nodes;
    }
    if (definitions.length !== 1 || definitions[0]!.type.name !== 'id')
      throw new ProviderError('rejected', 'shadow_identity_definition', 'Unique Shopify id metafield definition required');
    this.identityReady = true;
  }
  async find(offerId: string): Promise<ShadowProduct | null> {
    await this.ensureIdentityDefinition();
    const result = await this.gql(`query ShadowRead($identifier: ProductIdentifierInput!, $publication: ID!) { productByIdentifier(identifier: $identifier) { ${FIELDS} } }`,
      { identifier: { customId: customId(offerId) }, publication: this.publicationId }, z.object({ productByIdentifier: ShadowProduct.nullable() }));
    return result.productByIdentifier;
  }
  async create(offerId: string, source: SourceOffer, digest: string, createdAt: string): Promise<ShadowProduct> {
    await this.ensureIdentityDefinition();
    const result = await this.gql(`mutation ShadowSet($input: ProductSetInput!, $identifier: ProductSetIdentifiers!, $publication: ID!) { productSet(input: $input, identifier: $identifier, synchronous: true) { product { ${FIELDS} } userErrors { code } } }`,
      { input: shadowPayload(offerId, source, digest, createdAt), identifier: { customId: customId(offerId) }, publication: this.publicationId },
      z.object({ productSet: z.object({ product: ShadowProduct.nullable(), userErrors: Errors }) }));
    if (!result.productSet.product || result.productSet.userErrors.length)
      throw new ProviderError('unknown', 'shadow_create_rejected', 'Shadow upsert incomplete; codes: ' + result.productSet.userErrors.map(e => /^[A-Z_]{1,80}$/.test(e.code ?? '') ? e.code : 'UNKNOWN').join(','));
    return result.productSet.product;
  }
  async publish(productId: string): Promise<void> {
    const result = await this.gql('mutation ShadowPublish($id: ID!, $input: [PublicationInput!]!) { publishablePublish(id: $id, input: $input) { userErrors { field message } } }',
      { id: productId, input: [{ publicationId: this.publicationId }] }, z.object({ publishablePublish: z.object({ userErrors: Errors }) }));
    if (result.publishablePublish.userErrors.length) throw new ProviderError('not_sent', 'shadow_publication', 'Shadow publication rejected');
  }
}
