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
      'In progress', 'Order confirmed', 'Checking with merchant', 'Booking confirmed', 'Price changed', 'Awaiting payment', 'Order confirmed',
    ]);
    expect(vm.counts).toEqual({ all: 7, in_progress: 3, attention: 1, completed: 3 });
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

  it('leads with the source store while disclosing the separate test checkout', async () => {
    const vm = await detail('found-elsewhere');
    expect(vm.route.to.name).toBe('Harbor and Pine');
    expect(vm.route.to.detail).toBe('Checkout via Capsule');
    const boundary = "This is a test order placed with Capsule's test store. Harbor and Pine receives no order and no payment.";
    expect(vm.summary.notes).toContain(boundary);
    expect(vm.receipt?.notes[0]).toBe(boundary);
    expect(vm.proof.sections[1]!.fields.find((f) => f.label === 'Merchant')?.value).toBe('Harbor and Pine');
    expect(vm.steps.find((s) => s.key === 'ordering')?.detail).toBe('Sent to Capsule checkout.');
    expect(vm.steps.find((s) => s.key === 'confirmed')?.detail).toBe('Capsule checkout confirmed. Order paid.');
    expect(vm.quote?.source?.link.href).toBe('https://harborandpine.example/products/merino-crew-socks');
    // Receipt notes are console copy, never the gateway's engineering wording.
    for (const n of vm.receipt!.notes) expect(n).not.toMatch(/fixture|sandbox|provider|notional|OCBC|ledger|capacity|\u2014/i);
    // An ordinary Shopify purchase has no source store.
    expect((await detail('completed')).quote?.source).toBeNull();
  });

  it('keeps the source store visible when the console cannot read the quote', async () => {
    const bundle = await source.getPurchase(source.idFor('found-elsewhere')!);
    expect(presentDetail({ ...bundle, quote: null }, ctx).route.to.name).toBe('Harbor and Pine');
    expect(presentDetail({ ...bundle, quote: null, proof: null }, ctx).route.to.name).toBe('Harbor and Pine');
  });
});
