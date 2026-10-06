import { describe, expect, it } from 'vitest';
import { createGatewaySource } from './gateway.js';
import { createSampleSource } from './sample.js';
import { EMPTY_CONTEXT } from '../contracts/proposed.js';
import { ConsoleError } from '../contracts/source.js';

const KEY = 'cgk_test_SECRET_ACCESS_KEY_0123456789';
const NOW = Date.parse('2026-10-06T10:20:00Z');
const sample = createSampleSource({ now: NOW });

interface Call { url: string; init: RequestInit }
type Override = (path: string) => Response | Promise<Response> | undefined;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const errorBody = (code: string, message: string, requestId = 'req-1') => ({ error: { code, message, requestId } });

/** A fake gateway built from the sample source's own contract-shaped bundles. */
async function fakeGateway(override: Override = () => undefined) {
  const list = await sample.listPurchases();
  const bundles = new Map<string, Awaited<ReturnType<typeof sample.getPurchase>>>();
  for (const e of list.entries) bundles.set(e.item.id, await sample.getPurchase(e.item.id));
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    const path = new URL(url, 'http://gateway.test').pathname;
    const o = override(path);
    if (o) return o;
    if (path === '/v1/capabilities') return json(200, { contractVersion: 'v1', appEnv: 'sandbox', routes: [], fundingRails: [], banking: [], operations: [] });
    if (path === '/v1/evidence/purchases') return json(200, { purchases: list.entries.map((e) => e.item), limit: list.limit });
    let m = /^\/v1\/purchases\/([^/]+)$/.exec(path);
    if (m) {
      const b = bundles.get(decodeURIComponent(m[1]!));
      return b ? json(200, { purchase: b.purchase }) : json(404, errorBody('not_found', 'purchase not found'));
    }
    m = /^\/v1\/evidence\/purchases\/([^/]+)\/proof$/.exec(path);
    if (m) {
      const b = bundles.get(decodeURIComponent(m[1]!));
      return b ? json(200, { proof: b.proof }) : json(404, errorBody('not_found', 'purchase not found'));
    }
    m = /^\/v1\/evidence\/purchases\/([^/]+)$/.exec(path);
    if (m) {
      const b = bundles.get(decodeURIComponent(m[1]!));
      return b ? json(200, b.technicalRecord) : json(404, errorBody('not_found', 'purchase not found'));
    }
    m = /^\/v1\/quotes\/([^/]+)$/.exec(path);
    if (m) {
      const b = [...bundles.values()].find((x) => x.purchase.quoteId === decodeURIComponent(m![1]!));
      return b ? json(200, { quote: b.quote }) : json(404, errorBody('not_found', 'quote not found'));
    }
    return json(404, errorBody('not_found', 'no route'));
  }) as typeof fetch;
  return { fetchImpl, calls, bundles };
}

async function rejection(p: Promise<unknown>): Promise<ConsoleError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ConsoleError);
    return e as ConsoleError;
  }
  throw new Error('expected a rejection');
}

