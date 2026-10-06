import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHarness, retailIntent, retailFulfillment, type Harness } from '../support/harness.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { redact } from '../../src/infrastructure/redact.js';
import { createMcpServer } from '../../src/channels/mcp/server.js';
import { startMcpHttpServer } from '../../src/channels/mcp/http.js';
import { ConfigError, loadConfigFromEnv, type McpConfig } from '../../src/channels/mcp/config.js';

const BRIDGE_TOKEN = 'bridge-secret-token-0123456789';

interface ToolResult {
  isError?: boolean;
  structuredContent?: any;
  content: Array<{ type: string; text: string }>;
}

/** Connect an SDK Client to a fresh MCP server over an in-memory transport. */
async function connect(config: McpConfig): Promise<{ client: Client; call(name: string, args: Record<string, unknown>): Promise<ToolResult>; close(): Promise<void> }> {
  const server = createMcpServer(config);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    client,
    call: async (name, args) => (await client.callTool({ name, arguments: args })) as unknown as ToolResult,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

interface FakeBridge {
  url: string;
  calls: string[];
  mode: 'fund' | 'fund_then_500' | 'reject' | 'reject_leaky';
  close(): Promise<void>;
}

/**
 * Fake payer bridge: implements the documented `POST /pay` contract and funds through the gateway's
 * fixture rail with a `fixture:<ref>:<amount>` payment-signature header.
 */
async function startFakeBridge(h: Harness): Promise<FakeBridge> {
  const state: FakeBridge = { url: '', calls: [], mode: 'fund', close: async () => undefined };
  const server: Server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      void (await (async () => {
        const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
        if (req.url === '/status' && req.method === 'GET') return send(200, { ok: true, source: { sourceId: 'src_' + 'a'.repeat(32), rail: 'cardano', network: 'cardano:preprod', publicAddress: 'addr_test1fixturepayer', displayAddress: 'addr_test1…epayer', assetId: h.funding.acceptedAsset().assetId, readiness: 'configured' } });
        if (req.url !== '/pay' || req.method !== 'POST') return send(404, { ok: false, error: { code: 'not_found', message: 'no route' } });
        if (req.headers.authorization !== `Bearer ${BRIDGE_TOKEN}`) return send(401, { ok: false, error: { code: 'unauthenticated', message: 'bad bridge token' } });
        const { purchaseId } = JSON.parse(raw) as { purchaseId: string };
        state.calls.push(purchaseId);
        if (state.mode === 'reject') return send(402, { ok: false, error: { code: 'spend_cap', message: 'payer cap reached' } });
        if (state.mode === 'reject_leaky') {
          // A misbehaving bridge that echoes both secrets in its error text.
          return send(500, { ok: false, error: { code: 'boom', message: `failed with ${BRIDGE_TOKEN} and ${h.alice.token}` } });
        }
        const got = await h.call('GET', `/v1/purchases/${purchaseId}`, { token: h.alice.token });
        const amount = got.body.purchase.fundingInstructions.options[0].amount.amountBaseUnits as string;
        const fund = await h.call('POST', `/v1/purchases/${purchaseId}/fund`, {
          token: h.alice.token,
          headers: { 'payment-signature': `fixture:bridge-${purchaseId}:${amount}` },
        });
        if (state.mode === 'fund_then_500') return send(500, { ok: false, error: { code: 'bridge_crash', message: 'crashed after paying' } });
        if (fund.status !== 202) return send(502, { ok: false, error: { code: fund.body.error.code, message: fund.body.error.message } });
        send(200, { ok: true, purchase: fund.body.purchase, payment: { transferReference: `bridge-${purchaseId}` } });
      })());
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () => new Promise<void>((r) => server.close(() => r()));
  return state;
}

describe('MCP channel', () => {
  let h: Harness;
  let mcpToken: string;
  let bobMcpToken: string;
  let cfg: McpConfig;

  beforeEach(async () => {
    h = await startHarness();
    const now = h.clock.now().toISOString();
    // A dedicated MCP-channel client for each customer, as production would issue.
    mcpToken = (await createClient(h.gw.db, { customerId: h.alice.customerId, displayName: 'Alice', channel: 'mcp', label: 'alice-mcp' }, now)).token;
    bobMcpToken = (await createClient(h.gw.db, { customerId: h.bob.customerId, displayName: 'Bob', channel: 'mcp', label: 'bob-mcp' }, now)).token;
    cfg = { gatewayUrl: h.url, gatewayToken: mcpToken };
  });
  afterEach(async () => h.close());

  /** find_offers -> create_quote through MCP; returns the quote. */
  async function quoteViaMcp(m: Awaited<ReturnType<typeof connect>>) {
    const found = await m.call('find_offers', { intent: retailIntent() });
    expect(found.isError).toBeFalsy();
    const offerId = found.structuredContent.offers[0].offerId as string;
    const q = await m.call('create_quote', { offerId, fulfillment: retailFulfillment });
    expect(q.isError).toBeFalsy();
    return q.structuredContent.quote as any;
  }

  const buyArgs = (quote: any, extra: Record<string, unknown> = {}) => ({
    quoteId: quote.quoteId,
    maxTotal: quote.payablePrincipal,
    quoteDigest: quote.digest,
    selectedFundingOptionId: quote.fundingOptions[0].fundingOptionId,
    ...extra,
  });

  it('exposes exactly the four thin tools, with sandbox guidance on create_quote', async () => {
    const m = await connect(cfg);
    const { tools } = await m.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['buy', 'create_quote', 'find_offers', 'get_purchase']);
    expect(tools.find((t) => t.name === 'create_quote')!.description).toMatch(/synthetic/i);
    await m.close();
  });

  it('find_offers -> create_quote -> buy yields the same purchase as HTTP with the same customer', async () => {
    const m = await connect(cfg);
    const quote = await quoteViaMcp(m);
    // The quote through MCP equals the quote read over HTTP (after redaction, which MCP always applies).
    const httpQuote = await h.call('GET', `/v1/quotes/${quote.quoteId}`, { token: h.alice.token });
    expect(quote).toEqual(redact(httpQuote.body.quote));

    const bought = await m.call('buy', buyArgs(quote));
    expect(bought.isError).toBeFalsy();
    const viaMcp = bought.structuredContent.purchase;
    const viaHttp = await h.call('GET', `/v1/purchases/${viaMcp.purchaseId}`, { token: h.alice.token });
    expect(viaHttp.status).toBe(200);
    expect(viaMcp).toEqual(redact(viaHttp.body.purchase));

    const got = await m.call('get_purchase', { purchaseId: viaMcp.purchaseId, includeEvents: true });
    expect(got.structuredContent.purchase).toEqual(redact(viaHttp.body.purchase));
    expect(got.structuredContent.events.length).toBeGreaterThan(0);
    await m.close();
  });

  it('isolates customers: another customer\'s purchaseId is a not_found tool error', async () => {
    const alice = await connect(cfg);
    const quote = await quoteViaMcp(alice);
    const purchase = (await alice.call('buy', buyArgs(quote))).structuredContent.purchase;

    const bob = await connect({ gatewayUrl: h.url, gatewayToken: bobMcpToken });
    const r = await bob.call('get_purchase', { purchaseId: purchase.purchaseId });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.error.code).toBe('not_found');
    expect(r.structuredContent.error.requestId).toBeTruthy();
    expect(r.content[0]!.text).toContain('not_found');
    // Bob cannot buy Alice's quote either.
    const b = await bob.call('buy', buyArgs(quote));
    expect(b.isError).toBe(true);
    expect(['not_found', 'forbidden']).toContain(b.structuredContent.error.code);
    await alice.close();
    await bob.close();
  });

  it('buy without a bridge returns action_required and never executes', async () => {
    const m = await connect(cfg);
    const quote = await quoteViaMcp(m);
    const r = await m.call('buy', buyArgs(quote));
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent.status).toBe('action_required');
    expect(r.structuredContent.purchase.state).toBe('awaiting_funding');
    expect(r.structuredContent.fundingInstructions.protocol).toBe('x402');
    expect(r.structuredContent.message).toBe('Payment required: fund via a bounded payer client; no purchase has been made yet.');
    expect(r.content[0]!.text).not.toMatch(/succeeded/i);
    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(0);
    await m.close();
  });

  it('buy with a bridge funds the purchase; after the worker runs, get_purchase shows succeeded', async () => {
    const bridge = await startFakeBridge(h);
    const m = await connect({ ...cfg, bridges: { cardano: { url: bridge.url, token: BRIDGE_TOKEN } } });
    const quote = await quoteViaMcp(m);
    const r = await m.call('buy', buyArgs(quote));
    expect(r.isError).toBeFalsy();
    expect(bridge.calls).toHaveLength(1);
    expect(r.structuredContent.purchase.state).toBe('funded_queued');
    expect(r.structuredContent.status).toBe('execution_pending');
    expect(r.content[0]!.text).toMatch(/pending/i);
    expect(r.content[0]!.text).toContain('get_purchase');
    expect(r.content[0]!.text).not.toMatch(/Purchase succeeded/);
    expect(h.retail.executeCalls).toBe(0);

    await h.gw.worker.tick();
    const got = await m.call('get_purchase', { purchaseId: r.structuredContent.purchase.purchaseId });
    expect(got.structuredContent.purchase.state).toBe('succeeded');
    expect(got.content[0]!.text).toContain('Order confirmed');
    expect(h.retail.executeCalls).toBe(1);

    // Re-buying a finished purchase is an idempotent replay: no second payment, no second order.
    const again = await m.call('buy', buyArgs(quote));
    expect(again.structuredContent.purchase.purchaseId).toBe(r.structuredContent.purchase.purchaseId);
    expect(again.structuredContent.status).toBe('succeeded');
    expect(bridge.calls).toHaveLength(1);
    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(1);
    await m.close();
    await bridge.close();
  });

  it('retrying buy with the same quote returns the same purchaseId (default and explicit keys)', async () => {
    const m = await connect(cfg);
    const quote = await quoteViaMcp(m);
    const a = await m.call('buy', buyArgs(quote));
    const b = await m.call('buy', buyArgs(quote));
    expect(b.structuredContent.purchase.purchaseId).toBe(a.structuredContent.purchase.purchaseId);

    const quote2 = await quoteViaMcp(m);
    const c = await m.call('buy', buyArgs(quote2, { idempotencyKey: 'my-key-0001' }));
    const d = await m.call('buy', buyArgs(quote2, { idempotencyKey: 'my-key-0001' }));
    expect(d.structuredContent.purchase.purchaseId).toBe(c.structuredContent.purchase.purchaseId);
    // Same explicit key, different request body => gateway idempotency_conflict surfaces as a tool error.
    const quote3 = await quoteViaMcp(m);
    const e = await m.call('buy', buyArgs(quote3, { idempotencyKey: 'my-key-0001' }));
    expect(e.isError).toBe(true);
    expect(e.structuredContent.error.code).toBe('idempotency_conflict');
    await m.close();
  });

  it('collects search, fulfillment, funding selection and approval as non-error needs_input', async () => {
    const m = await connect(cfg);
    try {
      const incomplete = await m.call('find_offers', { intent: { category: 'flight', from: 'SIN', adults: 1, spendCeiling: { currency: 'USD', amountMinor: '20000', scale: 2 } } });
      expect(incomplete.isError).toBeFalsy();
      expect(incomplete.structuredContent).toMatchObject({ status: 'needs_input', phase: 'search' });
      expect(incomplete.structuredContent.fields.map((f: any) => f.path)).toEqual(['to', 'departDate']);
      expect(incomplete.content[0]!.text).toContain('Do not invent answers');
      const invalid = await m.call('find_offers', { intent: { category: 'flight', from: 'SIN', to: 'SIN', departDate: '2026-10-20', adults: 1, spendCeiling: { currency: 'USD', amountMinor: '20000', scale: 2 } } });
      expect(invalid.structuredContent.error.code).toBe('invalid_request');
      const found = await m.call('find_offers', { intent: retailIntent() });
      const missingFulfillment = await m.call('create_quote', { offerId: found.structuredContent.offers[0].offerId, fulfillment: { category: 'retail' } });
      expect(missingFulfillment.isError).toBeFalsy();
      expect(missingFulfillment.structuredContent.phase).toBe('fulfillment');
      const quote = await quoteViaMcp(m);
      const { selectedFundingOptionId: _choice, ...args } = buyArgs(quote);
      const missingChoice = await m.call('buy', args);
      expect(missingChoice.isError).toBeFalsy();
      expect(missingChoice.structuredContent).toMatchObject({ status: 'needs_input', phase: 'funding_selection' });
      const missingApproval = await m.call('buy', { quoteId: quote.quoteId, selectedFundingOptionId: quote.fundingOptions[0].fundingOptionId });
      expect(missingApproval.structuredContent.phase).toBe('approval');
      expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM purchases'))!.n).toBe(0);
    } finally { await m.close(); }
  });

  it('shows connected public source and refuses a mismatched source before creating purchase', async () => {
    const bridge = await startFakeBridge(h);
    const m = await connect({ ...cfg, bridges: { cardano: { url: bridge.url, token: BRIDGE_TOKEN } } });
    try {
      const quote = await quoteViaMcp(m);
      const quoted = await m.call('create_quote', { offerId: quote.offerId, fulfillment: retailFulfillment });
      expect(quoted.structuredContent.fundingSources[0].displayAddress).toBe('addr_test1…epayer');
      expect(quoted.content[0]!.text).toContain('Connected wallet');
      expect(quoted.content[0]!.text).toContain('explicit approval');
      const stored = await h.gw.db.get<{ public_json: string }>('SELECT public_json FROM quotes WHERE id=$1', quote.quoteId);
      const changed = JSON.parse(stored!.public_json); changed.fundingOptions[0].amount.network = 'fixture:mismatch';
      await h.gw.db.run('UPDATE quotes SET public_json=$1 WHERE id=$2', JSON.stringify(changed), quote.quoteId);
      const result = await m.call('buy', buyArgs(quote));
      expect(result.structuredContent.status).toBe('action_required');
      expect(result.structuredContent.purchase).toBeUndefined();
      expect(bridge.calls).toHaveLength(0);
      expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM purchases'))!.n).toBe(0);
    } finally { await m.close(); await bridge.close(); }
  });

  it.each(['submitted', 'unknown', 'confirmed'] as const)('follows repeated buy without another payment when payment is %s', async paymentState => {
    const bridge = await startFakeBridge(h); bridge.mode = 'reject';
    const m = await connect({ ...cfg, bridges: { cardano: { url: bridge.url, token: BRIDGE_TOKEN } } });
    try {
      const quote = await quoteViaMcp(m);
      const first = await m.call('buy', buyArgs(quote));
      const id = first.structuredContent.purchase.purchaseId;
      await h.gw.db.run('UPDATE purchases SET payment_state=$1 WHERE id=$2', paymentState, id);
      const repeated = await m.call('buy', buyArgs(quote, { idempotencyKey: 'another-approved-key' }));
      expect(repeated.structuredContent.purchase.purchaseId).toBe(id);
      expect(bridge.calls).toHaveLength(1);
      const conflict = await m.call('buy', buyArgs(quote, { maxTotal: { ...quote.payablePrincipal, amountMinor: '999999' } }));
      expect(conflict.isError).toBe(true);
      expect(conflict.structuredContent.error.code).toBe('conflict');
      // F-1: payment activity means follow the existing purchase, never request a fresh quote.
      const text = String(conflict.content[0]?.text);
      expect(text).toContain(`Purchase ${id} already has payment or merchant activity`);
      expect(text).toContain('get_purchase');
      expect(text).not.toMatch(/fresh quote/i);
    } finally { await m.close(); await bridge.close(); }
  });

  it.each(['funded_queued', 'executing', 'succeeded'] as const)('points to get_purchase when the purchase state is %s even with no payment recorded', async state => {
    const m = await connect(cfg);
    try {
      const quote = await quoteViaMcp(m);
      const first = await m.call('buy', buyArgs(quote));
      const id = first.structuredContent.purchase.purchaseId;
      await h.gw.db.run('UPDATE purchases SET state=$1 WHERE id=$2', state, id);
      const conflict = await m.call('buy', buyArgs(quote, { maxTotal: { ...quote.payablePrincipal, amountMinor: '999999' } }));
      expect(conflict.structuredContent.error.code).toBe('conflict');
      expect(conflict.content[0]?.text).toContain('get_purchase');
      expect(conflict.content[0]?.text).not.toMatch(/fresh quote/i);
      expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM purchases'))!.n).toBe(1);
    } finally { await m.close(); }
  });

  it('refuses switching to another available option after the purchase exists', async () => {
    const m = await connect(cfg);
    try {
      const quote = await quoteViaMcp(m);
      const stored = await h.gw.db.get<{ public_json: string }>('SELECT public_json FROM quotes WHERE id=$1', quote.quoteId);
      const extended = JSON.parse(stored!.public_json);
      extended.fundingOptions.push({ ...extended.fundingOptions[0], fundingOptionId: 'fop_OTHERAVAILABLEOPTION' });
      await h.gw.db.run('UPDATE quotes SET public_json=$1 WHERE id=$2', JSON.stringify(extended), quote.quoteId);
      const first = await m.call('buy', buyArgs(quote));
      const switched = await m.call('buy', buyArgs(quote, { selectedFundingOptionId: 'fop_OTHERAVAILABLEOPTION' }));
      expect(switched.structuredContent.error.code).toBe('conflict');
      expect(switched.structuredContent.purchase.purchaseId).toBe(first.structuredContent.purchase.purchaseId);
      // Genuinely untouched purchase (awaiting_funding / not_received): fresh authorization is still appropriate.
      expect(switched.content[0]?.text).toMatch(/fresh quote and authorization/i);
    } finally { await m.close(); }
  });

  it('does not trigger another funding attempt after an unfunded payer refusal', async () => {
    const bridge = await startFakeBridge(h); bridge.mode = 'reject';
    const m = await connect({ ...cfg, bridges: { cardano: { url: bridge.url, token: BRIDGE_TOKEN } } });
    try {
      const quote = await quoteViaMcp(m);
      const first = await m.call('buy', buyArgs(quote));
      const repeated = await m.call('buy', buyArgs(quote));
      expect(repeated.structuredContent.purchase.purchaseId).toBe(first.structuredContent.purchase.purchaseId);
      expect(bridge.calls).toHaveLength(1);
    } finally { await m.close(); await bridge.close(); }
  });

  it('concurrent repeated buy uses one purchase and one payer action', async () => {
    const bridge = await startFakeBridge(h);
    const m = await connect({ ...cfg, bridges: { cardano: { url: bridge.url, token: BRIDGE_TOKEN } } });
    try {
      const quote = await quoteViaMcp(m);
      const results = await Promise.all([m.call('buy', buyArgs(quote)), m.call('buy', buyArgs(quote))]);
      expect(results.every(r => !r.isError)).toBe(true);
      expect(results[0]!.structuredContent.purchase.purchaseId).toBe(results[1]!.structuredContent.purchase.purchaseId);
      expect(bridge.calls).toHaveLength(1);
    } finally { await m.close(); await bridge.close(); }
  });

  it('a zero-option quote clearly reports that payment is unavailable', async () => {
    h.funding.readinessStatus = 'MISSING_CONFIG';
    const m = await connect(cfg);
    try {
      const found = await m.call('find_offers', { intent: retailIntent() });
      const result = await m.call('create_quote', { offerId: found.structuredContent.offers[0].offerId, fulfillment: retailFulfillment });
      expect(result.structuredContent.quote.fundingOptions).toEqual([]);
      expect(result.content[0]!.text).toContain('No payment source is currently available');
    } finally { await m.close(); }
  });

  it('a bridge that fails leaves an honest, unfunded result', async () => {
    const bridge = await startFakeBridge(h);
    bridge.mode = 'reject';
    const m = await connect({ ...cfg, bridges: { cardano: { url: bridge.url, token: BRIDGE_TOKEN } } });
    const quote = await quoteViaMcp(m);
    const r = await m.call('buy', buyArgs(quote));
    expect(r.isError).toBe(true);
    expect(r.structuredContent.status).toBe('payment_failed');
    expect(r.structuredContent.payment).toMatchObject({ ok: false, code: 'spend_cap' });
    expect(r.structuredContent.purchase.state).toBe('awaiting_funding');
    expect(r.content[0]!.text).toContain('No purchase has been made yet');
    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(0);
    await m.close();
    await bridge.close();
  });

  it('a bridge error after the payment landed is reported from the re-read gateway state, not as a failure', async () => {
    const bridge = await startFakeBridge(h);
    bridge.mode = 'fund_then_500';
    const m = await connect({ ...cfg, bridges: { cardano: { url: bridge.url, token: BRIDGE_TOKEN } } });
    const quote = await quoteViaMcp(m);
    const r = await m.call('buy', buyArgs(quote));
    expect(r.structuredContent.purchase.state).toBe('funded_queued');
    expect(r.structuredContent.status).toBe('execution_pending');
    expect(r.isError).toBeFalsy();
    await m.close();
    await bridge.close();
  });

  it('get_purchase describes unresolved outcomes without claiming success or failure', async () => {
    const bridge = await startFakeBridge(h);
    const m = await connect({ ...cfg, bridges: { cardano: { url: bridge.url, token: BRIDGE_TOKEN } } });
    h.retail.behavior = 'unknown';
    const quote = await quoteViaMcp(m);
    const r = await m.call('buy', buyArgs(quote));
    await h.gw.worker.tick();
    const got = await m.call('get_purchase', { purchaseId: r.structuredContent.purchase.purchaseId });
    const p = got.structuredContent.purchase;
    expect(p.state).toBe('unresolved');
    expect(got.content[0]!.text).not.toMatch(/Purchase succeeded/);
    expect(got.content[0]!.text).toMatch(/verifying whether the merchant completed/);
    expect(got.content[0]!.text).not.toMatch(/do not buy again|state=|retry budget|job dead/i);
    await m.close();
    await bridge.close();
  });

  it('never leaks the gateway or bridge token, including in errors', async () => {
    const bridge = await startFakeBridge(h);
    const secrets = [mcpToken, BRIDGE_TOKEN, h.alice.token];
    const outputs: ToolResult[] = [];
    const assertClean = (r: ToolResult) => {
      const blob = JSON.stringify(r);
      for (const s of secrets) expect(blob).not.toContain(s);
    };

    // Bad token -> unauthenticated.
    const bad = await connect({ gatewayUrl: h.url, gatewayToken: 'not-a-real-token-123456' });
    const unauth = await bad.call('find_offers', { intent: retailIntent() });
    expect(unauth.isError).toBe(true);
    expect(unauth.structuredContent.error.code).toBe('unauthenticated');
    for (const s of ['not-a-real-token-123456']) expect(JSON.stringify(unauth)).not.toContain(s);
    await bad.close();

    // Unreachable gateway.
    const down = await connect({ gatewayUrl: 'http://127.0.0.1:1', gatewayToken: mcpToken, gatewayTimeoutMs: 2000 });
    const unreachable = await down.call('find_offers', { intent: retailIntent() });
    expect(unreachable.isError).toBe(true);
    expect(unreachable.structuredContent.error.code).toBe('gateway_unreachable');
    outputs.push(unreachable);
    await down.close();

    // Gateway that reflects the Authorization header into its error body.
    const reflect = createServer((req, res) => {
      res.writeHead(400, { 'content-type': 'application/json' }).end(
        JSON.stringify({ error: { code: 'invalid_request', message: `bad request from ${req.headers.authorization}`, requestId: 'req-1' } }),
      );
    });
    await new Promise<void>((r) => reflect.listen(0, '127.0.0.1', r));
    const reflected = await connect({ gatewayUrl: `http://127.0.0.1:${(reflect.address() as AddressInfo).port}`, gatewayToken: mcpToken });
    const leak = await reflected.call('find_offers', { intent: retailIntent() });
    expect(leak.isError).toBe(true);
    outputs.push(leak);
    await reflected.close();
    await new Promise<void>((r) => reflect.close(() => r()));

    // Normal flow, not-found, invalid input, and a bridge that leaks both tokens in its error text.
    const m = await connect({ ...cfg, bridges: { cardano: { url: bridge.url, token: BRIDGE_TOKEN } } });
    const quote = await quoteViaMcp(m);
    outputs.push(await m.call('get_purchase', { purchaseId: 'pur_doesnotexist0001' }));
    outputs.push(await m.call('get_purchase', { purchaseId: 'not-an-id' }));
    outputs.push(await m.call('find_offers', { intent: { category: 'retail' } }));
    bridge.mode = 'reject_leaky';
    const leaky = await m.call('buy', buyArgs(quote));
    expect(leaky.isError).toBe(true);
    expect(leaky.structuredContent.payment.ok).toBe(false);
    outputs.push(leaky);
    bridge.mode = 'fund';
    outputs.push(await m.call('buy', buyArgs(quote)));
    for (const o of outputs) assertClean(o);
    await m.close();
    await bridge.close();
  });

  it('validates input before any gateway call', async () => {
    let hits = 0;
    const counting: typeof fetch = (...a) => {
      hits++;
      return fetch(...a);
    };
    const m = await connect({ ...cfg, fetch: counting });
    const r = await m.call('buy', { quoteId: 'nope', maxTotal: { currency: 'USD', amountMinor: '-1', scale: 2 }, quoteDigest: 'x' });
    expect(r.isError).toBe(true);
    const r2 = await m.call('buy', { quoteId: 'quo_abcdefghij1234', maxTotal: { currency: 'USD', amountMinor: '1', scale: 2 }, quoteDigest: 'x', idempotencyKey: 'short' });
    expect(r2.isError).toBe(true);
    expect(hits).toBe(0);
    await m.close();
  });

  it('serves the same tools over streamable HTTP on loopback and rejects foreign Host headers', async () => {
    const http = await startMcpHttpServer(cfg, 0);
    const client = new Client({ name: 'http-client', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(http.url)));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(4);
    const found = (await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } })) as unknown as ToolResult;
    expect(found.structuredContent.offers.length).toBeGreaterThan(0);
    await client.close();

    const status = await new Promise<number>((resolve, reject) => {
      const u = new URL(http.url);
      const req = httpRequest({ host: u.hostname, port: u.port, path: '/mcp', method: 'POST', headers: { host: 'evil.example', 'content-type': 'application/json' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end('{}');
    });
    expect(status).toBe(403);
    await http.close();
  });

  it('loads config from env with token files and validates the bridge pair', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-cfg-'));
    const gwFile = join(dir, 'gw.token');
    const brFile = join(dir, 'br.token');
    writeFileSync(gwFile, `${mcpToken}\n`);
    writeFileSync(brFile, BRIDGE_TOKEN);
    const c = loadConfigFromEnv({ GATEWAY_URL: `${h.url}/`, GATEWAY_TOKEN_FILE: gwFile, PAYER_BRIDGE_URL: 'http://127.0.0.1:9/', PAYER_BRIDGE_TOKEN_FILE: brFile, MCP_HTTP_PORT: '0' });
    expect(c.gatewayToken).toBe(mcpToken);
    expect(c.gatewayUrl).toBe(h.url);
    expect(c.bridges).toEqual({ cardano: { url: 'http://127.0.0.1:9', token: BRIDGE_TOKEN } });
    expect(c.httpPort).toBe(0);
    expect(loadConfigFromEnv({ GATEWAY_URL: h.url, GATEWAY_TOKEN_FILE: gwFile }).bridges).toBeUndefined();
    expect(() => loadConfigFromEnv({ GATEWAY_URL: h.url, GATEWAY_TOKEN_FILE: gwFile, PAYER_BRIDGE_URL: 'http://127.0.0.1:9' })).toThrow(ConfigError);
    expect(() => loadConfigFromEnv({ GATEWAY_URL: h.url })).toThrow(ConfigError);
    expect(() => loadConfigFromEnv({ GATEWAY_URL: 'ftp://x', GATEWAY_TOKEN_FILE: gwFile })).toThrow(ConfigError);
  });
});
