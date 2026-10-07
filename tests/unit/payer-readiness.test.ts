import { describe, expect, it, vi } from 'vitest';
import { BridgeClient, type BridgeDiag } from '../../src/channels/mcp/bridge.js';
import { SOLANA_DEVNET_NETWORK, SOLANA_DEVNET_USDC_MINT, type FundingSource } from '../../src/contracts/presentation.js';

const TOKEN = 'readiness-test-secret-token-0123456789';
const CARDANO: FundingSource = {
  sourceId: 'src_' + 'a'.repeat(32), rail: 'cardano', network: 'cardano:preprod',
  publicAddress: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp',
  displayAddress: 'addr_test1…ytjqp', assetId: 'lovelace', readiness: 'configured',
};
const SOLANA: FundingSource = {
  sourceId: 'src_' + 'b'.repeat(32), rail: 'solana', network: SOLANA_DEVNET_NETWORK,
  publicAddress: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', displayAddress: '9xQeWvG816bUx…PusVFin',
  assetId: SOLANA_DEVNET_USDC_MINT, readiness: 'configured',
};

function harness(fetchImpl: typeof fetch, rail: 'cardano' | 'solana' = 'cardano', statusTimeoutMs = 10_000) {
  const events: Array<Record<string, unknown>> = [];
  const waits: number[] = [];
  const diag: BridgeDiag = (event) => events.push(event);
  const client = new BridgeClient(rail, {
    url: 'https://payer.example', token: TOKEN, fetch: fetchImpl, statusTimeoutMs,
    diag, wait: async (ms) => { waits.push(ms); },
  });
  return { client, events, waits };
}

const json = (body: unknown, status = 200) => Response.json(body, { status });
const sourceBody = (source: FundingSource | null, extra: Record<string, unknown> = {}) => ({ ok: true, source, ...extra });

