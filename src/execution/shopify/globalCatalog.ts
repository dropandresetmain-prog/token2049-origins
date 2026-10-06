import { z } from 'zod';
import { SourceOffer, type SourceOffer as Source } from '../../contracts/provenance.js';
import { RetailIntent, type PurchaseIntent } from '../../contracts/intent.js';
import type { ProviderOffer } from '../../contracts/ports.js';
import { ProviderError } from '../../core/errors.js';
import { systemClock, type Clock } from '../../infrastructure/clock.js';

export const GLOBAL_CATALOG_ENDPOINT = 'https://catalog.shopify.com/api/ucp/mcp';
export const CATALOG_PROFILE = 'https://shopify.dev/ucp/agent-profiles/examples/2026-08-25/valid-with-capabilities.json';
export const SANDBOX_BOUNDARY = 'Source merchant receives no order or payment; equivalent transaction executes in Capsule Shopify Sandbox.' as const;
export const MAX_SOURCE_ITEM_MINOR = 10000n;
const Media = z.object({ type: z.string(), url: z.string() });
const Variant = z.object({
  id: z.string(), title: z.string(), url: z.string().optional(),
  price: z.object({ amount: z.number().int().nonnegative().safe(), currency: z.string() }),
  availability: z.object({ available: z.boolean() }),
  seller: z.object({ id: z.string(), name: z.string(), url: z.string() }),
  requires: z.object({ selling_plan: z.boolean().optional(), components: z.boolean().optional() }).optional(),
  media: z.array(Media).optional(),
});
/** Official UCP envelope. Unknown merchandising fields are discarded at the provider boundary. */
export const CatalogResponse = z.object({
  ucp: z.object({ version: z.literal('2026-08-25'), status: z.literal('success').optional() }),
  products: z.array(z.object({ id: z.string(), title: z.string(), url: z.string().optional(), variants: z.array(z.unknown()) })),
});
export function assertLiveIntent(value: PurchaseIntent) {
  const intent = RetailIntent.parse(value);
  if (intent.quantity !== 1 || intent.spendCeiling.currency !== 'USD' || intent.spendCeiling.scale !== 2)
    throw new ProviderError('rejected', 'retail_sandbox_constraint', 'Live retail sandbox supports quantity 1 and USD only; choose an alternative for other currencies');
  return intent;
}
function sourceUrl(value: string) {
  const url = new URL(value);
  const variant = url.searchParams.get('variant');
  url.search = ''; url.hash = '';
  if (variant && /^\d+$/.test(variant)) url.searchParams.set('variant', variant);
  return url.toString();
}
export function normalizeCatalog(raw: unknown, value: PurchaseIntent, observedAt: string, fixture = false): ProviderOffer[] {
  const intent = assertLiveIntent(value);
  const payload = CatalogResponse.parse(raw);
  const result: ProviderOffer[] = [];
  const seen = new Set<string>();
  for (const product of payload.products) for (const rawVariant of product.variants) {
    const parsed = Variant.safeParse(rawVariant);
    if (!parsed.success) continue;
    const v = parsed.data;
    if (!v.availability.available || v.price.currency !== 'USD' || v.price.amount <= 0 ||
        BigInt(v.price.amount) > MAX_SOURCE_ITEM_MINOR || BigInt(v.price.amount) > BigInt(intent.spendCeiling.amountMinor) ||
        v.requires?.selling_plan || v.requires?.components || seen.has(v.id)) continue;
    try {
      const source = SourceOffer.parse({ source: 'shopify_global_catalog', productId: product.id, variantId: v.id,
        merchantId: v.seller.id, merchantName: v.seller.name, merchantUrl: sourceUrl(v.seller.url),
        productTitle: product.title, variantTitle: v.title, productUrl: sourceUrl(v.url ?? product.url ?? ''),
        observedPrice: { currency: v.price.currency, amountMinor: String(v.price.amount), scale: 2 },
        availability: 'available', observedAt, schemaVersion: payload.ucp.version,
        evidenceMode: fixture ? 'local_fixture' : 'fresh_external' });
      result.push({ title: source.productTitle, description: 'Live source offer; execution uses Capsule Shopify Sandbox.',
        indicativePrice: source.observedPrice, terms: [SANDBOX_BOUNDARY, 'Source item price excludes Capsule sandbox shipping and tax.'],
        executionRef: { sourceOffer: source, quantity: 1 }, sourceOffer: source,
        sourceObservedAt: observedAt, expiresAt: new Date(Date.parse(observedAt) + 5 * 60_000).toISOString() });
      seen.add(v.id);
    } catch { /* Incomplete identity or unsafe links cannot become an approvable source offer. */ }
  }
  return result.slice(0, 10);
}
export class GlobalCatalogClient {
  constructor(private readonly opts: { fetchImpl?: typeof fetch; clock?: Clock; profileUrl?: string; fixture?: boolean } = {}) {}
  private async call(name: 'search_catalog' | 'lookup_catalog', catalog: Record<string, unknown>): Promise<unknown> {
    const response = await (this.opts.fetchImpl ?? fetch)(GLOBAL_CATALOG_ENDPOINT, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name,
        arguments: { meta: { 'ucp-agent': { profile: this.opts.profileUrl ?? CATALOG_PROFILE } }, catalog } } }),
    }).catch(() => { throw new ProviderError('not_sent', 'catalog_unreachable', 'Official Shopify Global Catalog is unreachable', true); });
    if (!response.ok) throw new ProviderError('not_sent', 'catalog_http', `Global Catalog HTTP ${response.status}`, response.status === 429);
    const body = z.object({ result: z.object({ isError: z.boolean().optional(), structuredContent: z.unknown() }).optional(), error: z.unknown().optional() }).safeParse(await response.json().catch(() => null));
    if (!body.success || body.data.error || !body.data.result || body.data.result.isError)
      throw new ProviderError('not_sent', 'catalog_response', 'Global Catalog returned an unsupported response');
    return body.data.result.structuredContent;
  }
  async search(value: PurchaseIntent): Promise<ProviderOffer[]> {
    const intent = assertLiveIntent(value);
    if (!intent.query || intent.productRef) throw new ProviderError('rejected', 'catalog_query_required', 'Live discovery requires a query; select a returned Capsule offer');
    const raw = await this.call('search_catalog', { query: intent.query,
      context: { address_country: intent.shipToCountry, currency: 'USD' },
      filters: { available: true, price: { max: Number(BigInt(intent.spendCeiling.amountMinor) < MAX_SOURCE_ITEM_MINOR ? BigInt(intent.spendCeiling.amountMinor) : MAX_SOURCE_ITEM_MINOR) } },
      pagination: { limit: 10 } });
    return normalizeCatalog(raw, intent, (this.opts.clock ?? systemClock).now().toISOString(), this.opts.fixture);
  }
  /** Selection fetches fresh data; persisted search offers are never used as a reusable search cache. */
  async refresh(source: Source, value: PurchaseIntent): Promise<Source> {
    const intent = assertLiveIntent(value);
    const raw = await this.call('lookup_catalog', { ids: [source.variantId], context: { address_country: intent.shipToCountry, currency: 'USD' } });
    const found = normalizeCatalog(raw, intent, (this.opts.clock ?? systemClock).now().toISOString(), this.opts.fixture)
      .map(o => o.sourceOffer!).find(s => s.variantId === source.variantId && s.merchantId === source.merchantId && s.productId === source.productId);
    if (!found || found.observedPrice.amountMinor !== source.observedPrice.amountMinor || found.productTitle !== source.productTitle || found.variantTitle !== source.variantTitle || found.productUrl !== source.productUrl)
      throw new ProviderError('rejected', 'source_offer_changed', 'Selected source offer changed or is unavailable; search again');
    return found;
  }
}
