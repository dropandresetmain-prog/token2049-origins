import { describe, expect, it } from 'vitest';
import { createSampleSource } from '../source/sample.js';
import { presentDetail, presentList, filterRows } from './present.js';
import type { PresentContext } from './present.js';

const NOW = Date.parse('2026-10-06T10:20:00Z');
const ctx: PresentContext = { now: new Date(NOW), locale: 'en-US', timeZone: 'Asia/Singapore', mode: 'sample' };
const source = createSampleSource({ now: NOW });

async function detail(key: string) {
  const id = source.idFor(key)!;
  return presentDetail(await source.getPurchase(id), ctx);
}

describe('presenters over sample purchases', () => {
  it('lists every sample with one status vocabulary and group counts', async () => {
    const vm = presentList(await source.listPurchases(), ctx);
    expect(vm.rows.map((r) => r.status.label)).toEqual([
      'In progress', 'Completed', 'Checking with merchant', 'Completed', 'Price changed', 'Awaiting payment',
    ]);
    expect(vm.counts).toEqual({ all: 6, in_progress: 3, attention: 1, completed: 2 });
    expect(filterRows(vm.rows, 'all', 'bangkok').map((r) => r.title)).toEqual(['One night in Bangkok']);
  });

  it('never shows a receipt before the merchant confirms', async () => {
    for (const key of ['in-progress', 'checking', 'price-changed', 'awaiting-payment']) {
      expect((await detail(key)).receipt).toBeNull();
    }
    expect((await detail('completed')).receipt).not.toBeNull();
  });

  it('keeps payment and merchant confirmation separate', async () => {
    const vm = await detail('in-progress');
    expect(vm.proof.sections[0]!.badge.label).toBe('Received');
    expect(vm.proof.sections[1]!.badge.label).toBe('Not confirmed');
    expect(vm.proof.confirmedCount).toBe(1);
  });

  it('price change: nothing bought, one action, no comparison', async () => {
    const vm = await detail('price-changed');
    expect(vm.status.label).toBe('Price changed');
    expect(vm.attention?.title).toBe('The price changed, so nothing was bought.');
    expect(vm.attention?.action.label).toBe('Copy request for a new quote');
    expect(vm.steps.find((s) => s.key === 'ordering')?.status).toBe('attention');
  });
});
