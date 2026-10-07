import { describe, expect, it, vi } from 'vitest';
import { SandboxSingaporeShipping, SG_MARKET, SG_LOCATION } from '../../scripts/shopify-sg-shipping.js';
import { loadShopifyConfig } from '../../src/execution/shopify/config.js';
import { SANDBOX_STORE } from '../../src/execution/shopify/shadowAdmin.js';

const cfg = loadShopifyConfig({ SHOPIFY_STORE_DOMAIN: SANDBOX_STORE, SHOPIFY_CLIENT_ID: 'fixture', SHOPIFY_CLIENT_SECRET: 'fixture',
  SHOPIFY_DEV_STORE_CONFIRMED: 'true', SHOPIFY_BOGUS_GATEWAY_ENABLED: 'true' }).config;
const nodes = <T>(items: T[]) => ({ nodes: items, pageInfo: { hasNextPage: false } });
const shipping = () => ({ isEnabled: true, optionDefinitions: nodes([{
  id: 'gid://shopify/DeliveryFlatRateOptionDefinition/123', __typename: 'DeliveryFlatRateOptionDefinition', currency: 'USD',
  isActive: true, freeDeliveryMinimumValue: null, name: 'Standard', rateGroups: nodes([{
    conditions: { collections: null as ReturnType<typeof nodes<{ id: string }>> | null, originLocations: nodes([{ id: SG_LOCATION }]) },
    rate: { price: { amount: '8.0', currencyCode: 'USD' } },
  }]),
}]) });
const snapshot = () => ({
  shop: { myshopifyDomain: SANDBOX_STORE, currencyCode: 'USD', plan: { partnerDevelopment: true } },
  market: { id: SG_MARKET, status: 'ACTIVE', regions: nodes([{ code: 'SG' }]), parentMarkets: nodes<{ id: string }>([]),
    delivery: { shipping: null as ReturnType<typeof shipping> | null } },
  location: { id: SG_LOCATION, isActive: true, fulfillsOnlineOrders: true, shipsInventory: true },
});
function fixture(s = snapshot(), behavior: 'success' | 'rejected' | 'unknown' | 'invisible' = 'success') {
  const mutations: Record<string, any>[] = [];
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/access_token')) return Response.json({ access_token: 'fixture', expires_in: 86400 });
    const request = JSON.parse(String(init?.body));
    if (request.query.startsWith('mutation')) {
      mutations.push(request);
      if (behavior === 'unknown') { s.market.delivery.shipping = shipping(); throw new Error('connection lost after mutation'); }
      if (behavior === 'success') s.market.delivery.shipping = shipping();
      return Response.json({ data: { marketUpdate: { userErrors: behavior === 'rejected' ? [{ code: 'INVALID' }] : [] } } });
    }
    return Response.json({ data: s });
  });
  return { client: new SandboxSingaporeShipping(cfg, fetchImpl), mutations };
}

describe('Singapore sandbox market shipping repair', () => {
  it('detects missing effective market shipping without treating legacy profile rates as fulfillment evidence', async () => {
    const f = fixture();
    expect(await f.client.run()).toEqual({ status: 'missing' });
    expect(f.mutations).toHaveLength(0);
  });
  it('adds only the equivalent SG market rate with the controlled origin, verifies readback and repeats without another mutation', async () => {
    const f = fixture();
    expect(await f.client.run(true)).toMatchObject({ status: 'repaired' });
    expect(f.mutations[0]!.variables).toEqual({ id: SG_MARKET, input: { delivery: { shipping: {
      isEnabled: true, optionDefinitionsToCreate: [{ flatRate: { name: 'Standard', currency: 'USD', isActive: true,
        rateGroups: [{ conditions: { originLocationsToAdd: [SG_LOCATION] }, rate: { price: { amount: '8.00', currencyCode: 'USD' } } }] } }],
    } } } });
    expect(await f.client.run(true)).toMatchObject({ status: 'configured' });
    expect(f.mutations).toHaveLength(1);
  });
  it.each(['production', 'currency', 'country', 'parent', 'inactive', 'location', 'pagination'])('never writes across a changed %s boundary', async failure => {
    const s = snapshot();
    if (failure === 'production') s.shop.plan.partnerDevelopment = false;
    if (failure === 'currency') s.shop.currencyCode = 'SGD';
    if (failure === 'country') s.market.regions.nodes.push({ code: 'US' });
    if (failure === 'parent') s.market.parentMarkets.nodes.push({ id: 'other' });
    if (failure === 'inactive') s.market.status = 'DRAFT';
    if (failure === 'location') s.location.shipsInventory = false;
    if (failure === 'pagination') s.market.regions.pageInfo.hasNextPage = true;
    const f = fixture(s);
    await expect(f.client.run(true)).rejects.toThrow('boundary changed');
    expect(f.mutations).toHaveLength(0);
  });
  it.each(['disabled', 'price', 'currency', 'location', 'collection', 'pagination'])('preserves existing %s configuration for operator review', async failure => {
    const s = snapshot(); s.market.delivery.shipping = shipping();
    const o = s.market.delivery.shipping.optionDefinitions.nodes[0]!, g = o.rateGroups.nodes[0]!;
    if (failure === 'disabled') s.market.delivery.shipping.isEnabled = false;
    if (failure === 'price') g.rate.price.amount = '9.00';
    if (failure === 'currency') o.currency = 'SGD';
    if (failure === 'location') g.conditions.originLocations.nodes[0]!.id = 'other';
    if (failure === 'collection') g.conditions.collections = nodes([{ id: 'other' }]);
    if (failure === 'pagination') o.rateGroups.pageInfo.hasNextPage = true;
    const f = fixture(s);
    await expect(f.client.run(true)).rejects.toThrow('differs');
    expect(f.mutations).toHaveLength(0);
  });
  it.each(['rejected', 'invisible'] as const)('requires successful independent readback after a %s write', async behavior => {
    const f = fixture(snapshot(), behavior);
    await expect(f.client.run(true)).rejects.toThrow();
    expect(f.mutations).toHaveLength(1);
  });
  it('recovers an unknown write outcome by inspecting configuration before a new apply', async () => {
    const f = fixture(snapshot(), 'unknown');
    await expect(f.client.run(true)).rejects.toThrow();
    expect(await f.client.run(true)).toMatchObject({ status: 'configured' });
    expect(f.mutations).toHaveLength(1);
  });
  it('rejects a different store or missing sandbox confirmations before transport', () => {
    expect(() => new SandboxSingaporeShipping({ ...cfg, storeDomain: 'other.myshopify.com' })).toThrow('Controlled');
    expect(() => new SandboxSingaporeShipping({ ...cfg, bogusGatewayEnabled: false })).toThrow('Controlled');
  });
});