describe('payer readiness recovery', () => {
  it('classifies a non-transient fetch rejection without leaking error details or retrying', async () => {
    const failure = new Error('private URL and body must not be logged');
    const h = harness(async () => { throw failure; });

    await expect(h.client.status()).resolves.toBeNull();
    expect(h.events.map((event) => [event.route, event.outcome])).toEqual([['status', 'fetch_error']]);
    expect(JSON.stringify(h.events)).not.toContain(failure.message);
    expect(h.waits).toEqual([]);
  });

  it('classifies transient connect and timeout errors, wakes once, and recovers by status', async () => {
    for (const [error, outcome] of [
      [Object.assign(new Error('socket refused'), { cause: { code: 'ECONNREFUSED' } }), 'connect_error'],
      [Object.assign(new Error('request timed out'), { name: 'TimeoutError' }), 'timeout'],
    ] as const) {
      const calls: string[] = [];
      const h = harness(async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/health')) return json({ ok: true });
        if (calls.filter((call) => call.endsWith('/status')).length === 1) throw error;
        return json(sourceBody(CARDANO));
      });

      await expect(h.client.status()).resolves.toMatchObject({ source: CARDANO });
      expect(h.events[0]).toMatchObject({ route: 'status', outcome });
      expect(calls.map((url) => new URL(url).pathname)).toEqual(['/status', '/health', '/status']);
      expect(h.waits).toEqual([500]);
    }
  });

  it('does not recover from authentication, invalid JSON, schema, missing source, or rail mismatch', async () => {
    const cases: Array<{ name: string; response: () => Response; outcome: string }> = [
      { name: 'authentication failure', response: () => json({ error: 'private response' }, 401), outcome: 'http_error' },
      { name: 'invalid JSON', response: () => new Response('private malformed body'), outcome: 'invalid_json' },
      { name: 'schema mismatch', response: () => json({ ok: true, source: { private: 'value' } }), outcome: 'schema_mismatch' },
      { name: 'missing source', response: () => json(sourceBody(null)), outcome: 'missing_source' },
      { name: 'rail mismatch', response: () => json(sourceBody(SOLANA)), outcome: 'rail_mismatch' },
    ];

    for (const testCase of cases) {
      const calls: string[] = [];
      const h = harness(async (input) => { calls.push(String(input)); return testCase.response(); });
      await expect(h.client.status(), testCase.name).resolves.toBeNull();
      expect(calls.map((url) => new URL(url).pathname), testCase.name).toEqual(['/status']);
      expect(h.events.map((event) => event.outcome), testCase.name).toEqual([testCase.outcome]);
      expect(JSON.stringify(h.events), testCase.name).not.toMatch(/private|malformed body/);
      expect(h.waits, testCase.name).toEqual([]);
    }
  });

  it('uses one health request and a controlled retry after a transient 503', async () => {
    const calls: string[] = [];
    const h = harness(async (input) => {
      const url = String(input);
      calls.push(new URL(url).pathname);
      if (url.endsWith('/health')) return json({ ok: true });
      return calls.filter((path) => path === '/status').length === 1
        ? json({ error: 'ignored' }, 503)
        : json(sourceBody(CARDANO, { ledger: { headroomBaseUnits: '12345' } }));
    });

    await expect(h.client.status()).resolves.toMatchObject({ source: CARDANO, headroomBaseUnits: 12345n });
    expect(calls).toEqual(['/status', '/health', '/status']);
    expect(h.events.map((event) => [event.route, event.outcome])).toEqual([
      ['status', 'http_error'], ['health', 'success'], ['status', 'success'],
    ]);
    expect(h.waits).toEqual([500]);
  });

  it('gives the health probe only the readiness budget that remains', async () => {
    const paths: string[] = [];
    let nowCalls = 0;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => {
      const call = nowCalls++;
      return call < 5 ? 1_000 : 1_950;
    });
    const h = harness(async (input, init) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path === '/status') return json({ error: 'sleeping' }, 503);
      const signal = init?.signal as AbortSignal;
      return await new Promise<Response>((_resolve, reject) => {
        const abort = () => reject(signal.reason);
        if (signal.aborted) abort();
        else signal.addEventListener('abort', abort, { once: true });
      });
    }, 'cardano', 1_000);
    const started = performance.now();

    try {
      await expect(h.client.status()).resolves.toBeNull();
      const elapsedMs = performance.now() - started;
      expect(paths).toEqual(['/status', '/health']);
      expect(elapsedMs).toBeGreaterThan(20);
      expect(elapsedMs).toBeLessThan(250);
      expect(h.events.map((event) => [event.route, event.outcome])).toEqual([
        ['status', 'http_error'], ['health', 'timeout'],
      ]);
      expect(h.waits).toEqual([]);
    } finally {
      clock.mockRestore();
    }
  });

  it('bounds repeated 503 recovery to one wake and two retries', async () => {
    const calls: string[] = [];
    const h = harness(async (input) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      return path === '/health' ? json({ ok: true }) : json({ error: 'ignored' }, 503);
    });

    await expect(h.client.status()).resolves.toBeNull();
    expect(calls).toEqual(['/status', '/health', '/status', '/status']);
    expect(h.waits).toEqual([500, 1500]);
    expect(h.events.filter((event) => event.route === 'status' && event.outcome === 'http_error')).toHaveLength(3);
  });

  it('coalesces simultaneous status calls into one readiness sequence', async () => {
    let resolveFetch!: (response: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    let fetchCalls = 0;
    const h = harness(async () => { fetchCalls++; return fetchPromise; });

    const first = h.client.status();
    const second = h.client.status();
    await Promise.resolve();
    expect(fetchCalls).toBe(1);
    resolveFetch(json(sourceBody(CARDANO)));
    await expect(Promise.all([first, second])).resolves.toEqual([
      { source: CARDANO }, { source: CARDANO },
    ]);
    expect(fetchCalls).toBe(1);
  });

  it.each([
    ['cardano', CARDANO],
    ['solana', SOLANA],
  ] as const)('keeps readiness read-only for the %s rail', async (rail, source) => {
    const paths: string[] = [];
    const h = harness(async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return json(sourceBody(source));
    }, rail);

    await expect(h.client.status()).resolves.toMatchObject({ source });
    expect(paths).toEqual(['/status']);
    expect(paths.filter((path) => path === '/pay')).toEqual([]);
  });
});
