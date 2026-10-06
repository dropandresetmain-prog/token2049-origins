import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startHarness, retailIntent, retailFulfillment, type Harness } from '../support/harness.js';
import { FixtureFundingAdapter } from '../support/fixtures.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { createMcpServer } from '../../src/channels/mcp/server.js';
import { registerTools } from '../../src/channels/mcp/tools.js';
import { GatewayClient } from '../../src/channels/mcp/client.js';
import { BridgeClient } from '../../src/channels/mcp/bridge.js';
import { ConfigError, loadConfigFromEnv, secretsOf, type McpConfig, type PayerRail } from '../../src/channels/mcp/config.js';
import { FundingSource, SOLANA_DEVNET_NETWORK, SOLANA_DEVNET_USDC_MINT, maskAddress } from '../../src/contracts/presentation.js';
import type { FundingAdapter } from '../../src/contracts/ports.js';

const TOKENS: Record<PayerRail, string> = { cardano: 'cardano-bridge-secret-0123456789', solana: 'solana-bridge-secret-0123456789' };
const SOLANA_PAYER = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const SOLANA_PAYEE = 'So11111111111111111111111111111111111111112';
const CARDANO_PAYER = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';

type Mode = 'fund' | 'fund_then_500' | 'reject' | 'down';
interface FakeBridge { rail: PayerRail; url: string; calls: string[]; mode: Mode; close(): Promise<void> }

/**
 * Fake per-rail payer bridge implementing the documented GET /status and POST /pay contract. /pay funds the
 * purchase through the gateway's fixture rail with a header matching the purchase's own requirement.
 */
async function startFakeBridge(h: Harness, rail: PayerRail, source?: unknown): Promise<FakeBridge> {
  const state: FakeBridge = { rail, url: '', calls: [], mode: 'fund', close: async () => undefined };
  const own = FundingSource.parse(rail === 'cardano'
    ? { sourceId: 'src_' + 'a'.repeat(32), rail, network: 'cardano:preprod', publicAddress: CARDANO_PAYER, displayAddress: maskAddress(CARDANO_PAYER), assetId: h.funding.acceptedAsset().assetId, readiness: 'configured' }
    : { sourceId: 'src_' + 'b'.repeat(32), rail, network: SOLANA_DEVNET_NETWORK, publicAddress: SOLANA_PAYER, displayAddress: maskAddress(SOLANA_PAYER), assetId: SOLANA_DEVNET_USDC_MINT, readiness: 'configured' });
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (state.mode === 'down' && req.url !== '/pay') return send(503, { ok: false, error: { code: 'internal', message: 'down' } });
      if (req.url === '/status' && req.method === 'GET') return send(200, { ok: true, source: source ?? own });
      if (req.url !== '/pay' || req.method !== 'POST') return send(404, { ok: false, error: { code: 'not_found', message: 'no route' } });
      if (req.headers.authorization !== `Bearer ${TOKENS[rail]}`) return send(401, { ok: false, error: { code: 'unauthenticated', message: 'bad bridge token' } });
      const { purchaseId } = JSON.parse(raw) as { purchaseId: string };
      state.calls.push(purchaseId);
      if (state.mode === 'down') return send(503, { ok: false, error: { code: 'internal', message: 'down' } });
      if (state.mode === 'reject') return send(422, { ok: false, error: { code: 'payment_rejected', message: 'payer refused' } });
      const got = await h.call('GET', `/v1/purchases/${purchaseId}`, { token: h.alice.token });
      const amount = got.body.purchase.fundingRequirement.amount.amountBaseUnits as string;
      const fund = await h.call('POST', `/v1/purchases/${purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:${rail}-${purchaseId}:${amount}` } });
      if (state.mode === 'fund_then_500') return send(500, { ok: false, error: { code: 'bridge_crash', message: 'crashed after paying' } });
      if (fund.status !== 202) return send(502, { ok: false, error: { code: fund.body.error.code, message: fund.body.error.message } });
      send(200, { ok: true, payment: { transferReference: `${rail}-${purchaseId}` } });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise<void>((r) => server.close(() => r()));
  return state;
}

