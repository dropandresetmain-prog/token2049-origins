import { describe, expect, it, vi } from 'vitest';
import { ShadowAdminClient, SANDBOX_STORE, type ShadowProduct } from '../../src/execution/shopify/shadowAdmin.js';
import { GlobalSandboxExecutor } from '../../src/execution/shopify/globalSandbox.js';
import type { ShopifyConfig } from '../../src/execution/shopify/config.js';
import type { CommerceExecutor, ExecutionContext, ExecutionResult, ProviderQuote } from '../../src/contracts/ports.js';
import type { RetailFulfillment, RetailIntent } from '../../src/contracts/intent.js';
import type { SourceOffer, SandboxRepresentation } from '../../src/contracts/provenance.js';
import { ManualClock } from '../../src/infrastructure/clock.js';
import { money } from '../../src/contracts/money.js';

const at = '2026-10-06T12:00:00.000Z';
const offerId = 'off_abcdefghij';
const publicationId = 'gid://shopify/Publication/50';
const digest = 'a'.repeat(64);
const cfg: ShopifyConfig = { storeDomain: SANDBOX_STORE, apiVersion: '2026-10', clientId: 'synthetic-client', clientSecret: 'synthetic-secret',
  storefrontToken: null, storefrontPrivateToken: null, storefrontBuyerIp: null, storePassword: null, browserExecutable: null,
  headless: true, devStoreConfirmed: true, bogusGatewayEnabled: true };
const source: SourceOffer = { source: 'shopify_global_catalog', productId: 'gid://shopify/p/ABC', variantId: 'gid://shopify/ProductVariant/101',
  merchantId: 'gid://shopify/Shop/42', merchantName: 'Synthetic merchant', merchantUrl: 'https://merchant.example/',
  productTitle: 'Canvas tote', variantTitle: 'Natural', productUrl: 'https://merchant.example/products/tote?variant=101',
  observedPrice: money('USD', 1999), availability: 'available', observedAt: at, schemaVersion: '2026-08-25', evidenceMode: 'local_fixture' };
const sandbox: SandboxRepresentation = { provider: 'shopify', environment: 'test',
  boundary: 'Source merchant receives no order or payment; equivalent transaction executes in Capsule Shopify Sandbox.',
  shadowProductId: 'gid://shopify/Product/500', shadowVariantId: 'gid://shopify/ProductVariant/501', publicationId, sourceDigest: digest };
const product = (): ShadowProduct => ({ id: sandbox.shadowProductId, title: '[CAPSULE SANDBOX] Canvas tote',
  identity: { value: offerId }, digest: { value: digest }, publishedOnPublication: false,
  variants: { nodes: [{ id: sandbox.shadowVariantId, price: '19.99', inventoryItem: { tracked: false, requiresShipping: true } }] },
  sellingPlanGroups: { nodes: [] } });