describe('gateway source', () => {
  it('reports its kind and maps appEnv to a mode', async () => {
    const g = await fakeGateway();
    const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
    expect(source.kind).toBe('gateway');
    expect(await source.environment()).toEqual({ mode: 'test' });

    const prod = createGatewaySource({
      baseUrl: '', accessKey: KEY,
      fetchImpl: (async () => json(200, { contractVersion: 'v1', appEnv: 'production', routes: [], fundingRails: [], banking: [], operations: [] })) as typeof fetch,
    });
    expect(await prod.environment()).toEqual({ mode: 'live' });
  });

  it('does not send the access key to the public capabilities endpoint', async () => {
    const g = await fakeGateway();
    await createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl }).environment();
    expect(new Headers(g.calls[0]!.init.headers).has('authorization')).toBe(false);
  });

  it('lists purchases with empty context', async () => {
    const g = await fakeGateway();
    const source = createGatewaySource({ baseUrl: 'https://gw.example/', accessKey: KEY, fetchImpl: g.fetchImpl });
    const result = await source.listPurchases();
    const expected = await sample.listPurchases();
    expect(result.limit).toBe(expected.limit);
    expect(result.entries.map((e) => e.item)).toEqual(expected.entries.map((e) => e.item));
    expect(result.entries.every((e) => e.context === EMPTY_CONTEXT)).toBe(true);
    expect(g.calls[0]!.url).toBe('https://gw.example/v1/evidence/purchases');
  });

  it('returns a full bundle for every sample purchase', async () => {
    const g = await fakeGateway();
    const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
    for (const [id, expected] of g.bundles) {
      const bundle = await source.getPurchase(id);
      expect(bundle.purchase).toEqual(expected.purchase);
      expect(bundle.quote).toEqual(expected.quote);
      expect(bundle.proof).toEqual(expected.proof);
      expect(bundle.evidence).toEqual(expected.evidence);
      expect(bundle.technicalRecord).toEqual(expected.technicalRecord);
      expect(bundle.context).toBe(EMPTY_CONTEXT);
    }
  });

  it('sends the bearer key and safe fetch options on every authenticated read, and URL-encodes ids', async () => {
    const g = await fakeGateway();
    const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
    await source.listPurchases();
    await source.getPurchase('pur_X/../Y?z=1').catch(() => undefined);
    const authed = g.calls.filter((c) => !c.url.endsWith('/capabilities'));
    expect(authed.length).toBeGreaterThan(1);
    for (const c of authed) {
      const h = new Headers(c.init.headers);
      expect(h.get('authorization')).toBe(`Bearer ${KEY}`);
      expect(h.get('accept')).toBe('application/json');
      expect(c.init.credentials).toBe('omit');
      expect(c.init.cache).toBe('no-store');
      expect(c.init.method).toBe('GET');
      expect(c.url).not.toContain(KEY);
    }
    expect(g.calls.some((c) => c.url === '/v1/purchases/pur_X%2F..%2FY%3Fz%3D1')).toBe(true);
  });

  it('encodes the quote id taken from the purchase', async () => {
    const g = await fakeGateway();
    const id = [...g.bundles.keys()][0]!;
    const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
    await source.getPurchase(id);
    const quoteId = g.bundles.get(id)!.purchase.quoteId;
    expect(g.calls.some((c) => c.url === `/v1/quotes/${encodeURIComponent(quoteId)}`)).toBe(true);
  });

  describe('optional reads degrade to null on 403', () => {
    const forbidden = () => json(403, errorBody('forbidden', 'missing scope'));
    const cases: Array<[string, (p: string) => boolean, 'proof' | 'evidence' | 'quote']> = [
      ['proof', (p) => p.endsWith('/proof'), 'proof'],
      ['evidence', (p) => /^\/v1\/evidence\/purchases\/[^/]+$/.test(p), 'evidence'],
      ['quote', (p) => p.startsWith('/v1/quotes/'), 'quote'],
    ];
    for (const [name, match, field] of cases) {
      it(name, async () => {
        const g = await fakeGateway((p) => (match(p) ? forbidden() : undefined));
        const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
        const id = [...g.bundles.keys()][0]!;
        const bundle = await source.getPurchase(id);
        expect(bundle[field]).toBeNull();
        expect(bundle.purchase).toEqual(g.bundles.get(id)!.purchase);
        if (field === 'evidence') expect(bundle.technicalRecord).toBeNull();
      });
    }

    it('all three at once', async () => {
      const g = await fakeGateway((p) => (p.endsWith('/proof') || p.startsWith('/v1/quotes/') || /^\/v1\/evidence\/purchases\/[^/]+$/.test(p) ? forbidden() : undefined));
      const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
      const bundle = await source.getPurchase([...g.bundles.keys()][0]!);
      expect([bundle.proof, bundle.evidence, bundle.quote, bundle.technicalRecord]).toEqual([null, null, null, null]);
    });

    it('a forbidden purchase read is not degraded', async () => {
      const g = await fakeGateway((p) => (p.startsWith('/v1/purchases/') ? forbidden() : undefined));
      const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
      const e = await rejection(source.getPurchase([...g.bundles.keys()][0]!));
      expect(e.code).toBe('forbidden');
    });

    it('other failures of optional reads propagate', async () => {
      const g = await fakeGateway((p) => (p.endsWith('/proof') ? json(500, errorBody('internal', 'internal error', 'req-9')) : undefined));
      const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
      const e = await rejection(source.getPurchase([...g.bundles.keys()][0]!));
      expect(e.code).toBe('internal');
      expect(e.requestId).toBe('req-9');
    });
  });

  describe('errors', () => {
    it('maps an ErrorBody to ConsoleError with requestId and status', async () => {
      const g = await fakeGateway((p) => (p === '/v1/evidence/purchases' ? json(503, errorBody('route_unavailable', 'slow down', 'req-42')) : undefined));
      const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
      const e = await rejection(source.listPurchases());
      expect(e.code).toBe('route_unavailable');
      expect(e.message).toBe('slow down');
      expect(e.requestId).toBe('req-42');
      expect(e.status).toBe(503);
    });

    it('maps an unknown purchase to not_found with the gateway request id', async () => {
      const g = await fakeGateway();
      const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
      const e = await rejection(source.getPurchase('pur_NOPE'));
      expect(e.code).toBe('not_found');
      expect(e.requestId).toBe('req-1');
      expect(e.status).toBe(404);
    });

    it('maps non-ErrorBody failures by status', async () => {
      for (const [status, code] of [[401, 'unauthenticated'], [403, 'forbidden'], [404, 'not_found'], [500, 'internal'], [502, 'internal']] as const) {
        const fetchImpl = (async () => new Response('<html>bad gateway</html>', { status })) as typeof fetch;
        const e = await rejection(createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl }).listPurchases());
        expect(e.code).toBe(code);
        expect(e.status).toBe(status);
        expect(e.requestId).toBeUndefined();
      }
    });

    it('treats a JSON error body of the wrong shape as a status failure', async () => {
      const fetchImpl = (async () => json(401, { error: 'nope' })) as typeof fetch;
      const e = await rejection(createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl }).listPurchases());
      expect(e.code).toBe('unauthenticated');
    });

    it('maps fetch rejection to network, without leaking the underlying message', async () => {
      const fetchImpl = (async () => {
        throw new TypeError(`Failed to fetch https://gw.example/ with Bearer ${KEY}`);
      }) as typeof fetch;
      const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl });
      for (const call of [() => source.environment(), () => source.listPurchases(), () => source.getPurchase('pur_1')]) {
        const e = await rejection(call());
        expect(e.code).toBe('network');
        expect(JSON.stringify({ m: e.message, c: e.code })).not.toContain(KEY);
      }
    });

    it('maps schema violations to invalid_response without echoing response data', async () => {
      const secret = 'PRIVATE-PURCHASE-FACT';
      const g = await fakeGateway((p) => (p === '/v1/evidence/purchases' ? json(200, { purchases: [{ id: secret, state: 7 }], limit: 'many' }) : undefined));
      const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
      const e = await rejection(source.listPurchases());
      expect(e.code).toBe('invalid_response');
      expect(e.message).not.toContain(secret);
    });

    it('maps a malformed 2xx body and a bad proof to invalid_response', async () => {
      const notJson = (async () => new Response('not json', { status: 200 })) as typeof fetch;
      expect((await rejection(createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: notJson }).listPurchases())).code).toBe('invalid_response');

      const g = await fakeGateway((p) => (p.endsWith('/proof') ? json(200, { proof: { purchaseId: 'x' } }) : undefined));
      const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
      expect((await rejection(source.getPurchase([...g.bundles.keys()][0]!))).code).toBe('invalid_response');
    });

    it('never puts the access key in any thrown error', async () => {
      const failures: Array<Override> = [
        () => json(500, errorBody('internal', 'internal error')),
        () => json(401, { error: `bad key ${'x'}` }),
        () => new Response('nope', { status: 503 }),
        () => json(200, { unexpected: true }),
      ];
      for (const f of failures) {
        const g = await fakeGateway(f);
        const source = createGatewaySource({ baseUrl: '', accessKey: KEY, fetchImpl: g.fetchImpl });
        for (const call of [() => source.environment(), () => source.listPurchases(), () => source.getPurchase('pur_1')]) {
          const e = await rejection(call());
          expect(`${e.name} ${e.message} ${e.code} ${e.stack ?? ''}`).not.toContain(KEY);
          expect(JSON.stringify(Object.entries(e))).not.toContain(KEY);
        }
      }
    });
  });
});