/** Fixture Solana rail with the real Devnet network and mint identities. */
function solanaFixtureAdapter(h: Harness): FundingAdapter {
  const fixture = new FixtureFundingAdapter(h.clock);
  return {
    rail: 'solana', network: SOLANA_DEVNET_NETWORK, paymentHeaderName: 'payment-signature',
    acceptedAsset: () => ({ assetId: SOLANA_DEVNET_USDC_MINT, decimals: 6, symbol: 'Devnet test USDC', payTo: SOLANA_PAYEE, supportsUsdNotional: true }),
    readiness: () => fixture.readiness(),
    paymentRequirements: (r) => fixture.paymentRequirements(r),
    verify: async (header, r) => {
      const v = await fixture.verify(header, r);
      return v.ok ? { ok: true, funding: { ...v.funding, rail: 'solana', network: SOLANA_DEVNET_NETWORK, assetId: SOLANA_DEVNET_USDC_MINT, payer: SOLANA_PAYER, payee: SOLANA_PAYEE } } : v;
    },
  };
}

interface ToolResult { isError?: boolean; structuredContent?: any; content: Array<{ type: string; text: string }> }
async function connectServer(server: McpServer) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    call: async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as unknown as ToolResult,
    close: async () => { await client.close(); await server.close(); },
  };
}

