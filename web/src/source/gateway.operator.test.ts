import { describe, expect, it } from 'vitest';
import gatewaySourceText from './gateway.ts?raw';
import { createGatewaySource } from './gateway.js';
import { sampleConnections, sampleTreasury } from './sample.operator.js';
import { ConsoleError } from '../contracts/source.js';

const KEY = 'cgk_test_SECRET_OPERATOR_KEY_0123456789';
const NOW = Date.parse('2026-10-06T10:20:00Z');
const treasury = sampleTreasury();
const connections = sampleConnections(NOW);

interface Call { url: string; init: RequestInit }
type Handler = (path: string) => Response | undefined;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const forbidden = () => json(403, { error: { code: 'forbidden', message: 'missing scope operator:read', requestId: 'req-op' } });

function gateway(scopes: 'operator' | 'customer', override: Handler = () => undefined) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const path = new URL(url, 'http://gateway.test').pathname;
    const o = override(path);
    if (o) return o;
    if (path === '/v1/capabilities') return json(200, connections.capabilities);
    if (path === '/v1/evidence/treasury') return scopes === 'operator' ? json(200, treasury) : forbidden();
    if (path === '/v1/evidence/bank') return scopes === 'operator' ? json(200, connections.bank) : forbidden();
    return json(404, { error: { code: 'not_found', message: 'nope', requestId: 'r' } });
  }) as typeof fetch;
  return { calls, source: createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl }) };
}

const paths = (calls: Call[]) => calls.map((c) => new URL(c.url, 'http://gateway.test').pathname);
const authHeader = (c: Call) => (c.init.headers as Record<string, string>).Authorization;

describe('operator reads: operator key', () => {
  it('reads treasury with a GET and a bearer header, and validates the response', async () => {
    const g = gateway('operator');
    const t = await g.source.getTreasury();
    expect(t.simulatedCapacity[0]?.availableMinor).toBe('337400');
    expect(g.calls).toHaveLength(1);
    expect(g.calls[0]!.init.method).toBe('GET');
    expect(authHeader(g.calls[0]!)).toBe(`Bearer ${KEY}`);
    expect(g.calls[0]!.url).not.toContain(KEY);
  });

  it('reads connections: the gated bank read with the key, public capabilities without it', async () => {
    const g = gateway('operator');
    const c = await g.source.getConnections();
    expect(c.bank.observations.length).toBeGreaterThan(0);
    expect(c.capabilities.routes.map((r) => r.route)).toContain('shopify');
    expect(paths(g.calls)).toEqual(['/v1/evidence/bank', '/v1/capabilities']);
    expect(authHeader(g.calls[0]!)).toBe(`Bearer ${KEY}`);
    expect(authHeader(g.calls[1]!)).toBeUndefined();
  });

  it('reports operator access', async () => {
    expect(await gateway('operator').source.hasOperatorAccess()).toBe(true);
  });

  it('never calls the bank refresh endpoint or any non-GET method', async () => {
    const g = gateway('operator');
    await g.source.getTreasury();
    await g.source.getConnections();
    await g.source.hasOperatorAccess();
    for (const c of g.calls) {
      expect(c.init.method).toBe('GET');
      expect(c.url).not.toContain('refresh');
    }
  });

  it('keeps the console read-only in source: no write method and no refresh route in the gateway source', () => {
    const text: string = gatewaySourceText;
    expect(text).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
    expect(text).not.toMatch(/request\(\s*[`'"]\/v1\/evidence\/bank\/refresh/);
  });
});

describe('operator reads: customer key', () => {
  it('is refused on treasury with a forbidden error and no data', async () => {
    const g = gateway('customer');
    const err = await g.source.getTreasury().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConsoleError);
    expect(err).toMatchObject({ code: 'forbidden', status: 403 });
    expect(JSON.stringify(err)).not.toContain('availableMinor');
  });

  it('is refused on connections before anything else is requested', async () => {
    const g = gateway('customer');
    const err = await g.source.getConnections().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'forbidden' });
    expect(paths(g.calls)).toEqual(['/v1/evidence/bank']);
  });

  it('is told it has no operator access, without an error', async () => {
    expect(await gateway('customer').source.hasOperatorAccess()).toBe(false);
  });

  it('never puts the key in an error message', async () => {
    const g = gateway('customer');
    const err = (await g.source.getTreasury().catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain(KEY);
  });
});

describe('operator reads: failures', () => {
  it('does not treat a network failure as "no access"', async () => {
    const source = createGatewaySource({
      baseUrl: '',
      accessKey: KEY,
      fetchImpl: (async () => {
        throw new Error(`boom ${KEY}`);
      }) as typeof fetch,
    });
    await expect(source.hasOperatorAccess()).rejects.toMatchObject({ code: 'network' });
    const err = (await source.getTreasury().catch((e: unknown) => e)) as Error;
    expect(err.message).not.toContain(KEY);
  });

  it('does not treat an expired key as "no access"', async () => {
    const g = gateway('operator', (p) =>
      p === '/v1/evidence/treasury' ? json(401, { error: { code: 'unauthenticated', message: 'bad key', requestId: 'r' } }) : undefined,
    );
    await expect(g.source.hasOperatorAccess()).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('rejects a response it cannot read without echoing it', async () => {
    const g = gateway('operator', (p) => (p === '/v1/evidence/treasury' ? json(200, { ledger: 'Jane Example 1234567890123456' }) : undefined));
    const err = (await g.source.getTreasury().catch((e: unknown) => e)) as ConsoleError;
    expect(err).toMatchObject({ code: 'invalid_response' });
    expect(err.message).not.toContain('Jane Example');
  });

  it('drops fields it does not know, so a bank description cannot reach a screen', async () => {
    const leaky = { ...connections.bank, observations: connections.bank.observations.map((o) => ({ ...o, description: 'Private customer Jane Example' })) };
    const g = gateway('operator', (p) => (p === '/v1/evidence/bank' ? json(200, leaky) : undefined));
    const c = await g.source.getConnections();
    expect(JSON.stringify(c)).not.toContain('Jane Example');
  });
});
