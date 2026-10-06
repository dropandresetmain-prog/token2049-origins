import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../../src/channels/mcp/server.js';
import { offerSelectionGuide, shortlistOf, SHORTLIST_SIZE } from '../../src/channels/mcp/tools.js';
import type { OfferView } from '../../src/contracts/commerce.js';
import { retailIntent } from '../support/harness.js';

const AT = '2026-10-07T00:00:00.000Z';
const offer = (n: number, over: Partial<OfferView> = {}): OfferView => ({
  offerId: `off_TESTOFFER${String(n).padStart(4, '0')}`, category: 'retail', route: 'shopify', providerEnvironment: 'sandbox',
  title: `Adapter ${n}`, description: `Description of adapter ${n}`, indicativePrice: { currency: 'USD', amountMinor: String(1000 + n * 100), scale: 2 },
  terms: [`Term ${n}`], sourceObservedAt: AT, expiresAt: '2026-10-07T01:00:00.000Z', executable: false, ...over,
}) as OfferView;

const withSource = (n: number): OfferView => offer(n, {
  sourceOffer: {
    source: 'shopify_global_catalog', productId: 'gid://shopify/p/ABC123', variantId: 'gid://shopify/ProductVariant/123', merchantId: 'gid://shopify/Shop/1',
    merchantName: `Merchant ${n}`, merchantUrl: 'https://merchant.example/', productTitle: `Adapter ${n}`, variantTitle: `Variant ${n}`,
    productUrl: `https://merchant.example/products/adapter-${n}`, observedPrice: { currency: 'USD', amountMinor: '1500', scale: 2 }, availability: 'available',
    observedAt: AT, schemaVersion: '2026-08-25', evidenceMode: 'local_fixture',
  },
} as Partial<OfferView>);

