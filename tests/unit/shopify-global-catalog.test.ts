import { describe, expect, it, vi } from 'vitest';
import { CATALOG_PROFILE, GLOBAL_CATALOG_ENDPOINT, GlobalCatalogClient, assertLiveIntent, normalizeCatalog, SANDBOX_BOUNDARY } from '../../src/execution/shopify/globalCatalog.js';
import { shadowPayload } from '../../src/execution/shopify/shadowAdmin.js';
import type { RetailIntent } from '../../src/contracts/intent.js';
import type { SourceOffer } from '../../src/contracts/provenance.js';
import { ManualClock } from '../../src/infrastructure/clock.js';

const observedAt = '2026-10-06T12:00:00.000Z';
const intent: RetailIntent = { category: 'retail', discovery: 'live', query: 'canvas tote', quantity: 1, shipToCountry: 'US', spendCeiling: { currency: 'USD', amountMinor: '15000', scale: 2 } };

// Synthetic documented UCP shape. Never a captured real merchant/search response.
function variant(overrides: Record<string, unknown> = {}) {
  return { id: 'gid://shopify/ProductVariant/101', title: 'Natural',
    url: 'https://merchant.example/products/tote?variant=101&utm_source=demo#details',
    price: { amount: 1999, currency: 'USD' }, availability: { available: true },
    seller: { id: 'gid://shopify/Shop/42', name: 'Example merchant', url: 'https://merchant.example/?utm_source=demo' },
    requires: { selling_plan: false, components: false },
    media: [{ type: 'image', url: 'https://media.example/tote.jpg' }],
    checkout_url: 'https://merchant.example/checkouts/secret', raw_payload: 'raw-secret',
    ...overrides };
}
function catalog(variants: unknown[] = [variant()], productOverrides: Record<string, unknown> = {}) {
  return { ucp: { version: '2026-08-25', status: 'success' }, products: [{
    id: 'gid://shopify/p/ABC123', title: 'Canvas tote', url: 'https://merchant.example/products/tote',
    description: 'raw-secret', images: ['https://media.example/tote.jpg'], variants, ...productOverrides }] };
}
function source(): SourceOffer {
  return normalizeCatalog(catalog(), intent, observedAt)[0]!.sourceOffer!;
}
function response(raw: unknown = catalog()) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { structuredContent: raw } }), { status: 200 });
}

