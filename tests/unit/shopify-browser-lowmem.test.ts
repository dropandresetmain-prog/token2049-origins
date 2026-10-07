import { describe, expect, it, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  launches: [] as Array<Record<string, unknown>>,
  active: 0,
  maxActive: 0,
  handlers: [] as Array<(route: any) => Promise<void>>,
}));

vi.mock('playwright-core', () => ({
  chromium: {
    launch: vi.fn(async (opts: Record<string, unknown>) => {
      state.launches.push(opts);
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      return {
        newContext: async () => ({
          setDefaultTimeout: () => undefined,
          route: async (_pattern: string, handler: (route: any) => Promise<void>) => { state.handlers.push(handler); },
          newPage: async () => ({}),
        }),
        close: async () => { state.active--; },
      };
    }),
  },
}));

import { PlaywrightCheckoutDriver } from '../../src/execution/shopify/browserCheckout.js';

const STORE = 'shop.example.test';
const URL_OK = `https://${STORE}/checkouts/abc`;
const makeRoute = (url: string, resourceType: string, navigation = false) => {
  const calls: string[] = [];
  return {
    calls,
    route: {
      request: () => ({ url: () => url, resourceType: () => resourceType, isNavigationRequest: () => navigation, frame: () => ({ parentFrame: () => (navigation ? null : {}) }) }),
      abort: async () => { calls.push('abort'); },
      continue: async () => { calls.push('continue'); },
    },
  };
};
const pageOf = (d: PlaywrightCheckoutDriver, lowMemory: boolean) => (d as unknown as { withPage: <T>(u: string, r: (p: unknown) => Promise<T>) => Promise<T> }).withPage(URL_OK, async () => 'done');

beforeEach(() => { state.launches.length = 0; state.handlers.length = 0; state.active = 0; state.maxActive = 0; });

describe('low-memory browser mode', () => {
  it('is off by default: no extra flags and resources untouched', async () => {
    const d = new PlaywrightCheckoutDriver({ storeDomain: STORE });
    const internals = d as unknown as { withPage: <T>(u: string, r: (p: unknown) => Promise<T>) => Promise<T> };
    await internals.withPage(URL_OK, async () => 'ok');
    expect(state.launches).toHaveLength(1);
    expect(state.launches.every((l) => l.args === undefined)).toBe(true);
    const img = makeRoute(`https://${STORE}/img.png`, 'image');
    await state.handlers[0]!(img.route);
    expect(img.calls).toEqual(['continue']);
  });

  it('launches lean Chromium, aborts images/media/fonts, and still enforces the store allowlist', async () => {
    const d = new PlaywrightCheckoutDriver({ storeDomain: STORE, lowMemory: true });
    await pageOf(d, true);
    const args = state.launches[0]!.args as string[];
    expect(args).toEqual(expect.arrayContaining(['--disable-dev-shm-usage', '--disable-gpu', '--renderer-process-limit=1']));
    expect(args.some((a) => a.startsWith('--js-flags=--max-old-space-size='))).toBe(true);
    const run = async (url: string, type: string, nav = false) => { const r = makeRoute(url, type, nav); await state.handlers[0]!(r.route); return r.calls; };
    for (const type of ['image', 'media', 'font']) expect(await run(`https://${STORE}/x`, type)).toEqual(['abort']);
    // Documents, scripts and styles still load (the page text and totals depend on them) ...
    expect(await run(`https://${STORE}/checkouts/abc`, 'document', true)).toEqual(['continue']);
    expect(await run('https://cdn.shopify.com/s/files/app.js', 'script')).toEqual(['continue']);
    expect(await run('https://cdn.shopify.com/s/files/app.css', 'stylesheet')).toEqual(['continue']);
    // ... and nothing outside the allowlist ever does.
    expect(await run('https://evil.example/x.js', 'script')).toEqual(['abort']);
    expect(await run('http://shop.example.test/x', 'script')).toEqual(['abort']);
  });

  it.each([false,true])('runs one browser at a time even after failure, lowMemory=%s', async lowMemory => {
    const d = new PlaywrightCheckoutDriver({ storeDomain: STORE, lowMemory, sink:()=>undefined });
    const internals = d as unknown as { withPage: <T>(u: string, r: (p: unknown) => Promise<T>) => Promise<T> };
    let running = 0, peak = 0;
    const slow = (ms: number, fail = false) => internals.withPage(URL_OK, async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, ms)); running--; if (fail) throw new Error('step failed'); return 'ok'; });
    const results = await Promise.allSettled([slow(60, true), slow(20), slow(20)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
    expect(peak).toBe(1);
    expect(state.maxActive).toBe(1);
    expect(state.launches).toHaveLength(3);
  });
});