describe('MCP dual-rail payer parity', () => {
  let h: Harness;
  let cfg: McpConfig;
  let cardano: FakeBridge;
  let solana: FakeBridge;
  const bothBridges = () => ({ ...cfg, bridges: { cardano: { url: cardano.url, token: TOKENS.cardano }, solana: { url: solana.url, token: TOKENS.solana } } });

  beforeEach(async () => {
    h = await startHarness();
    h.gw.core.deps.fundingAdapters.set('solana', solanaFixtureAdapter(h));
    const mcpToken = (await createClient(h.gw.db, { customerId: h.alice.customerId, displayName: 'Alice', channel: 'mcp', label: 'alice-mcp' }, h.clock.now().toISOString())).token;
    cfg = { gatewayUrl: h.url, gatewayToken: mcpToken };
    cardano = await startFakeBridge(h, 'cardano');
    solana = await startFakeBridge(h, 'solana');
  });
  afterEach(async () => { await cardano.close(); await solana.close(); await h.close(); });

  const connectBoth = () => connectServer(createMcpServer(bothBridges()));

  async function quoteViaMcp(m: Awaited<ReturnType<typeof connectBoth>>) {
    const found = await m.call('find_offers', { intent: retailIntent() });
    const q = await m.call('create_quote', { offerId: found.structuredContent.offers[0].offerId, fulfillment: retailFulfillment });
    expect(q.isError).toBeFalsy();
    return { quote: q.structuredContent.quote as any, result: q };
  }
  const option = (quote: any, rail: PayerRail) => quote.fundingOptions.find((o: any) => o.rail === rail);
  const buyArgs = (quote: any, rail: PayerRail, extra: Record<string, unknown> = {}) => ({
    quoteId: quote.quoteId, maxTotal: quote.payablePrincipal, quoteDigest: quote.digest, selectedFundingOptionId: option(quote, rail).fundingOptionId, ...extra,
  });
  const purchaseCount = async () => (await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM purchases'))!.n;

  describe('quote presentation', () => {
    it('matches each option to its own connected source and selects nothing', async () => {
      const m = await connectBoth();
      try {
        const { quote, result } = await quoteViaMcp(m);
        expect(quote.fundingOptions.map((o: any) => o.rail)).toEqual(['cardano', 'solana']);
        const sources = result.structuredContent.fundingSources as FundingSource[];
        expect(sources.map((s) => s.rail).sort()).toEqual(['cardano', 'solana']);
        const lines = result.content[0]!.text.split('\n');
        const cardanoLine = lines.find((l) => l.startsWith('- cardano'))!;
        const solanaLine = lines.find((l) => l.startsWith('- solana'))!;
        expect(cardanoLine).toContain(`Connected wallet ${maskAddress(CARDANO_PAYER)}`);
        expect(solanaLine).toContain(`Connected wallet ${maskAddress(SOLANA_PAYER)}`);
        expect(cardanoLine).toContain(option(quote, 'cardano').fundingOptionId);
        expect(solanaLine).toContain(option(quote, 'solana').fundingOptionId);
        expect(result.content[0]!.text).toContain('select one available funding option');
        // No choice => no purchase and no payer action on either rail.
        const needs = await m.call('buy', { quoteId: quote.quoteId, maxTotal: quote.payablePrincipal, quoteDigest: quote.digest });
        expect(needs.structuredContent.status).toBe('needs_input');
        expect(cardano.calls).toHaveLength(0);
        expect(solana.calls).toHaveLength(0);
        expect(await purchaseCount()).toBe(0);
      } finally { await m.close(); }
    });

    it('shows only the connected rail as connected when one bridge is absent', async () => {
      const m = await connectServer(createMcpServer({ ...cfg, bridges: { solana: { url: solana.url, token: TOKENS.solana } } }));
      try {
        const { result } = await quoteViaMcp(m);
        const lines = result.content[0]!.text.split('\n');
        expect(lines.find((l) => l.startsWith('- solana'))).toContain('Connected wallet');
        expect(lines.find((l) => l.startsWith('- cardano'))).toContain('External payment action required');
      } finally { await m.close(); }
    });

    it('does not treat a bridge that reports the wrong rail as a payer for its configured rail', async () => {
      const wrong = await startFakeBridge(h, 'cardano'); // serves a Cardano source
      const m = await connectServer(createMcpServer({ ...cfg, bridges: { solana: { url: wrong.url, token: TOKENS.cardano } } }));
      try {
        const { quote, result } = await quoteViaMcp(m);
        expect(result.structuredContent.fundingSources).toEqual([]);
        const bought = await m.call('buy', buyArgs(quote, 'solana'));
        expect(bought.structuredContent.status).toBe('action_required');
        expect(wrong.calls).toHaveLength(0);
        expect(await purchaseCount()).toBe(0);
      } finally { await m.close(); await wrong.close(); }
    });
  });

  describe.each(['cardano', 'solana'] as const)('explicit %s selection', (rail) => {
    const other: PayerRail = rail === 'cardano' ? 'solana' : 'cardano';
    const mine = () => (rail === 'cardano' ? cardano : solana);
    const theirs = () => (rail === 'cardano' ? solana : cardano);

    it('uses exactly one payer call on the selected rail and none on the other', async () => {
      const m = await connectBoth();
      try {
        const { quote } = await quoteViaMcp(m);
        const bought = await m.call('buy', buyArgs(quote, rail));
        expect(bought.isError).toBeFalsy();
        expect(mine().calls).toHaveLength(1);
        expect(theirs().calls).toHaveLength(0);
        expect(bought.structuredContent.payment).toMatchObject({ attempted: true, ok: true });
        expect(bought.structuredContent.purchase.fundingRequirement.rail).toBe(rail);
        expect(bought.structuredContent.purchase.paymentState).toBe('confirmed');
        await h.gw.worker.tick();
        const done = await m.call('get_purchase', { purchaseId: bought.structuredContent.purchase.purchaseId });
        expect(done.structuredContent.purchase.state).toBe('succeeded');
        expect(h.retail.executeCalls).toBe(1);
      } finally { await m.close(); }
    });

    it(`never falls back to ${other} when the ${rail} payer is unavailable`, async () => {
      const m = await connectBoth();
      try {
        const { quote } = await quoteViaMcp(m);
        mine().mode = 'down';
        const bought = await m.call('buy', buyArgs(quote, rail));
        expect(bought.structuredContent.status).toBe('action_required');
        expect(bought.structuredContent.purchase).toBeUndefined();
        expect(mine().calls).toHaveLength(0);
        expect(theirs().calls).toHaveLength(0);
        expect(await purchaseCount()).toBe(0);
      } finally { await m.close(); }
    });

    it(`never falls back to ${other} when the ${rail} payer refuses to pay`, async () => {
      const m = await connectBoth();
      try {
        const { quote } = await quoteViaMcp(m);
        mine().mode = 'reject';
        const bought = await m.call('buy', buyArgs(quote, rail));
        expect(bought.structuredContent.status).toBe('payment_failed');
        expect(bought.structuredContent.payment).toMatchObject({ attempted: true, ok: false, code: 'payment_rejected' });
        expect(mine().calls).toHaveLength(1);
        expect(theirs().calls).toHaveLength(0);
        // Repeating follows the same purchase and does not ask any payer again.
        const again = await m.call('buy', buyArgs(quote, rail));
        expect(again.structuredContent.purchase.purchaseId).toBe(bought.structuredContent.purchase.purchaseId);
        expect(mine().calls).toHaveLength(1);
        expect(theirs().calls).toHaveLength(0);
        expect(await purchaseCount()).toBe(1);
      } finally { await m.close(); }
    });

    it('repeated buy follows the same purchase with no second payer action', async () => {
      const m = await connectBoth();
      try {
        const { quote } = await quoteViaMcp(m);
        const first = await m.call('buy', buyArgs(quote, rail));
        const second = await m.call('buy', buyArgs(quote, rail));
        const third = await m.call('buy', buyArgs(quote, rail, { idempotencyKey: 'another-approved-key' }));
        const id = first.structuredContent.purchase.purchaseId;
        expect(second.structuredContent.purchase.purchaseId).toBe(id);
        expect(third.structuredContent.purchase.purchaseId).toBe(id);
        expect(mine().calls).toHaveLength(1);
        expect(theirs().calls).toHaveLength(0);
        expect(await purchaseCount()).toBe(1);
      } finally { await m.close(); }
    });

    it('concurrent repeated buy causes at most one payer call and one purchase', async () => {
      const m = await connectBoth();
      try {
        const { quote } = await quoteViaMcp(m);
        const results = await Promise.all([1, 2, 3, 4].map(() => m.call('buy', buyArgs(quote, rail))));
        expect(new Set(results.map((r) => r.structuredContent.purchase.purchaseId)).size).toBe(1);
        expect(mine().calls.length).toBeLessThanOrEqual(1);
        expect(theirs().calls).toHaveLength(0);
        expect(await purchaseCount()).toBe(1);
      } finally { await m.close(); }
    });

    it('re-reads durable gateway state after an ambiguous bridge response and never pays again', async () => {
      const m = await connectBoth();
      try {
        const { quote } = await quoteViaMcp(m);
        mine().mode = 'fund_then_500';
        const first = await m.call('buy', buyArgs(quote, rail));
        // The bridge reported an error but the gateway already holds the confirmed funding.
        expect(first.structuredContent.payment).toMatchObject({ attempted: true, ok: false });
        expect(first.structuredContent.purchase.paymentState).toBe('confirmed');
        expect(first.structuredContent.status).not.toBe('payment_failed');
        expect(first.isError).toBeFalsy();
        const again = await m.call('buy', buyArgs(quote, rail));
        expect(again.structuredContent.purchase.purchaseId).toBe(first.structuredContent.purchase.purchaseId);
        expect(mine().calls).toHaveLength(1);
        expect(theirs().calls).toHaveLength(0);
      } finally { await m.close(); }
    });

    it(`requires fresh authorization to switch to ${other} after a ${rail} purchase exists`, async () => {
      const m = await connectBoth();
      try {
        const { quote } = await quoteViaMcp(m);
        const first = await m.call('buy', buyArgs(quote, rail));
        const switched = await m.call('buy', buyArgs(quote, other));
        expect(switched.structuredContent.error.code).toBe('conflict');
        expect(switched.structuredContent.purchase.purchaseId).toBe(first.structuredContent.purchase.purchaseId);
        expect(theirs().calls).toHaveLength(0);
        expect(mine().calls).toHaveLength(1);
      } finally { await m.close(); }
    });

    it('is payable with only that rail connected, and the other rail then needs external payment', async () => {
      const only = { [rail]: { url: mine().url, token: TOKENS[rail] } };
      const m = await connectServer(createMcpServer({ ...cfg, bridges: only }));
      try {
        const { quote } = await quoteViaMcp(m);
        const bought = await m.call('buy', buyArgs(quote, rail));
        expect(bought.structuredContent.payment).toMatchObject({ ok: true });
        const { quote: fresh } = await quoteViaMcp(m);
        const unmatched = await m.call('buy', buyArgs(fresh, other));
        expect(unmatched.structuredContent.status).toBe('action_required');
        expect(unmatched.structuredContent.purchase).toBeUndefined();
        expect(theirs().calls).toHaveLength(0);
      } finally { await m.close(); }
    });

    it('projects a masked payer source in proof with no secret or raw signed payload', async () => {
      const m = await connectBoth();
      try {
        const { quote } = await quoteViaMcp(m);
        const bought = await m.call('buy', buyArgs(quote, rail));
        const id = bought.structuredContent.purchase.purchaseId as string;
        await h.gw.worker.tick();
        const proof = await h.call('GET', `/v1/evidence/purchases/${id}/proof`, { token: h.alice.token });
        expect(proof.status).toBe(200);
        // The payer recorded in funding evidence comes from the verifier: the Cardano fixture's own payer, or the Solana fixture override.
        const payer = rail === 'cardano' ? 'addr_test1fixturepayer' : SOLANA_PAYER;
        expect(proof.body.proof.funding.sources).toHaveLength(1);
        expect(proof.body.proof.funding.sources[0].displayAddress).toBe(maskAddress(payer));
        const text = JSON.stringify(proof.body);
        expect(text).not.toContain(payer);
        expect(text).not.toMatch(/payment-signature|mnemonic|privateKey|keyFile/i);
        for (const t of Object.values(TOKENS)) expect(text).not.toContain(t);
        expect(JSON.stringify(bought)).not.toContain(TOKENS[rail]);
      } finally { await m.close(); }
    });
  });

  describe('ambiguous payer identity', () => {
    it('fails safely, paying nothing, when two bridges claim the same funding identity', async () => {
      const twin = await startFakeBridge(h, 'cardano');
      const server = new McpServer({ name: 't', version: '0' });
      registerTools(server, {
        gateway: new GatewayClient(cfg),
        bridges: [new BridgeClient('cardano', { url: cardano.url, token: TOKENS.cardano }), new BridgeClient('cardano', { url: twin.url, token: TOKENS.cardano })],
        secrets: secretsOf(cfg),
      });
      const m = await connectServer(server);
      try {
        const { quote } = await quoteViaMcp(m);
        const bought = await m.call('buy', buyArgs(quote, 'cardano'));
        expect(bought.isError).toBe(true);
        expect(bought.structuredContent.error.code).toBe('payer_ambiguous');
        expect(cardano.calls).toHaveLength(0);
        expect(twin.calls).toHaveLength(0);
        expect(solana.calls).toHaveLength(0);
        expect(await purchaseCount()).toBe(0);
      } finally { await m.close(); await twin.close(); }
    });
  });
});

describe('MCP payer bridge configuration', () => {
  let dir: string;
  const files: Record<string, string> = {};
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-dual-'));
    for (const [name, value] of Object.entries({ gw: 'gateway-token-0123456789', cardano: 'cardano-token-0123456789', solana: 'solana-token-0123456789', legacy: 'legacy-token-0123456789' })) {
      files[name] = join(dir, name);
      writeFileSync(files[name]!, value);
    }
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const env = (extra: Record<string, string> = {}) => loadConfigFromEnv({ GATEWAY_URL: 'http://127.0.0.1:8787', GATEWAY_TOKEN_FILE: files.gw!, ...extra });

  it('has no bridges by default', () => expect(env().bridges).toBeUndefined());

  it('keeps the legacy PAYER_BRIDGE_* variables as the Cardano bridge only', () => {
    const c = env({ PAYER_BRIDGE_URL: 'http://127.0.0.1:8788', PAYER_BRIDGE_TOKEN_FILE: files.legacy! });
    expect(c.bridges).toEqual({ cardano: { url: 'http://127.0.0.1:8788', token: 'legacy-token-0123456789' } });
    expect(c.bridges?.solana).toBeUndefined();
  });

  it('supports Cardano-only and Solana-only via explicit variables', () => {
    expect(env({ CARDANO_PAYER_BRIDGE_URL: 'http://127.0.0.1:8788', CARDANO_PAYER_BRIDGE_TOKEN_FILE: files.cardano! }).bridges).toEqual({ cardano: { url: 'http://127.0.0.1:8788', token: 'cardano-token-0123456789' } });
    expect(env({ SOLANA_PAYER_BRIDGE_URL: 'http://127.0.0.1:8789', SOLANA_PAYER_BRIDGE_TOKEN_FILE: files.solana! }).bridges).toEqual({ solana: { url: 'http://127.0.0.1:8789', token: 'solana-token-0123456789' } });
  });

  it('supports both bridges simultaneously, including a legacy Cardano alias, and scrubs both tokens', () => {
    const c = env({ PAYER_BRIDGE_URL: 'http://127.0.0.1:8788', PAYER_BRIDGE_TOKEN_FILE: files.legacy!, SOLANA_PAYER_BRIDGE_URL: 'http://127.0.0.1:8789', SOLANA_PAYER_BRIDGE_TOKEN_FILE: files.solana! });
    expect(Object.keys(c.bridges!).sort()).toEqual(['cardano', 'solana']);
    expect(secretsOf(c)).toEqual(expect.arrayContaining(['gateway-token-0123456789', 'legacy-token-0123456789', 'solana-token-0123456789']));
  });

  it.each([
    ['half-configured legacy', { PAYER_BRIDGE_URL: 'http://127.0.0.1:8788' }],
    ['half-configured Cardano', { CARDANO_PAYER_BRIDGE_TOKEN_FILE: 'x' }],
    ['half-configured Solana URL', { SOLANA_PAYER_BRIDGE_URL: 'http://127.0.0.1:8789' }],
    ['half-configured Solana token', { SOLANA_PAYER_BRIDGE_TOKEN_FILE: 'x' }],
    ['remote Solana bridge', { SOLANA_PAYER_BRIDGE_URL: 'https://payer.example', SOLANA_PAYER_BRIDGE_TOKEN_FILE: 'x' }],
  ])('rejects %s', (_n, extra) => {
    expect(() => env(extra as Record<string, string>)).toThrow(ConfigError);
  });

  it('rejects legacy plus explicit Cardano variables together', () => {
    expect(() => env({ PAYER_BRIDGE_URL: 'http://127.0.0.1:8788', PAYER_BRIDGE_TOKEN_FILE: files.legacy!, CARDANO_PAYER_BRIDGE_URL: 'http://127.0.0.1:8788', CARDANO_PAYER_BRIDGE_TOKEN_FILE: files.cardano! })).toThrow(/same cardano bridge/);
  });

  it('rejects one URL configured for both rails', () => {
    expect(() => env({ CARDANO_PAYER_BRIDGE_URL: 'http://127.0.0.1:8788', CARDANO_PAYER_BRIDGE_TOKEN_FILE: files.cardano!, SOLANA_PAYER_BRIDGE_URL: 'http://127.0.0.1:8788', SOLANA_PAYER_BRIDGE_TOKEN_FILE: files.solana! })).toThrow(/different URLs/);
  });

  it('never reads a Solana bridge from the legacy variables', () => {
    expect(env({ PAYER_BRIDGE_URL: 'http://127.0.0.1:8789', PAYER_BRIDGE_TOKEN_FILE: files.legacy! }).bridges?.solana).toBeUndefined();
  });
});
