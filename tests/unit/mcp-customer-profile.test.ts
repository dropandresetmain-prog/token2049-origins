import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startHarness, retailIntent, type Harness } from '../support/harness.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { createMcpServer } from '../../src/channels/mcp/server.js';
import { DEMO_DISCLOSURE, SOURCE_STORE_NOTE, demoDisclosure } from '../../src/channels/mcp/tools.js';
import { demoData } from '../../src/demo/config.js';
import { providerRequirements } from '../../src/contracts/input.js';
import type { McpConfig } from '../../src/channels/mcp/config.js';

const profile = demoData.customerProfile;
const usd = (amountMinor: string) => ({ currency: 'USD', amountMinor, scale: 2 });
const intents = {
  retail: retailIntent(),
  hotel: { category: 'hotel', destination: { cityName: 'Singapore', countryCode: 'SG' }, checkin: '2026-12-01', checkout: '2026-12-03', occupancies: [{ adults: 1 }], guestNationality: 'SG', spendCeiling: usd('200000') },
  flight: { category: 'flight', from: 'MNL', to: 'CEB', departDate: '2026-12-01', adults: 1, spendCeiling: usd('100000') },
} as const;
const PII = ['DEMO123456', '1993-01-01', '6500000000', '65-00000000', 'min.htet.hset', 'Bayfront', '018956', 'Hset'];

interface Result { isError?: boolean; structuredContent?: any; content: Array<{ text: string }> }
const text = (r: Result) => r.content.map(c => c.text).join('\n');
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

describe('hosted MCP saved customer profile', () => {
  let h: Harness;
  let sent: Array<{ path: string; body: any }>;
  let override: ((path: string) => Response | null) | null;
  let logged: string;
  let cfg: McpConfig;

  beforeEach(async () => {
    h = await startHarness();
    const token = (await createClient(h.gw.db, { customerId: h.alice.customerId, displayName: 'Alice', channel: 'mcp', label: 'alice-profile' }, h.clock.now().toISOString())).token;
    sent = []; override = null; logged = '';
    cfg = { gatewayUrl: h.url, gatewayToken: token, fetch: (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      if (init?.method === 'POST') sent.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      return override?.(path) ?? fetch(url, init);
    }) as typeof fetch };
    for (const stream of ['stdout', 'stderr'] as const) vi.spyOn(process[stream], 'write').mockImplementation(((chunk: unknown) => { logged += String(chunk); return true; }) as never);
    for (const level of ['log', 'info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logged += a.join(' '); });
  });
  afterEach(async () => { vi.restoreAllMocks(); await h.close(); });

  async function session() {
    const server = createMcpServer(cfg, { profile });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'profile-test', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    return { call: async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as unknown as Result, close: async () => { await client.close(); await server.close(); } };
  }
  const quoteFor = async (category: keyof typeof intents, fulfillment: Record<string, unknown> = { category }) => {
    const m = await session();
    const found = await m.call('find_offers', { intent: intents[category] });
    const quoted = await m.call('create_quote', { offerId: found.structuredContent.offers[0].offerId, fulfillment });
    return { m, found, quoted };
  };

  it.each(['retail', 'hotel', 'flight'] as const)('%s: { category } alone yields a quote with the saved profile and no PII question', async (category) => {
    const { m, found, quoted } = await quoteFor(category);
    expect(found.isError).toBeFalsy();
    expect(quoted.isError).toBeFalsy();
    expect(quoted.structuredContent.status).not.toBe('needs_input');
    expect(quoted.structuredContent.quote.quoteId).toMatch(/^quo_/);
    expect(sent.find(s => s.path === '/v1/quotes')!.body.fulfillment).toEqual(profile[category]);
    expect(text(quoted)).not.toMatch(/Ask the user/);
    await m.close();
  });

  it('explicit user values override the saved profile and are sent to the gateway', async () => {
    const { m, quoted } = await quoteFor('retail', { category: 'retail', email: 'ada@example.com', shippingAddress: { phone: '+6591234567' } });
    expect(quoted.isError).toBeFalsy();
    const f = sent.find(s => s.path === '/v1/quotes')!.body.fulfillment;
    expect(f.email).toBe('ada@example.com');
    expect(f.shippingAddress).toEqual({ ...profile.retail.shippingAddress, phone: '+6591234567' });
    await m.close();
  });

  it('asks only for the one field a provider reports as missing', async () => {
    const needs = providerRequirements('flight', 'fulfillment', ['passengers.0.document.number']);
    override = (path) => path === '/v1/quotes'
      ? new Response(JSON.stringify({ error: { code: 'needs_input', message: 'provider requires more input', requestId: 'req_test', details: needs } }), { status: 422, headers: { 'content-type': 'application/json' } })
      : null;
    const { m, quoted } = await quoteFor('flight');
    expect(quoted.structuredContent.status).toBe('needs_input');
    expect(quoted.structuredContent.fields.map((f: any) => f.path)).toEqual(['passengers.0.document.number']);
    expect(text(quoted)).not.toMatch(/name|email|phone|birth|gender|nationality/i);
    await m.close();
  });

  it('keeps normal commerce language, with exactly one demo disclosure before buy', async () => {
    const { m, found, quoted } = await quoteFor('retail');
    const quote = quoted.structuredContent.quote;
    const bought = await m.call('buy', { quoteId: quote.quoteId, maxTotal: quote.payablePrincipal, quoteDigest: quote.digest, selectedFundingOptionId: quote.fundingOptions[0].fundingOptionId });
    for (const t of [text(found), text(quoted), text(bought)]) expect(t).not.toMatch(/fake|synthetic|test traveller|sandbox customer|test environment/i);
    // Offers and buy progress carry no environment caveats; the quote carries the single disclosure.
    expect(text(found)).not.toMatch(/sandbox|testnet|demo/i);
    expect(text(bought)).not.toMatch(/Demo transaction|sandbox/i);
    expect(count(text(quoted), /Demo transaction/g)).toBe(1);
    expect(count(text(quoted), /sandbox/gi)).toBe(1);
    expect(text(quoted)).toContain(DEMO_DISCLOSURE);
    expect(text(quoted)).toContain('Delivering to Marina Bay Sands, Singapore');
    await m.close();
  });

  it('keeps provider environment and disclosure in structured evidence', async () => {
    const { m, quoted } = await quoteFor('retail');
    expect(quoted.structuredContent.quote.providerEnvironment).toBeTruthy();
    expect(quoted.structuredContent.demoDisclosure).toBe(DEMO_DISCLOSURE);
    await m.close();
  });

  it('adds the source-store note only for Shopify Global source offers', () => {
    expect(demoDisclosure({})).toBe(DEMO_DISCLOSURE);
    expect(demoDisclosure({ sourceOffer: {} as never })).toBe(`${DEMO_DISCLOSURE} ${SOURCE_STORE_NOTE}`);
    expect(count(demoDisclosure({ sourceOffer: {} as never }), /Demo transaction/g)).toBe(1);
  });

  it('never emits profile PII in tool output (text or structured) or in logs', async () => {
    const { m, found, quoted } = await quoteFor('flight');
    const quote = quoted.structuredContent.quote;
    const bought = await m.call('buy', { quoteId: quote.quoteId, maxTotal: quote.payablePrincipal, quoteDigest: quote.digest, selectedFundingOptionId: quote.fundingOptions[0].fundingOptionId });
    const retail = await quoteFor('retail');
    const everything = JSON.stringify([found, quoted, bought, retail.found, retail.quoted]) + logged;
    for (const needle of PII) expect(everything).not.toContain(needle);
    await m.close(); await retail.m.close();
  });
});
