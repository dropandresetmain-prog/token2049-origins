import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { createSampleSource } from '../source/sample.js';
import { presentDetail } from '../model/present.js';
import { Loaded } from './PurchaseDetail.js';
import { UiProvider } from './context.js';

const source = createSampleSource({ now: Date.parse('2026-10-06T10:20:00Z') });
const ctx = { now: new Date('2026-10-06T10:20:00Z'), locale: 'en-US', timeZone: 'Asia/Singapore', mode: 'sample' as const };
const noop = () => undefined;

describe('final purchase screen', () => {
  it.each([['completed', 'Order confirmed', 'Order reference'], ['completed-hotel', 'Booking confirmed', 'Booking reference']] as const)(
    '%s has a prominent ending with reference and immediate receipt/proof access', async (key, label, refLabel) => {
      const bundle = await source.getPurchase(source.idFor(key)!);
      const vm = presentDetail(bundle, ctx);
      expect(vm.completion?.title).toBe(label);
      expect(vm.live).toBe(false);
      const html = renderToStaticMarkup(<UiProvider><Loaded vm={vm} onProof={noop} onReceipt={noop} onQuote={noop} /></UiProvider>);
      const panel = /<section class="completion-panel"[\s\S]*?<\/section>/.exec(html)?.[0];
      expect(panel).toContain(label);
      expect(panel).toContain(refLabel);
      expect(panel).toContain(bundle.purchase.providerReference);
      expect(panel).toContain('View receipt');
      expect(panel).toContain('Proof');
    },
  );
  it('shows Ticket issued only after durable ticketed success', async () => {
    const bundle = await source.getPurchase(source.idFor('completed-hotel')!);
    bundle.purchase = { ...bundle.purchase, category: 'flight', route: 'atlas', commerceStatus: 'ticketed' };
    const vm = presentDetail(bundle, ctx);
    expect(vm.completion).toMatchObject({ title: 'Ticket issued', reference: { label: 'Flight reference' } });
    expect(vm.status.label).toBe('Ticket issued');
    bundle.purchase.commerceStatus = 'ticketing';
    // Even a stale successful proof must not supply a success gate.
    expect(presentDetail(bundle, ctx)).toMatchObject({ completion: null, receipt: null, live: true });
  });
  it.each(['awaiting-payment', 'checking', 'in-progress', 'price-changed'] as const)('%s has no success panel', async key => {
    const vm = presentDetail(await source.getPurchase(source.idFor(key)!), ctx);
    expect(vm.completion).toBeNull();
  });
  it('uses a receipt reference or receipt number when no purchase reference is present', async () => {
    const bundle = await source.getPurchase(source.idFor('completed')!);
    bundle.purchase.providerReference = null;
    expect(presentDetail(bundle, ctx).completion?.reference?.value).toBe(bundle.purchase.receipt!.providerReference);
    bundle.purchase.receipt!.providerReference = null;
    expect(presentDetail(bundle, ctx).completion?.reference).toMatchObject({ label: 'Receipt number', value: bundle.purchase.receipt!.receiptId });
  });
});
