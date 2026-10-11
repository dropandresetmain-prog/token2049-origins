import { describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BackgroundJobs } from '../../src/channels/mcp/tools.js';
import { createMcpServer } from '../../src/channels/mcp/server.js';
import { startHarness, retailIntent, retailFulfillment } from '../support/harness.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('BackgroundJobs', () => {
  it('returns the value when the job finishes within the wait', async () => {
    const jobs = new BackgroundJobs(200);
    expect(await jobs.run('k', async () => 7)).toEqual({ pending: false, value: 7 });
  });

  it('answers "pending" after the wait, keeps the job running, and a repeat call joins it instead of starting another', async () => {
    const jobs = new BackgroundJobs(30);
    let starts = 0;
    const slow = async () => { starts++; await sleep(150); return 'quote'; };
    expect(await jobs.run('k', slow)).toEqual({ pending: true });
    expect(await jobs.run('k', slow)).toEqual({ pending: true });
    await sleep(200);
    expect(await jobs.run('k', slow)).toEqual({ pending: false, value: 'quote' });
    expect(starts).toBe(1);
  });

  it('keeps a finished result briefly (idempotent repeats) and then forgets it', async () => {
    let now = 1_000;
    const jobs = new BackgroundJobs(50, 1000, () => now);
    let starts = 0;
    const once = async () => { starts++; return starts; };
    expect(await jobs.run('k', once)).toEqual({ pending: false, value: 1 });
    expect(await jobs.run('k', once)).toEqual({ pending: false, value: 1 });
    now += 1001;
    expect(await jobs.run('k', once)).toEqual({ pending: false, value: 2 });
  });

  it('rethrows a failure exactly once, then lets the next call start fresh', async () => {
    const jobs = new BackgroundJobs(100);
    let n = 0;
    const flaky = async () => { n++; if (n === 1) throw new Error('boom'); return 'ok'; };
    await expect(jobs.run('k', flaky)).rejects.toThrow('boom');
    expect(await jobs.run('k', flaky)).toEqual({ pending: false, value: 'ok' });
  });

  it('keeps different keys independent', async () => {
    const jobs = new BackgroundJobs(100);
    expect(await jobs.run('a', async () => 'A')).toMatchObject({ value: 'A' });
    expect(await jobs.run('b', async () => 'B')).toMatchObject({ value: 'B' });
  });

  it('within(): a promise that outlives the wait keeps running and its rejection is swallowed', async () => {
    const jobs = new BackgroundJobs(20);
    let finished = false;
    const slow = (async () => { await sleep(80); finished = true; throw new Error('late failure'); })();
    expect(await jobs.within(slow)).toEqual({ pending: true });
    await sleep(120);
    expect(finished).toBe(true); // it was never cancelled and nothing crashed
    expect(await jobs.within(Promise.resolve(5))).toEqual({ pending: false, value: 5 });
  });
});

describe('quote collection across a simulated process restart', () => {
  it('a fresh BackgroundJobs collects the same durable quote without re-running the provider quote', async () => {
    const h = await startHarness();
    let quoteCalls = 0;
    const inner = h.retail.quote.bind(h.retail);
    h.retail.quote = async (...args: Parameters<typeof inner>) => { quoteCalls++; await sleep(150); return inner(...args); };
    const session = async (background: BackgroundJobs) => {
      const server = createMcpServer({ gatewayUrl: h.url, gatewayToken: h.alice.token }, { background });
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: 'restart-collection', version: '1' });
      await Promise.all([server.connect(a), client.connect(b)]);
      return {
        call: async (name: string, args: Record<string, unknown>) => await client.callTool({ name, arguments: args }) as any,
        close: async () => { await client.close(); await server.close(); },
      };
    };
    const first = await session(new BackgroundJobs(20));
    const restarted = await session(new BackgroundJobs(5_000)); // restart: a fresh in-memory registry with nothing retained
    try {
      const search = await h.call('POST', '/v1/offers/search', { token: h.alice.token, body: { intent: retailIntent() } });
      const request = { offerId: search.body.offers[0].offerId as string, fulfillment: retailFulfillment };
      expect((await first.call('create_quote', request)).structuredContent.status).toBe('quote_pending');
      await expect.poll(async () => (await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM quotes'))!.n, { timeout: 5000 }).toBe(1);
      const persisted = (await h.gw.db.get<{ id: string; digest: string }>('SELECT id,digest FROM quotes'))!;
      const collected = await restarted.call('create_quote', request);
      expect(collected.isError).toBeFalsy();
      expect(collected.structuredContent.quote).toMatchObject({ quoteId: persisted.id, digest: persisted.digest });
      expect(collected.structuredContent.quote.fundingOptions.length).toBeGreaterThan(0);
      expect(quoteCalls).toBe(1); // the durable join returned the persisted row; the provider was never re-executed
      const again = await first.call('create_quote', request); // the original session converges on the same quote too
      expect(again.structuredContent.quote.quoteId).toBe(persisted.id);
      expect(quoteCalls).toBe(1);
      expect((await h.gw.db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM quotes'))!.n).toBe(1);
    } finally { await first.close(); await restarted.close(); await h.close(); }
  });
});
