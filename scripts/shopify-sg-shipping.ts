import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { AdminTransport } from '../src/execution/shopify/adminTransport.js';
import { loadShopifyConfig, type ShopifyConfig } from '../src/execution/shopify/config.js';
import { SANDBOX_STORE } from '../src/execution/shopify/shadowAdmin.js';
import { systemClock } from '../src/infrastructure/clock.js';
import { toMoney } from '../src/execution/shopify/money.js';

export const SG_MARKET = 'gid://shopify/Market/72964341817';
export const SG_LOCATION = 'gid://shopify/Location/96693715001';
const Nodes = <T extends z.ZodType>(node: T) => z.object({ nodes: z.array(node), pageInfo: z.object({ hasNextPage: z.boolean() }) });
const Shipping = z.object({ isEnabled: z.boolean(), optionDefinitions: Nodes(z.object({
  id: z.string(), __typename: z.string(), currency: z.string(), isActive: z.boolean(), freeDeliveryMinimumValue: z.unknown().nullable(),
  name: z.string().optional(), rateGroups: Nodes(z.object({ conditions: z.object({
    collections: Nodes(z.object({ id: z.string() })).nullable(), originLocations: Nodes(z.object({ id: z.string() })).nullable(),
  }), rate: z.object({ price: z.object({ amount: z.string(), currencyCode: z.string() }) }) })).optional(),
})) });
const Snapshot = z.object({
  shop: z.object({ myshopifyDomain: z.string(), currencyCode: z.string(), plan: z.object({ partnerDevelopment: z.boolean() }) }),
  market: z.object({ id: z.string(), status: z.string(), regions: Nodes(z.object({ code: z.string() })),
    parentMarkets: Nodes(z.object({ id: z.string() })), delivery: z.object({ shipping: Shipping.nullable() }) }).nullable(),
  location: z.object({ id: z.string(), isActive: z.boolean(), fulfillsOnlineOrders: z.boolean(), shipsInventory: z.boolean() }).nullable(),
});
const QUERY = `query SandboxSingaporeShipping {
  shop { myshopifyDomain currencyCode plan { partnerDevelopment } }
  market(id: "${SG_MARKET}") { id status
    regions(first: 10) { nodes { ... on MarketRegionCountry { code } } pageInfo { hasNextPage } }
    parentMarkets(first: 10) { nodes { id } pageInfo { hasNextPage } }
    delivery { shipping { isEnabled optionDefinitions(first: 10) { pageInfo { hasNextPage } nodes {
      id __typename currency isActive freeDeliveryMinimumValue { amount currencyCode }
      ... on DeliveryFlatRateOptionDefinition { name rateGroups(first: 10) { pageInfo { hasNextPage } nodes {
        conditions { collections(first: 10) { nodes { id } pageInfo { hasNextPage } }
          originLocations(first: 10) { nodes { id } pageInfo { hasNextPage } } }
        rate { price { amount currencyCode } }
      } } }
    } } } }
  }
  location(id: "${SG_LOCATION}") { id isActive fulfillsOnlineOrders shipsInventory }
}`;

/** Operator-only repair of one known sandbox gap. Quotes never mutate market configuration. */
export class SandboxSingaporeShipping extends AdminTransport {
  constructor(cfg: ShopifyConfig, fetchImpl: typeof fetch = fetch) {
    super(cfg, fetchImpl, systemClock);
    if (cfg.storeDomain !== SANDBOX_STORE || !cfg.devStoreConfirmed || !cfg.bogusGatewayEnabled)
      throw new Error('Controlled development store and Bogus gateway confirmation required');
  }
  async inspect() {
    const s = await this.gql(QUERY, {}, Snapshot);
    const m = s.market, l = s.location;
    if (s.shop.myshopifyDomain !== SANDBOX_STORE || !s.shop.plan.partnerDevelopment || s.shop.currencyCode !== 'USD' ||
        !m || m.id !== SG_MARKET || m.status !== 'ACTIVE' || m.regions.pageInfo.hasNextPage ||
        m.regions.nodes.length !== 1 || m.regions.nodes[0]!.code !== 'SG' ||
        m.parentMarkets.pageInfo.hasNextPage || m.parentMarkets.nodes.length ||
        !l || l.id !== SG_LOCATION || !l.isActive || !l.fulfillsOnlineOrders || !l.shipsInventory)
      throw new Error('Sandbox Singapore market or fulfillment boundary changed; operator review required');
    return m.delivery.shipping;
  }
  private verify(s: z.infer<typeof Shipping>) {
    const option = s.optionDefinitions.nodes[0], groups = option?.rateGroups, group = groups?.nodes[0];
    if (!s.isEnabled || s.optionDefinitions.pageInfo.hasNextPage || s.optionDefinitions.nodes.length !== 1 ||
        !option || option.__typename !== 'DeliveryFlatRateOptionDefinition' || !option.isActive || option.currency !== 'USD' ||
        option.name !== 'Standard' || option.freeDeliveryMinimumValue !== null ||
        !groups || groups.pageInfo.hasNextPage || groups.nodes.length !== 1 || !group ||
        group.conditions.collections?.pageInfo.hasNextPage || (group.conditions.collections?.nodes.length ?? 0) ||
        !group.conditions.originLocations || group.conditions.originLocations.pageInfo.hasNextPage || group.conditions.originLocations.nodes.length !== 1 ||
        group.conditions.originLocations.nodes[0]!.id !== SG_LOCATION ||
        group.rate.price.currencyCode !== 'USD' || toMoney(group.rate.price).amountMinor !== '800')
      throw new Error('Existing Singapore shipping differs from the controlled USD 8 Standard rate; operator review required');
    return option.id;
  }
  async run(apply = false): Promise<{ status: 'missing' | 'configured' | 'repaired'; optionId?: string }> {
    const before = await this.inspect();
    if (before) return { status: 'configured', optionId: this.verify(before) };
    if (!apply) return { status: 'missing' };
    // A null shipping configuration without a parent inherits no shipping, even when a legacy
    // delivery profile lists a rate. Add only the equivalent rate in the effective market model.
    const result = await this.gql(`mutation SandboxSingaporeShippingRepair($id: ID!, $input: MarketUpdateInput!) {
      marketUpdate(id: $id, input: $input) { userErrors { code } }
    }`, { id: SG_MARKET, input: { delivery: { shipping: { isEnabled: true, optionDefinitionsToCreate: [{
      flatRate: { name: 'Standard', currency: 'USD', isActive: true, rateGroups: [{
        conditions: { originLocationsToAdd: [SG_LOCATION] }, rate: { price: { amount: '8.00', currencyCode: 'USD' } },
      }] },
    }] } } } }, z.object({ marketUpdate: z.object({ userErrors: z.array(z.object({ code: z.string().optional() })) }) }));
    if (result.marketUpdate.userErrors.length) throw new Error('Singapore shipping update rejected; inspect before retrying');
    const after = await this.inspect();
    if (!after) throw new Error('Singapore shipping update not visible; inspect before retrying');
    return { status: 'repaired', optionId: this.verify(after) };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.slice(2).some(arg => arg !== '--apply')) throw new Error('Usage: tsx scripts/shopify-sg-shipping.ts [--apply]');
  try {
    console.log(JSON.stringify(await new SandboxSingaporeShipping(loadShopifyConfig(process.env).config).run(process.argv.includes('--apply'))));
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Singapore shipping check failed');
    process.exitCode = 1;
  }
}