const shop = () => ({ myshopifyDomain: SANDBOX_STORE, currencyCode: 'USD', plan: { partnerDevelopment: true } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
interface Request { query: string; variables: Record<string, any> }
type Handler = (request: Request) => unknown | Response;
function defaultData({ query }: Request): unknown {
  if (query.includes('ShadowBoundary')) return { shop: shop() };
  if (query.includes('query ShadowIdentityDefinition')) return { metafieldDefinitions: { nodes: [{ type: { name: 'id' } }] } };
  if (query.includes('ShadowIdentityDefinitionCreate')) return { metafieldDefinitionCreate: { userErrors: [] } };
  if (query.includes('ShadowRead')) return { productByIdentifier: product() };
  if (query.includes('ShadowSet')) return { productSet: { product: product(), userErrors: [] } };
  if (query.includes('ShadowPublish')) return { publishablePublish: { userErrors: [] } };
  throw new Error('Unexpected synthetic operation');
}
function adminHarness(handler: Handler = defaultData, clock = new ManualClock()) {
  const requests: Request[] = [];
  let minted = 0;
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (url, init) => {
    if (String(url).endsWith('/admin/oauth/access_token')) return json({ access_token: `synthetic-token-${++minted}`, expires_in: 3600 });
    const request = JSON.parse(init!.body as string) as Request;
    requests.push(request);
    const result = handler(request);
    return result instanceof Response ? result : json({ data: result });
  });
  return { fetchImpl, requests, clock, client: new ShadowAdminClient(cfg, fetchImpl, clock, publicationId) };
}

describe('Controlled Shadow Admin boundary and transport', () => {
  it.each([
    ['uncontrolled store', { storeDomain: 'other.myshopify.com' }, publicationId],
    ['development confirmation', { devStoreConfirmed: false }, publicationId],
    ['Bogus gate', { bogusGatewayEnabled: false }, publicationId],
    ['missing publication', {}, ''],
    ['wrong publication type', {}, 'gid://shopify/Product/50'],
  ])('requires %s before sending any request', (_label, overrides, publication) => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => new ShadowAdminClient({ ...cfg, ...overrides }, fetchImpl, new ManualClock(), publication))
      .toThrow('Controlled development store, Bogus gate and explicit publication ID required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each(['clientId', 'clientSecret'] as const)('requires %s without sending', field => {
    const fetchImpl = vi.fn<typeof fetch>();
    expect(() => new ShadowAdminClient({ ...cfg, [field]: null }, fetchImpl, new ManualClock(), publicationId)).toThrow('admin client credentials missing');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('checks the independently read controlled USD development store', async () => {
    const h = adminHarness();
    await expect(h.client.assertSandbox()).resolves.toBeUndefined();
    expect(h.requests[0]!.query).toContain('shop { myshopifyDomain currencyCode plan { partnerDevelopment } }');
  });

  it.each([
    ['store domain', { ...shop(), myshopifyDomain: 'other.myshopify.com' }],
    ['development plan', { ...shop(), plan: { partnerDevelopment: false } }],
    ['currency', { ...shop(), currencyCode: 'SGD' }],
  ])('blocks a live readback with mismatched %s', async (_label, actual) => {
    const h = adminHarness(() => ({ shop: actual }));
    await expect(h.client.assertSandbox()).rejects.toMatchObject({ outcome: 'rejected', providerCode: 'shadow_store_boundary' });
  });

  it('mints an in-memory client-credentials token and sends official API headers without redirects', async () => {
    const h = adminHarness();
    await h.client.assertSandbox();
    await h.client.find(offerId);
    const [tokenUrl, tokenInit] = h.fetchImpl.mock.calls[0]!;
    expect(tokenUrl).toBe(`https://${SANDBOX_STORE}/admin/oauth/access_token`);
    expect(tokenInit).toMatchObject({ method: 'POST', redirect: 'error', headers: {
      'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' } });
    expect(new URLSearchParams(tokenInit!.body as string)).toEqual(new URLSearchParams({
      grant_type: 'client_credentials', client_id: cfg.clientId!, client_secret: cfg.clientSecret! }));
    expect(tokenInit!.signal).toBeInstanceOf(AbortSignal);
    const [apiUrl, apiInit] = h.fetchImpl.mock.calls[1]!;
    expect(apiUrl).toBe(`https://${SANDBOX_STORE}/admin/api/2026-10/graphql.json`);
    expect(apiInit).toMatchObject({ method: 'POST', redirect: 'error', headers: {
      'content-type': 'application/json', accept: 'application/json', 'X-Shopify-Access-Token': 'synthetic-token-1' } });
    expect(apiInit!.signal).toBeInstanceOf(AbortSignal);
    expect(h.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/admin/oauth/access_token'))).toHaveLength(1);
  });

  it('refreshes an expiring token before another Admin request', async () => {
    const h = adminHarness();
    await h.client.find(offerId);
    h.clock.advance(3_541_000);
    await h.client.find(offerId);
    expect(h.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/admin/oauth/access_token'))).toHaveLength(2);
  });

  it('remints once on an Admin 401 and fails if the new token is still rejected', async () => {
    const h = adminHarness(() => json({}, 401));
    await expect(h.client.find(offerId)).rejects.toMatchObject({ kind: 'http', status: 401 });
    expect(h.requests).toHaveLength(2);
    expect(h.fetchImpl.mock.calls.filter(([url]) => String(url).endsWith('/admin/oauth/access_token'))).toHaveLength(2);
  });

  it.each(['token', 'graphql'])('blocks %s redirect/network failures and hides underlying sensitive text', async phase => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async url => {
      if (phase === 'graphql' && String(url).endsWith('/admin/oauth/access_token')) return json({ access_token: 'synthetic-token' });
      throw new TypeError('https://attacker.example/?secret=synthetic-secret');
    });
    const client = new ShadowAdminClient(cfg, fetchImpl, new ManualClock(), publicationId);
    await expect(client.find(offerId)).rejects.toMatchObject({ kind: 'network', message: phase === 'token' ? 'token request failed' : 'request failed' });
    for (const [, init] of fetchImpl.mock.calls) expect(init!.redirect).toBe('error');
  });

  it('maps token credentials rejection without exposing provider body', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ secret: 'sensitive-body' }, 400));
    await expect(new ShadowAdminClient(cfg, fetchImpl, new ManualClock(), publicationId).find(offerId))
      .rejects.toMatchObject({ kind: 'http', status: 401, message: 'token endpoint HTTP 400' });
  });

  it('rejects malformed token JSON rather than proceeding to GraphQL', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ access_token: '' }));
    await expect(new ShadowAdminClient(cfg, fetchImpl, new ManualClock(), publicationId).find(offerId))
      .rejects.toMatchObject({ kind: 'parse', message: 'token response malformed' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves GraphQL access-denied classification while hiding detailed provider errors', async () => {
    const h = adminHarness(() => json({ errors: [{ message: 'sensitive-body', extensions: { code: 'ACCESS_DENIED' } }] }));
    await expect(h.client.find(offerId)).rejects.toMatchObject({ kind: 'graphql', accessDenied: true, blocked: true, message: 'GraphQL errors: ACCESS_DENIED' });
  });
});

