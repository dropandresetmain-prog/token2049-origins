import { describe, expect, it } from 'vitest';
import { BridgeClient, type BridgeDiag } from '../../src/channels/mcp/bridge.js';
import { SOLANA_DEVNET_NETWORK, SOLANA_DEVNET_USDC_MINT, type FundingSource } from '../../src/contracts/presentation.js';

const TOKEN = 'consolidated-test-secret-token';
const SOURCE: FundingSource = {
  sourceId: 'src_' + 'a'.repeat(32), rail: 'solana', network: SOLANA_DEVNET_NETWORK,
  publicAddress: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
  displayAddress: '9xQeWvG816bUx…PusVFin', assetId: SOLANA_DEVNET_USDC_MINT, readiness: 'configured',
};

const json = (body: unknown, status = 200) => Response.json(body, { status });
const ready = (source: FundingSource | null) => ({ ok: true, source });

function harness(fetchImpl: typeof fetch) {
  const events: Array<Record<string, unknown>> = [];
  const waits: number[] = [];
  const diag: BridgeDiag = (event) => events.push(event);
  const client = new BridgeClient('solana', {
    url: 'https://bridge.example/private-path', token: TOKEN, fetch: fetchImpl,
    statusTimeoutMs: 10_000, timeoutMs: 1000, diag, wait: async (ms) => { waits.push(ms); },
  });
  return { client, events, waits };
}

describe('consolidated payer readiness and payment boundary', () => {
  it('coalesces authenticated prepare calls and accepts a ready response with no source', async () => {
    let resolveFetch!: (response: Response) => void;
    const response = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const h = harness(async (input, init) => {
      requests.push({ url: String(input), init });
      return response;
    });

    const first = h.client.prepare();
    const second = h.client.prepare();
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://bridge.example/private-path/status');
    expect(requests[0]!.init?.method).toBeUndefined();
    expect(new Headers(requests[0]!.init?.headers).get('authorization')).toBe(`Bearer ${TOKEN}`);
    expect(new Headers(requests[0]!.init?.headers).get('user-agent')).toBe('Capsule/0.1');
    resolveFetch(json(ready(null)));

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(requests.map(({ url }) => new URL(url).pathname)).toEqual(['/private-path/status']);
    expect(requests.some(({ url }) => new URL(url).pathname.endsWith('/pay'))).toBe(false);
    expect(h.events).toMatchObject([{ type: 'payer_transport', outcome: 'ready', attempt: 0 }]);
  });

  it('retries a transient status failure and becomes ready without a real delay', async () => {
    const paths: string[] = [];
    const h = harness(async (input) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      return paths.length === 1 ? json({ error: 'private upstream detail' }, 503) : json(ready(SOURCE));
    });

    await expect(h.client.prepare()).resolves.toBe(true);
    expect(paths).toEqual(['/private-path/status', '/private-path/status']);
    expect(h.waits).toEqual([1000]);
    expect(h.events.map(({ outcome }) => outcome)).toEqual(['http_error', 'ready']);
    expect(paths.some((path) => path.endsWith('/pay'))).toBe(false);
  });

  it('retries a read-only 429 and respects Retry-After without paying', async () => {
    let calls = 0;
    const h = harness(async () => ++calls === 1 ? new Response('edge throttle', { status: 429, headers: { 'retry-after': '2' } }) : json(ready(null)));
    await expect(h.client.prepare()).resolves.toBe(true);
    expect(calls).toBe(2);
    expect(h.waits).toEqual([2000]);
    expect(h.events[0]).toMatchObject({ status: 429, contentType: 'other' });
  });

  it('does not outwait its readiness budget or retry a throttled payment POST', async () => {
    let calls = 0;
    const h = harness(async () => { calls++; return new Response('edge throttle', { status: 429, headers: { 'retry-after': '120' } }); });
    await expect(h.client.prepare()).resolves.toBe(false);
    expect(calls).toBe(1);
    expect(h.waits).toEqual([]);
    await expect(h.client.pay('pur_1234567890')).resolves.toMatchObject({ ok: false, code: 'bridge_error', httpStatus: 429 });
    expect(calls).toBe(2);
  });

  it.each([
    ['authentication refusal', () => json({ error: 'secret auth detail' }, 401), 'http_error'],
    ['malformed success response', () => json({ ok: true, source: { rail: 'solana', private: 'secret data' } }), 'schema_mismatch'],
  ])('refuses %s without retrying or paying', async (_name, response, outcome) => {
    const paths: string[] = [];
    const h = harness(async (input) => { paths.push(new URL(String(input)).pathname); return response(); });

    await expect(h.client.prepare()).resolves.toBe(false);
    expect(paths).toEqual(['/private-path/status']);
    expect(h.waits).toEqual([]);
    expect(h.events).toMatchObject([{ type: 'payer_transport', outcome, attempt: 0 }]);
    expect(paths.some((path) => path.endsWith('/pay'))).toBe(false);
  });

  it('logs only sanitized HTTP classification and never retries POST /pay', async () => {
    let payCalls = 0;
    const h = harness(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/status')) return json(ready(SOURCE));
      payCalls++;
      return json({ ok: false, error: { code: 'declined', message: 'private response body detail' } }, 502);
    });

    await expect(h.client.pay('pur_1234567890')).resolves.toMatchObject({
      ok: false, code: 'declined', httpStatus: 502, responseCategory: 'canonical_failure', retrySafe: false,
    });
    expect(payCalls).toBe(1);
    const paymentEvent = h.events.find(({ type }) => type === 'payer_payment_http');
    expect(paymentEvent).toMatchObject({
      status: 502, contentType: 'json', responseCategory: 'canonical_failure', purchaseId: 'pur_1234567890',
    });
    expect(JSON.stringify(paymentEvent)).not.toMatch(/private response|bridge\.example|secret-token/);
  });

  it('treats an ambiguous network failure as unsafe to retry', async () => {
    let calls = 0;
    const failure = new Error('private bridge URL and response details');
    const h = harness(async () => { calls++; throw failure; });

    const result = await h.client.pay('pur_1234567890');
    expect(result).toMatchObject({ ok: false, code: 'bridge_unreachable' });
    if (result.ok) throw new Error('ambiguous network failure unexpectedly succeeded');
    expect(result.retrySafe).not.toBe(true);
    expect(calls).toBe(1);
    expect(JSON.stringify(h.events)).not.toMatch(/private bridge|bridge\.example|secret-token/);
  });
});
