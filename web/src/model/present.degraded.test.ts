import { describe, expect, it } from 'vitest';
import { createSampleSource } from '../source/sample.js';
import { EMPTY_CONTEXT } from '../contracts/proposed.js';
import type { PurchaseBundle } from '../contracts/source.js';
import { presentDetail, presentList } from './present.js';
import type { PresentContext } from './present.js';

/**
 * The gateway source returns what a key with limited scopes can read: no proof, evidence or quote (403),
 * and no proposed context (gaps G1 to G4). Every sample purchase must still present without throwing.
 */
const NOW = Date.parse('2026-10-06T10:20:00Z');
const ctx: PresentContext = { now: new Date(NOW), locale: 'en-US', timeZone: 'Asia/Singapore', mode: 'test' };
const source = createSampleSource({ now: NOW });

async function degradedBundles(strip: (b: PurchaseBundle) => PurchaseBundle) {
  const list = await source.listPurchases();
  return Promise.all(list.entries.map(async (e) => strip(await source.getPurchase(e.item.id))));
}

describe('presenters over degraded gateway bundles', () => {
  it('present with proof, evidence, quote and context all missing', async () => {
    const bundles = await degradedBundles((b) => ({ ...b, proof: null, evidence: null, quote: null, technicalRecord: null, context: EMPTY_CONTEXT }));
    expect(bundles.length).toBeGreaterThan(0);
    for (const b of bundles) {
      const vm = presentDetail(b, ctx);
      expect(vm.title, b.purchase.purchaseId).toBeTruthy();
      expect(vm.status.label).toBeTruthy();
    }
  });

  it('present with each optional read missing on its own', async () => {
    for (const field of ['proof', 'evidence', 'quote'] as const) {
      const bundles = await degradedBundles((b) => ({ ...b, [field]: null, ...(field === 'evidence' ? { technicalRecord: null } : {}) }));
      for (const b of bundles) expect(() => presentDetail(b, ctx), `${field} ${b.purchase.purchaseId}`).not.toThrow();
    }
  });

  it('lists rows without any context', async () => {
    const list = await source.listPurchases();
    const vm = presentList({ ...list, entries: list.entries.map((e) => ({ item: e.item, context: EMPTY_CONTEXT })) }, ctx);
    expect(vm.rows).toHaveLength(list.entries.length);
    for (const row of vm.rows) expect(row.title).toBeTruthy();
  });
});