describe('Global Catalog UCP normalization', () => {
  it('normalizes exact minor money and reduced source identity from the official envelope', () => {
    const [offer] = normalizeCatalog(catalog(), intent, observedAt);
    expect(offer!.sourceOffer).toEqual({ source: 'shopify_global_catalog', productId: 'gid://shopify/p/ABC123',
      variantId: 'gid://shopify/ProductVariant/101', merchantId: 'gid://shopify/Shop/42', merchantName: 'Example merchant',
      merchantUrl: 'https://merchant.example/', productTitle: 'Canvas tote', variantTitle: 'Natural',
      productUrl: 'https://merchant.example/products/tote?variant=101',
      observedPrice: { currency: 'USD', amountMinor: '1999', scale: 2 }, availability: 'available', observedAt,
      schemaVersion: '2026-08-25', evidenceMode: 'fresh_external' });
    expect(offer!.executionRef).toEqual({ sourceOffer: offer!.sourceOffer, quantity: 1 });
    expect(offer!.indicativePrice).toEqual(offer!.sourceOffer!.observedPrice);
    expect(offer!.expiresAt).toBe('2026-10-06T12:05:00.000Z');
    expect(offer!.terms).toContain(SANDBOX_BOUNDARY);
  });

  it('marks synthetic local fixtures explicitly', () => {
    expect(normalizeCatalog(catalog(), intent, observedAt, true)[0]!.sourceOffer!.evidenceMode).toBe('local_fixture');
  });

  it.each([
    ['wrong version', { ucp: { version: '2026-01-11' }, products: [] }],
    ['legacy flat data', { variants: [variant()] }],
    ['malformed product list', { ucp: { version: '2026-08-25' }, products: {} }],
    ['error status', { ucp: { version: '2026-08-25', status: 'error' }, products: [] }],
  ])('rejects unsupported envelope: %s', (_label, raw) => {
    expect(() => normalizeCatalog(raw, intent, observedAt)).toThrow();
  });

  it('still rejects unavailable returned variants even when the request asks for availability', () => {
    expect(normalizeCatalog(catalog([variant({ availability: { available: false } })]), intent, observedAt)).toEqual([]);
  });

  it.each([
    ['malformed variant ID', { id: '101' }],
    ['non-numeric variant ID', { id: 'gid://shopify/ProductVariant/bad' }],
    ['missing variant identity', { id: undefined }],
    ['missing seller identity', { seller: { name: 'Example', url: 'https://merchant.example/' } }],
    ['malformed merchant ID', { seller: { id: 'gid://shopify/Product/42', name: 'Example', url: 'https://merchant.example/' } }],
    ['empty merchant name', { seller: { id: 'gid://shopify/Shop/42', name: '', url: 'https://merchant.example/' } }],
    ['empty variant title', { title: '' }],
    ['invalid product URL', { url: 'not a url' }],
    ['HTTP product URL', { url: 'http://merchant.example/products/tote' }],
    ['script product URL', { url: 'javascript:alert(1)' }],
    ['credentialed product URL', { url: 'https://buyer:secret@merchant.example/products/tote' }],
    ['nonstandard-port product URL', { url: 'https://merchant.example:8443/products/tote' }],
    ['HTTP merchant URL', { seller: { id: 'gid://shopify/Shop/42', name: 'Example', url: 'http://merchant.example/' } }],
  ])('drops source facts that cannot be approved: %s', (_label, overrides) => {
    expect(normalizeCatalog(catalog([variant(overrides)]), intent, observedAt)).toEqual([]);
  });

  it.each([
    ['malformed product ID', { id: 'ABC123' }],
    ['empty product title', { title: '' }],
  ])('drops incomplete product identity: %s', (_label, overrides) => {
    expect(normalizeCatalog(catalog([variant()], overrides), intent, observedAt)).toEqual([]);
  });

  it('falls back to the display product link when the variant lacks one', () => {
    expect(normalizeCatalog(catalog([variant({ url: undefined })]), intent, observedAt)[0]!.sourceOffer!.productUrl)
      .toBe('https://merchant.example/products/tote');
  });

  it.each([0, -1, 19.99, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1, '1999'])
    ('drops invalid or nonpositive minor amount %s', amount => {
      expect(normalizeCatalog(catalog([variant({ price: { amount, currency: 'USD' } })]), intent, observedAt)).toEqual([]);
    });

  it.each(['SGD', 'EUR', 'usd'])('rejects source currency %s', currency => {
    expect(normalizeCatalog(catalog([variant({ price: { amount: 1999, currency } })]), intent, observedAt)).toEqual([]);
  });

  it('enforces both the source item cap and buyer ceiling, including their exact boundaries', () => {
    expect(normalizeCatalog(catalog([variant({ price: { amount: 10000, currency: 'USD' } })]), intent, observedAt)).toHaveLength(1);
    expect(normalizeCatalog(catalog([variant({ price: { amount: 10001, currency: 'USD' } })]), intent, observedAt)).toEqual([]);
    const lower = { ...intent, spendCeiling: { ...intent.spendCeiling, amountMinor: '1999' } };
    expect(normalizeCatalog(catalog(), lower, observedAt)).toHaveLength(1);
    expect(normalizeCatalog(catalog(), { ...lower, spendCeiling: { ...lower.spendCeiling, amountMinor: '1998' } }, observedAt)).toEqual([]);
  });

  it.each(['selling_plan', 'components'])('excludes required %s', requirement => {
    expect(normalizeCatalog(catalog([variant({ requires: { [requirement]: true } })]), intent, observedAt)).toEqual([]);
  });

  it('deduplicates accepted variants and bounds search output', () => {
    const variants = Array.from({ length: 12 }, (_, i) => variant({ id: `gid://shopify/ProductVariant/${101 + i}` }));
    const offers = normalizeCatalog(catalog([variant({ availability: { available: false } }), ...variants, variant()]), intent, observedAt);
    expect(offers).toHaveLength(10);
    expect(new Set(offers.map(o => o.sourceOffer!.variantId)).size).toBe(10);
    expect(offers[0]!.sourceOffer!.variantId).toBe('gid://shopify/ProductVariant/101');
  });

  it('does not retain raw payload, imagery, checkout handles or URL tracking', () => {
    const serialized = JSON.stringify(normalizeCatalog(catalog(), intent, observedAt));
    for (const secret of ['raw-secret', 'media.example', 'checkout', 'utm_source', '#details']) expect(serialized).not.toContain(secret);
  });

  it.each([
    ['quantity', { ...intent, quantity: 2 }],
    ['currency', { ...intent, spendCeiling: { ...intent.spendCeiling, currency: 'SGD' } }],
    ['scale', { ...intent, spendCeiling: { ...intent.spendCeiling, scale: 3 } }],
  ])('rejects unsupported live intent %s before transport', async (_label, value) => {
    expect(() => assertLiveIntent(value)).toThrow();
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(new GlobalCatalogClient({ fetchImpl }).search(value)).rejects.toMatchObject({ providerCode: 'retail_sandbox_constraint', outcome: 'rejected' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('Global Catalog live MCP transport', () => {
  it('uses the official endpoint, profile, safe transport headers and capped request filters', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response());
    const client = new GlobalCatalogClient({ fetchImpl, clock: new ManualClock() });
    expect(await client.search(intent)).toHaveLength(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(GLOBAL_CATALOG_ENDPOINT);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream' } });
    expect(init!.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init!.body as string)).toEqual({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {
      name: 'search_catalog', arguments: { meta: { 'ucp-agent': { profile: CATALOG_PROFILE } }, catalog: {
        query: 'canvas tote', context: { address_country: 'US', currency: 'USD' },
        filters: { available: true, price: { max: 10000 } }, pagination: { limit: 10 } } } } });
    await client.search({ ...intent, spendCeiling: { ...intent.spendCeiling, amountMinor: '2500' } });
    expect(JSON.parse(fetchImpl.mock.calls[1]![1]!.body as string).params.arguments.catalog.filters.price.max).toBe(2500);
  });

  it('propagates an explicit profile and fixture evidence mode', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response());
    const offers = await new GlobalCatalogClient({ fetchImpl, clock: new ManualClock(), profileUrl: 'https://agent.example/profile.json', fixture: true }).search(intent);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string).params.arguments.meta['ucp-agent'].profile).toBe('https://agent.example/profile.json');
    expect(offers[0]!.sourceOffer!.evidenceMode).toBe('local_fixture');
  });

  it('requires a query instead of accepting a prior product reference as discovery', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(new GlobalCatalogClient({ fetchImpl }).search({ ...intent, query: undefined, productRef: 'old-offer' }))
      .rejects.toMatchObject({ providerCode: 'catalog_query_required' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps network or blocked redirect failure to an explicit retryable no-send error', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('redirect disallowed'));
    await expect(new GlobalCatalogClient({ fetchImpl }).search(intent)).rejects.toMatchObject({
      outcome: 'not_sent', providerCode: 'catalog_unreachable', retryable: true });
  });

  it.each([429, 500])('handles HTTP %s without normalizing a successful-looking body', async status => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(catalog()), { status }));
    await expect(new GlobalCatalogClient({ fetchImpl }).search(intent)).rejects.toMatchObject({
      outcome: 'not_sent', providerCode: 'catalog_http', retryable: status === 429 });
  });

  it.each([
    ['RPC error', { error: { code: -32000 } }],
    ['tool error', { result: { isError: true, structuredContent: catalog() } }],
    ['missing result', {}],
  ])('rejects an unsupported MCP response: %s', async (_label, body) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    await expect(new GlobalCatalogClient({ fetchImpl }).search(intent)).rejects.toMatchObject({ providerCode: 'catalog_response' });
  });

  it('rejects invalid JSON with a meaningful provider failure', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response('not JSON', { status: 200 }));
    await expect(new GlobalCatalogClient({ fetchImpl }).search(intent)).rejects.toMatchObject({ providerCode: 'catalog_response' });
  });

  it('looks up the selected identity afresh and updates observation time', async () => {
    const clock = new ManualClock();
    clock.advance(1000);
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => response());
    const original = source();
    const refreshed = await new GlobalCatalogClient({ fetchImpl, clock }).refresh(original, intent);
    expect(refreshed.observedAt).toBe('2026-10-06T12:00:01.000Z');
    expect(original.observedAt).toBe(observedAt);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1]!.body as string).params).toMatchObject({
      name: 'lookup_catalog', arguments: { catalog: { ids: [original.variantId], context: { address_country: 'US', currency: 'USD' } } } });
  });

  it.each([
    ['price', catalog([variant({ price: { amount: 2000, currency: 'USD' } })])],
    ['product title', catalog([variant()], { title: 'Other product' })],
    ['variant title', catalog([variant({ title: 'Other variant' })])],
    ['product URL', catalog([variant({ url: 'https://merchant.example/products/other' })])],
    ['variant identity', catalog([variant({ id: 'gid://shopify/ProductVariant/102' })])],
    ['merchant identity', catalog([variant({ seller: { id: 'gid://shopify/Shop/43', name: 'Other', url: 'https://other.example/' } })])],
    ['product identity', catalog([variant()], { id: 'gid://shopify/p/OTHER' })],
    ['availability', catalog([variant({ availability: { available: false } })])],
  ])('rejects fresh source changes: %s', async (_label, raw) => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response(raw));
    await expect(new GlobalCatalogClient({ fetchImpl, clock: new ManualClock() }).refresh(source(), intent))
      .rejects.toMatchObject({ outcome: 'rejected', providerCode: 'source_offer_changed' });
  });
});