async function findOffers(offers: OfferView[], opts: { liveOffers?: OfferView[]; intent?: Record<string, unknown> } = {}) {
  const calls: string[] = [];
  const intents: any[] = [];
  const server = createMcpServer({
    gatewayUrl: 'http://stub.invalid', gatewayToken: 't2o_stubtoken0123456789abcdef',
    fetch: (async (url: string, init?: RequestInit) => {
      calls.push(String(url));
      const sent = init?.body ? JSON.parse(String(init.body)) : {};
      intents.push(sent.intent);
      // `liveOffers` lets a test make the live catalog answer differently from the controlled catalog.
      const body = opts.liveOffers && sent.intent?.discovery === 'live' ? opts.liveOffers : offers;
      return new Response(JSON.stringify({ offers: body }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'stub', version: '0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  const res = await client.callTool({ name: 'find_offers', arguments: { intent: opts.intent ?? retailIntent() } }) as any;
  const tools = (await client.listTools()).tools;
  await client.close(); await server.close();
  return { res, calls, intents, tools };
}

describe('find_offers shortlist and explicit selection', () => {
  it('returns at most 3 offers however many the gateway found, and says how many were omitted', async () => {
    const { res } = await findOffers([1, 2, 3, 4, 5].map((n) => offer(n)));
    expect(res.structuredContent.shortlist).toHaveLength(SHORTLIST_SIZE);
    expect(res.structuredContent.offers).toHaveLength(SHORTLIST_SIZE);
    expect(res.structuredContent.totalFound).toBe(5);
    expect(res.content[0].text).toMatch(/top 3 of 5 found/);
    expect(res.content[0].text).not.toContain('off_TESTOFFER0004');
  });

  it('keeps the gateway order and never marks, ranks or selects an offer itself', async () => {
    const { res } = await findOffers([1, 2, 3].map((n) => offer(n)));
    expect(res.structuredContent.shortlist.map((o: any) => o.offerId)).toEqual(['off_TESTOFFER0001', 'off_TESTOFFER0002', 'off_TESTOFFER0003']);
    const json = JSON.stringify(res.structuredContent);
    expect(json).not.toMatch(/"(recommended|selected|chosen|best|rank|score)"/i);
    // The words only appear as an instruction to the host model, never attached to a specific offer.
    for (const line of (res.content[0].text as string).split('\n').filter((l) => /^\d\. /.test(l))) expect(line).not.toMatch(/recommend/i);
  });

  it('gives the host real, comparable fields and does not invent unavailable attributes', async () => {
    const { res } = await findOffers([withSource(1), offer(2)]);
    const [first, second] = res.structuredContent.shortlist;
    expect(first).toMatchObject({ offerId: 'off_TESTOFFER0001', title: 'Adapter 1', category: 'retail', route: 'shopify', indicativePrice: '11.00 USD', merchant: 'Merchant 1', productUrl: 'https://merchant.example/products/adapter-1', variant: 'Variant 1', availability: 'available', terms: ['Term 1'] });
    // An offer without a source merchant simply has no merchant; nothing (rating, shipping speed, stock, brand) is made up.
    expect(second).not.toHaveProperty('merchant');
    expect(Object.keys(second).sort()).toEqual(['category', 'description', 'expiresAt', 'indicativePrice', 'observedAt', 'offerId', 'providerEnvironment', 'route', 'terms', 'title']);
    expect(JSON.stringify(res.structuredContent.shortlist)).not.toMatch(/rating|review|shipping time|delivery|in stock|brand/i);
  });

  it('instructs present -> recommend one -> ask, and makes create_quote explicitly NOT the next action', async () => {
    const { res } = await findOffers([1, 2, 3].map((n) => offer(n)));
    expect(res.structuredContent.interaction).toEqual({
      step: 'present_shortlist', nextAction: 'present_options_and_ask_user_to_choose', createQuoteAllowedNow: false,
      createQuoteAllowedWhen: expect.stringMatching(/explicitly chosen/), presentAtMost: 3, markExactlyOneRecommended: true, recommendationMustUseOnlyListedFields: true, askUserWhichOption: true,
    });
    const text = res.content[0].text as string;
    expect(text).toMatch(/mark exactly ONE as "Recommended"/);
    expect(text).toMatch(/ask which option they want/);
    expect(text).toMatch(/Do NOT call create_quote yet/);
    expect(text).toMatch(/only after the user explicitly chooses one option/);
    // No sentence tells the host to quote now.
    expect(text).not.toMatch(/(?<!not )call create_quote (now|next|with|on)/i);
    expect(text).not.toMatch(/then call create_quote/i);
  });

  it('touches nothing but the search: no quote or purchase request is made', async () => {
    const { calls } = await findOffers([1, 2, 3].map((n) => offer(n)));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/\/v1\/offers\/search$/);
  });

  it('asks to refine instead of quoting when nothing is found', async () => {
    const { res } = await findOffers([]);
    expect(res.structuredContent.interaction).toMatchObject({ nextAction: 'ask_user_to_refine_search', createQuoteAllowedNow: false });
    expect(res.content[0].text).toMatch(/refine/);
  });

  it('declares in the tool descriptions that the user must choose before create_quote', async () => {
    const { tools } = await findOffers([offer(1)]);
    expect(tools.find((t) => t.name === 'find_offers')!.description).toMatch(/let the user choose before calling create_quote/);
    expect(tools.find((t) => t.name === 'create_quote')!.description).toMatch(/Call only after the user picked one of the presented offers/);
  });

  it('exposes pure helpers consistent with the tool output', () => {
    expect(shortlistOf([1, 2, 3, 4].map((n) => offer(n)))).toHaveLength(3);
    expect(offerSelectionGuide(0).createQuoteAllowedNow).toBe(false);
    expect(offerSelectionGuide(3).createQuoteAllowedNow).toBe(false);
  });

  describe('retail discovery', () => {
    it('searches the live catalog by default for an open retail request', async () => {
      const { intents, res } = await findOffers([offer(9)], { liveOffers: [offer(1), offer(2)] });
      expect(intents).toHaveLength(1);
      expect(intents[0]).toMatchObject({ category: 'retail', discovery: 'live' });
      expect(res.structuredContent.shortlist.map((o: any) => o.offerId)).toEqual(['off_TESTOFFER0001', 'off_TESTOFFER0002']);
    });

    it('falls back to the controlled test catalog only when live discovery finds nothing', async () => {
      const { intents, res } = await findOffers([offer(9)], { liveOffers: [] });
      expect(intents.map((i) => i.discovery)).toEqual(['live', 'controlled_catalog']);
      expect(res.structuredContent.shortlist.map((o: any) => o.offerId)).toEqual(['off_TESTOFFER0009']);
    });

    it('respects an explicit discovery mode and never rewrites non-retail searches', async () => {
      const explicit = await findOffers([offer(9)], { intent: { ...retailIntent(), discovery: 'controlled_catalog' } });
      expect(explicit.intents.map((i) => i.discovery)).toEqual(['controlled_catalog']);
      const hotel = await findOffers([offer(9)], { intent: { category: 'hotel', destination: { cityName: 'Singapore', countryCode: 'SG' }, checkin: '2026-12-01', checkout: '2026-12-03', occupancies: [{ adults: 1 }], guestNationality: 'SG', spendCeiling: { currency: 'USD', amountMinor: '200000', scale: 2 } } });
      for (const i of hotel.intents) expect(i).not.toHaveProperty('discovery');
    });
  });
});