describe('Shadow Admin identity, upsert and publication contracts', () => {
  it('reads by unique product custom ID and selected publication, including independent safety fields', async () => {
    const h = adminHarness();
    expect(await h.client.find(offerId)).toEqual(product());
    const request = h.requests.find(r => r.query.includes('ShadowRead'))!;
    expect(h.requests[0]!.query).toContain('query ShadowIdentityDefinition');
    expect(request.query).toContain('productByIdentifier(identifier: $identifier)');
    expect(request.query).toContain('publishedOnPublication(publicationId: $publication)');
    expect(request.query).toContain('inventoryItem { tracked requiresShipping }');
    expect(request.query).toContain('sellingPlanGroups(first: 1)');
    expect(request.variables).toEqual({ identifier: { customId: { namespace: 'capsule_sandbox', key: 'offer_id', value: offerId } }, publication: publicationId });
  });

  it('supports an absent identity mapping without inventing a product', async () => {
    const h = adminHarness(request => request.query.includes('ShadowRead') ? { productByIdentifier: null } : defaultData(request));
    expect(await h.client.find(offerId)).toBeNull();
  });

  it('bootstraps a missing unique identity definition before the first product lookup and caches verified type', async () => {
    let reads = 0;
    const h = adminHarness(request => {
      if (request.query.includes('query ShadowIdentityDefinition')) return { metafieldDefinitions: { nodes: ++reads === 1 ? [] : [{ type: { name: 'id' } }] } };
      return defaultData(request);
    });
    await h.client.find(offerId);
    await h.client.create(offerId, source, digest, at);
    await h.client.find(offerId);
    expect(h.requests.map(r => r.query.match(/(?:query|mutation) (\w+)/)![1])).toEqual([
      'ShadowIdentityDefinition', 'ShadowIdentityDefinitionCreate', 'ShadowIdentityDefinition', 'ShadowRead', 'ShadowSet', 'ShadowRead' ]);
  });

  it('rejects an unsafe identity definition before performing a lookup', async () => {
    const h = adminHarness(request => request.query.includes('query ShadowIdentityDefinition')
      ? { metafieldDefinitions: { nodes: [{ type: { name: 'single_line_text_field' } }] } } : defaultData(request));
    await expect(h.client.find(offerId)).rejects.toMatchObject({ providerCode: 'shadow_identity_definition' });
    expect(h.requests.some(r => r.query.includes('ShadowRead'))).toBe(false);
  });

  it('rejects malformed independent product readback', async () => {
    const h = adminHarness(request => request.query.includes('ShadowRead') ? { productByIdentifier: { ...product(), id: 'gid://shopify/Order/500' } } : defaultData(request));
    await expect(h.client.find(offerId)).rejects.toMatchObject({ kind: 'parse', message: 'response shape did not match expectation' });
  });

  it('uses synchronous productSet upsert bound to the ID metafield and retains exact source identity', async () => {
    const h = adminHarness();
    expect(await h.client.create(offerId, source, digest, at)).toEqual(product());
    expect(h.requests).toHaveLength(2);
    const definition = h.requests[0]!;
    expect(definition.query).toContain('ownerType: PRODUCT');
    expect(definition.query).toContain('namespace: "capsule_sandbox", key: "offer_id"');
    const request = h.requests[1]!;
    expect(request.query).toContain('$identifier: ProductSetIdentifiers!');
    expect(request.query).toContain('productSet(input: $input, identifier: $identifier, synchronous: true)');
    expect(request.variables.identifier).toEqual({ customId: { namespace: 'capsule_sandbox', key: 'offer_id', value: offerId } });
    expect(request.variables.input.metafields).toContainEqual({ namespace: 'capsule_sandbox', key: 'offer_id', value: offerId });
    expect(request.variables.input.metafields.find((field: { key: string }) => field.key === 'offer_id')).not.toHaveProperty('type');
    expect(request.variables.input.variants).toHaveLength(1);
    expect(request.variables.input.variants[0]).toMatchObject({ price: '19.99', inventoryItem: { tracked: false, requiresShipping: true } });
    expect(request.variables.input).not.toHaveProperty('media');
    expect(request.variables.input).not.toHaveProperty('images');
    expect(h.fetchImpl.mock.calls.every(([url]) => String(url).startsWith(`https://${SANDBOX_STORE}/admin/`))).toBe(true);
    expect(h.requests.map(r => r.query).join('\n')).not.toMatch(/orderCreate|orderMarkAsPaid|orderComplete|paymentSession|fileCreate/);
  });

  it('creates a missing ID definition and requires its independent readback even after a duplicate-create race', async () => {
    let reads = 0;
    const h = adminHarness(request => {
      if (request.query.includes('query ShadowIdentityDefinition')) return { metafieldDefinitions: { nodes: ++reads === 1 ? [] : [{ type: { name: 'id' } }] } };
      if (request.query.includes('ShadowIdentityDefinitionCreate')) return { metafieldDefinitionCreate: { userErrors: [{ code: 'TAKEN' }] } };
      return defaultData(request);
    });
    await h.client.create(offerId, source, digest, at);
    expect(h.requests.map(r => r.query.match(/(?:query|mutation) (\w+)/)![1])).toEqual([
      'ShadowIdentityDefinition', 'ShadowIdentityDefinitionCreate', 'ShadowIdentityDefinition', 'ShadowSet' ]);
    expect(h.requests[1]!.variables).toEqual({ definition: { name: 'Capsule selected offer', namespace: 'capsule_sandbox', key: 'offer_id', type: 'id', ownerType: 'PRODUCT' } });
  });

  it.each([
    ['wrong type', [{ type: { name: 'single_line_text_field' } }]],
    ['ambiguous definitions', [{ type: { name: 'id' } }, { type: { name: 'id' } }]],
    ['still absent after create', []],
  ])('rejects %s before product upsert', async (_label, nodes) => {
    const h = adminHarness(request => request.query.includes('query ShadowIdentityDefinition') ? { metafieldDefinitions: { nodes } } : defaultData(request));
    await expect(h.client.create(offerId, source, digest, at)).rejects.toMatchObject({ outcome: 'rejected', providerCode: 'shadow_identity_definition' });
    expect(h.requests.some(r => r.query.includes('mutation ShadowSet'))).toBe(false);
  });

  it.each([
    ['null product', { product: null, userErrors: [] }],
    ['user error', { product: product(), userErrors: [{ code: 'INVALID' }] }],
  ])('treats %s as an incomplete upsert requiring reconciliation', async (_label, result) => {
    const h = adminHarness(request => request.query.includes('ShadowSet') ? { productSet: result } : defaultData(request));
    await expect(h.client.create(offerId, source, digest, at)).rejects.toMatchObject({ outcome: 'unknown', providerCode: 'shadow_create_rejected' });
  });

  it('publishes only to the explicitly selected controlled-store publication', async () => {
    const h = adminHarness();
    await h.client.publish(sandbox.shadowProductId);
    expect(h.requests[0]!.query).toContain('publishablePublish(id: $id, input: $input)');
    expect(h.requests[0]!.query).toContain('userErrors { field message }');
    expect(h.requests[0]!.query).not.toMatch(/userErrors\s*\{[^}]*\bcode\b/);
    expect(h.requests[0]!.variables).toEqual({ id: sandbox.shadowProductId, input: [{ publicationId }] });
  });

  it('surfaces publication user errors as a preparation failure', async () => {
    const h = adminHarness(() => ({ publishablePublish: { userErrors: [{ field: ['input', 'publicationId'], message: 'Synthetic publication rejected' }] } }));
    await expect(h.client.publish(sandbox.shadowProductId)).rejects.toMatchObject({ outcome: 'not_sent', providerCode: 'shadow_publication' });
  });
});

