import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startHarness, createFundablePurchase, type Harness } from '../support/harness.js';
import { LatencyEvidence, purchaseLatency } from '../../src/core/latency.js';

describe('durable worker timing', () => {
  let h: Harness;
  beforeEach(async () => { h = await startHarness(); });
  afterEach(async () => { await h.close(); });
  it('records pickup and adapter return without changing the proven execution flow', async () => {
    const execute = h.retail.execute.bind(h.retail);
    h.retail.execute = async ctx => {
      // Fixture clock boundaries verify instrumentation; these are not live provider measurements.
      h.clock.advance(8000);
      await ctx.checkpoint('order', { providerReference: 'FIXTURE-TIMING-ORDER' });
      h.clock.advance(4100);
      return execute(ctx);
    };
    const { purchase, required } = await createFundablePurchase(h);
    await h.call('POST', `/v1/purchases/${purchase.purchaseId}/fund`, { token: h.alice.token, headers: { 'payment-signature': `fixture:latency:${required}` } });
    h.clock.advance(3200);
    await h.gw.worker.tick();
    const response = await h.call('GET', `/v1/evidence/purchases/${purchase.purchaseId}`, { token: h.alice.token });
    expect(response.status).toBe(200);
    const evidence = LatencyEvidence.parse(response.body);
    const report = purchaseLatency(evidence);
    expect(report.phases.find(p => p.label === 'Queue wait')?.ms).toBe(3200);
    expect(report.milestones.adapterReturned).not.toBeNull();
    expect(report.milestones.verified).not.toBeNull();
    expect(report.milestones.receiptIssued).not.toBeNull();
    expect(report.phases.find(p => p.label === '  Execution to reference observed')?.ms).toBe(8000);
    expect(report.phases.find(p => p.label === '  Reference to verified result')?.ms).toBe(4100);
    expect(h.retail.executeCalls).toBe(1);
    await h.gw.worker.tick();
    expect(h.retail.executeCalls).toBe(1);
  });
});
