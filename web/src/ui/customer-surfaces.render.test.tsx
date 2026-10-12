import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSampleSource } from '../source/sample.js';
import { sampleConnections, sampleTreasury } from '../source/sample.operator.js';
import { presentDetail } from '../model/present.js';
import { presentConnections, presentTreasury } from '../model/operator.js';
import { customerRecord } from '../../../src/presentation/customer.js';
import { Loaded } from './PurchaseDetail.js';
import { ReceiptDialog, QuoteDialog, AboutDialog } from './Dialogs.js';
import { TreasuryView } from './Treasury.js';
import { ConnectionsView } from './Connections.js';
import { EnvStrip } from './Shell.js';
import { TechnicalDetails } from './OperatorParts.js';
import { UiProvider } from './context.js';
import { ProofPanel } from './ProofPanel.js';

// Render portal contents in place so the real dialogs and drawer can be inspected without a browser DOM.
vi.mock('react-dom', async original => ({
  ...await original<typeof import('react-dom')>(),
  createPortal: (children: ReactNode) => children,
}));
beforeAll(() => vi.stubGlobal('document', { body: {} }));
afterAll(() => vi.unstubAllGlobals());

const now = Date.parse('2026-10-06T10:20:00Z');
const source = createSampleSource({ now });
const ctx = { now: new Date(now), locale: 'en-US', timeZone: 'Asia/Singapore', mode: 'test' as const };
const forbidden = /demo|sandbox|simulated|fake|testnet|devnet/i;
const noop = () => undefined;

describe('all customer surfaces exclude environment labels', () => {
  it.each(['in-progress', 'completed', 'completed-hotel', 'checking', 'price-changed', 'awaiting-payment', 'found-elsewhere'])(
    '%s: purchase, quote, receipt, proof records and downloads', async key => {
      const bundle = await source.getPurchase(source.idFor(key)!);
      const before = JSON.stringify(bundle);
      const vm = presentDetail(bundle, ctx);
      const html = renderToStaticMarkup(<UiProvider>
        <Loaded vm={vm} onProof={noop} onReceipt={noop} onQuote={noop} />
        {vm.receipt && <ReceiptDialog receipt={vm.receipt} onClose={noop} />}
        {vm.quote && <QuoteDialog quote={vm.quote} onClose={noop} />}
        <ProofPanel vm={vm} tab="summary" onTab={noop} onClose={noop} />
        <ProofPanel vm={vm} tab="activity" onTab={noop} onClose={noop} />
        <TechnicalDetails summary="Proof" note="Recorded purchase" value={vm.proof} />
      </UiProvider>);
      expect(html).not.toMatch(forbidden);
      expect(JSON.stringify(customerRecord(vm))).not.toMatch(forbidden);
      expect(JSON.stringify(bundle)).toBe(before);
    },
  );

  it.each(['Testnet USDC', 'Devnet test USDC'])('provider asset label %s is cleaned in the payment summary and proof', async symbol => {
    const bundle = await source.getPurchase(source.idFor('completed-hotel')!);
    bundle.purchase.fundingRequirement!.amount.symbol = symbol;
    const before = JSON.stringify(bundle);
    const vm = presentDetail(bundle, ctx);
    const html = renderToStaticMarkup(<UiProvider><Loaded vm={vm} onProof={noop} onReceipt={noop} onQuote={noop} /><ProofPanel vm={vm} tab="summary" onTab={noop} onClose={noop} /></UiProvider>);
    expect(html).not.toMatch(forbidden);
    expect(vm.summary.payment.amount).toContain('USDC');
    expect(JSON.stringify(bundle)).toBe(before);
  });

  it('Treasury and Connections include technical details without leaking nested labels', () => {
    const treasury = sampleTreasury();
    const connections = sampleConnections(now);
    const before = JSON.stringify([treasury, connections]);
    const html = renderToStaticMarkup(<>
      <TreasuryView vm={presentTreasury(treasury, ctx)} />
      <ConnectionsView vm={presentConnections(connections, ctx)} />
    </>);
    expect(html).not.toMatch(forbidden);
    expect(html).toContain('Purchasing capacity');
    expect(html).toContain('Observed funds');
    expect(html).toContain('****3456');
    expect(JSON.stringify([treasury, connections])).toBe(before);
  });

  it.each(['sample', 'test', 'live'] as const)('%s: shared chrome and About have no environment banner', mode => {
    expect(renderToStaticMarkup(<EnvStrip mode={mode} />)).toBe('');
    expect(renderToStaticMarkup(<UiProvider><AboutDialog mode={mode} onClose={noop} /></UiProvider>)).not.toMatch(forbidden);
  });
});