const intent: RetailIntent = { category: 'retail', query: 'tote', quantity: 1, shipToCountry: 'US', spendCeiling: money('USD', 10000) };
const fulfillment: RetailFulfillment = { category: 'retail', email: 'buyer@example.test', shippingAddress: {
  firstName: 'Example', lastName: 'Buyer', address1: '1 Synthetic Street', city: 'Seattle', province: 'WA', zip: '98101', countryCode: 'US' } };
function quote(): ProviderQuote {
  return { title: 'Canvas tote', breakdown: [{ kind: 'item', label: 'Tote', amount: money('USD', 1999) },
    { kind: 'shipping', label: 'Sandbox shipping', amount: money('USD', 500) }], merchantTotal: money('USD', 2499),
    terms: ['Base sandbox terms'], fulfillmentSummary: 'Synthetic delivery', executionRef: { cartId: 'synthetic-cart' }, expiresAt: '2026-10-06T12:05:00.000Z' };
}
function executorHarness() {
  const result: ExecutionResult = { kind: 'failed_definite', reason: 'Synthetic no-charge outcome', providerReference: null,
    evidence: [{ source: 'shopify:order', environment: 'test', evidenceMode: 'local_fixture', reference: 'synthetic-order', observedAt: at, details: {} }] };
  const base = { route: 'shopify', category: 'retail', environment: 'test',
    readiness: vi.fn<CommerceExecutor['readiness']>().mockResolvedValue({ component: 'shopify', environment: 'test', status: 'LOCAL_TESTS_ONLY', missing: [], checkedAt: at }),
    search: vi.fn<CommerceExecutor['search']>().mockResolvedValue([]), quote: vi.fn<CommerceExecutor['quote']>().mockImplementation(async () => quote()),
    execute: vi.fn<CommerceExecutor['execute']>().mockResolvedValue(result), retrieve: vi.fn<CommerceExecutor['retrieve']>().mockResolvedValue(result) } satisfies CommerceExecutor;
  const catalog = { search: vi.fn<CommerceExecutor['search']>().mockResolvedValue([]) };
  const shadow = { prepare: vi.fn(async () => ({ sourceOffer: source, sandboxRepresentation: sandbox })) };
  const executor = new GlobalSandboxExecutor(base, catalog, shadow);
  const ctx: ExecutionContext = { purchaseId: 'purchase', attemptId: 'attempt', idempotencyKey: 'attempt',
    quote: { quoteId: 'quote', merchantTotal: money('USD', 2499), executionRef: { cartId: 'synthetic-cart' }, expiresAt: '2026-10-06T12:05:00.000Z' },
    fulfillment, checkpoints: {}, checkpoint: vi.fn(async () => {}) };
  return { base, catalog, shadow, executor, ctx, result };
}