describe('Controlled shadow product payload', () => {
  it('creates one untracked taxable physical variant and no imported source media', () => {
    const payload = shadowPayload('offer-demo', source(), 'a'.repeat(64), observedAt);
    expect(payload.variants).toEqual([{ price: '19.99', optionValues: [{ optionName: 'Title', name: 'Default Title' }],
      taxable: true, inventoryItem: { tracked: false, requiresShipping: true } }]);
    expect(payload.productOptions).toEqual([{ name: 'Title', position: 1, values: [{ name: 'Default Title' }] }]);
    expect(payload.title).toBe('[CAPSULE SANDBOX] Canvas tote');
    expect(payload.tags).toContain('capsule-retained-demo');
    expect(payload.metafields).toContainEqual({ namespace: 'capsule_sandbox', key: 'offer_id', value: 'offer-demo' });
    expect(payload.metafields.find(field => field.key === 'offer_id')).not.toHaveProperty('type');
    expect(payload.metafields).toContainEqual({ namespace: 'capsule_sandbox', key: 'source_digest', value: 'a'.repeat(64), type: 'single_line_text_field' });
    expect(payload.metafields).toContainEqual({ namespace: 'capsule_sandbox', key: 'created_at', value: observedAt, type: 'date_time' });
    expect(payload).not.toHaveProperty('images');
    expect(payload).not.toHaveProperty('media');
    expect(payload).not.toHaveProperty('sellingPlanGroups');
  });

  it('escapes source metadata and offer identity in description HTML', () => {
    const input = { ...source(), merchantName: 'A & <script>"x"</script>\'s', productUrl: 'https://merchant.example/products/tote?variant=101&note=<x>',
      productId: '<product>', variantId: '"variant"' };
    const payload = shadowPayload('<offer>', input, 'b'.repeat(64), observedAt);
    expect(payload.descriptionHtml).toContain('A &amp; &lt;script&gt;&quot;x&quot;&lt;/script&gt;&#39;s');
    expect(payload.descriptionHtml).toContain('variant=101&amp;note=&lt;x&gt;');
    expect(payload.descriptionHtml).toContain('&lt;product&gt;; &quot;variant&quot;');
    expect(payload.descriptionHtml).toContain('Capsule offer: &lt;offer&gt;');
    expect(payload.descriptionHtml).not.toContain('<script>');
  });

  it.each([['1', '0.01'], ['99', '0.99'], ['100', '1.00'], ['10000', '100.00']])
    ('preserves exact decimal price for %s minor units', (amountMinor, price) => {
      expect(shadowPayload('offer', { ...source(), observedPrice: { currency: 'USD', amountMinor, scale: 2 } }, 'c'.repeat(64), observedAt).variants[0]!.price).toBe(price);
    });
});