describe('Global sandbox executor compatibility and quote gate', () => {
  it('delegates existing controlled search, quote, execution, retrieval and readiness without shadow work', async () => {
    const h = executorHarness();
    const offer = { executionRef: { variantId: 'gid://shopify/ProductVariant/1', quantity: 1 }, intent };
    expect(await h.executor.readiness()).toMatchObject({ status: 'LOCAL_TESTS_ONLY' });
    await h.executor.search(intent);
    expect(h.base.search).toHaveBeenCalledWith(intent);
    expect(await h.executor.quote(offer, fulfillment)).toEqual(quote());
    expect(h.base.quote).toHaveBeenCalledWith(offer, fulfillment);
    expect(await h.executor.execute(h.ctx)).toBe(h.result);
    expect(await h.executor.retrieve(h.ctx)).toBe(h.result);
    expect(h.base.execute).toHaveBeenCalledWith(h.ctx);
    expect(h.base.retrieve).toHaveBeenCalledWith(h.ctx);
    expect(h.catalog.search).not.toHaveBeenCalled();
    expect(h.shadow.prepare).not.toHaveBeenCalled();
  });

  it('routes only explicit live discovery to Global Catalog', async () => {
    const h = executorHarness();
    const live = { ...intent, discovery: 'live' as const };
    await h.executor.search(live);
    expect(h.catalog.search).toHaveBeenCalledWith(live);
    expect(h.base.search).not.toHaveBeenCalled();
  });

  it('requires source provenance for a live quote before base quote or shadow preparation', async () => {
    const h = executorHarness();
    await expect(h.executor.quote({ executionRef: {}, intent: { ...intent, discovery: 'live' } }, fulfillment))
      .rejects.toMatchObject({ outcome: 'rejected', providerCode: 'source_missing' });
    expect(h.base.quote).not.toHaveBeenCalled();
    expect(h.shadow.prepare).not.toHaveBeenCalled();
  });

  it.each(['preparer', 'offer ID'])('requires a configured %s for a source quote', async missing => {
    const h = executorHarness();
    const executor = missing === 'preparer' ? new GlobalSandboxExecutor(h.base, h.catalog, null) : h.executor;
    await expect(executor.quote({ ...(missing === 'offer ID' ? {} : { offerId }), executionRef: { sourceOffer: source }, intent }, fulfillment))
      .rejects.toMatchObject({ outcome: 'not_sent', providerCode: 'shadow_not_configured' });
    expect(h.base.quote).not.toHaveBeenCalled();
  });

  it('quotes only the prepared shadow variant and preserves separate sandbox costs and provenance', async () => {
    const h = executorHarness();
    const offer = { offerId, executionRef: { sourceOffer: source }, intent: { ...intent, discovery: 'live' as const } };
    const result = await h.executor.quote(offer, fulfillment);
    expect(h.shadow.prepare).toHaveBeenCalledWith(offerId, source, offer.intent);
    expect(h.base.quote).toHaveBeenCalledWith({ ...offer, executionRef: { variantId: sandbox.shadowVariantId, quantity: 1 } }, fulfillment);
    expect(result.merchantTotal).toEqual(money('USD', 2499));
    expect(result.sourceOffer).toEqual(source);
    expect(result.sandboxRepresentation).toEqual(sandbox);
    expect(result.executionRef).toEqual({ cartId: 'synthetic-cart', sourceOffer: source, sandboxRepresentation: sandbox });
    expect(result.terms).toContain(sandbox.boundary);
  });

  it.each(['amount', 'currency', 'scale', 'missing item', 'multiple items'])('rejects a quote with mismatched %s before approval', async mismatch => {
    const h = executorHarness();
    const changed = quote();
    const item = changed.breakdown[0]!;
    if (mismatch === 'amount') item.amount.amountMinor = '2000';
    if (mismatch === 'currency') item.amount.currency = 'SGD';
    if (mismatch === 'scale') item.amount.scale = 3;
    if (mismatch === 'missing item') changed.breakdown.shift();
    if (mismatch === 'multiple items') changed.breakdown.push({ ...item });
    h.base.quote.mockResolvedValue(changed);
    await expect(h.executor.quote({ offerId, executionRef: { sourceOffer: source }, intent }, fulfillment))
      .rejects.toMatchObject({ outcome: 'rejected', providerCode: 'shadow_quote_price_changed' });
  });

  it.each(['execute', 'retrieve'] as const)('keeps %s evidence first and appends source provenance without another payment action', async operation => {
    const h = executorHarness();
    h.ctx.quote.executionRef = { ...h.ctx.quote.executionRef, sourceOffer: source, sandboxRepresentation: sandbox };
    const result = await h.executor[operation](h.ctx);
    expect(result.evidence[0]).toEqual(h.result.evidence[0]);
    expect(result.evidence[1]).toMatchObject({ source: 'shopify:global_catalog', environment: 'production', evidenceMode: 'local_fixture',
      reference: source.variantId, details: { sourceOffer: source, sandboxRepresentation: sandbox } });
    expect(h.base[operation]).toHaveBeenCalledTimes(1);
    expect(h.base[operation === 'execute' ? 'retrieve' : 'execute']).not.toHaveBeenCalled();
    expect(h.shadow.prepare).not.toHaveBeenCalled();
  });
});
