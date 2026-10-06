import { describe, expect, it } from 'vitest';
import { elapsedMs, formatLatency, LatencyEvidence, LatencyRecord, purchaseLatency } from '../../src/core/latency.js';

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 6) + seconds * 1000).toISOString();
const evidence = LatencyEvidence.parse({ quote: { createdAt: at(0) }, events: [
  ['approval.recorded', 1], ['funding.submitted', 2], ['funding.confirmed', 10], ['execution.queued', 10],
  ['execution.picked_up', 11], ['execution.started', 12], ['execution.reference_observed', 20],
  ['execution.adapter_returned', 24], ['execution.succeeded', 25], ['receipt.issued', 25],
].map(([type, seconds], sequence) => ({ type, at: at(Number(seconds)), sequence })) });

describe('latency from durable evidence', () => {
  it('measures recorded phases without summing overlapping intervals', () => {
    const report = purchaseLatency(evidence, at(26.5));
    expect(report.totalMs).toBe(25_500);
    const phase = (label: string) => report.phases.find(p => p.label === label)?.ms;
    expect(phase('Payment confirmation')).toBe(8000);
    expect(phase('Queue wait')).toBe(1000);
    expect(phase('Merchant execution + verification')).toBe(13_000);
    expect(phase('Console visibility')).toBe(1500);
    expect(formatLatency(report)).toContain('8.000s');
  });
  it('leaves unavailable boundaries unknown, including immediate-confirmation submission', () => {
    const report = purchaseLatency({ events: evidence.events.filter(e => !['funding.submitted', 'execution.reference_observed', 'execution.picked_up'].includes(e.type)) });
    expect(report.milestones.paymentSubmitted).toBeNull();
    expect(report.phases.find(p => p.label === 'Payment confirmation')?.ms).toBeNull();
    expect(report.phases.find(p => p.label === 'Queue wait')?.ms).toBeNull();
    expect(formatLatency(report)).toContain('unavailable');
  });
  it('rejects invalid, missing or reversed timing and strips unrelated fields', () => {
    for (const pair of [[at(5), at(4)], ['invalid', at(1)], [null, at(1)]] as const) expect(elapsedMs(pair[0], pair[1])).toBeNull();
    expect(LatencyEvidence.safeParse({ events: [{ sequence: 0, type: 'x', at: 'invalid' }] }).success).toBe(false);
    expect(LatencyEvidence.parse({ ...evidence, credentials: 'never output' })).not.toHaveProperty('credentials');
  });
  it('sorts events and keeps the first response boundary across repeated readbacks', () => {
    const report = purchaseLatency({ events: [...evidence.events, { sequence: 11, type: 'execution.reference_observed', at: at(30) }].reverse() });
    expect(report.milestones.referenceObserved).toBe(at(20));
  });
  it('accepts a console download wrapper or a direct gateway export', () => {
    expect(LatencyRecord.parse({ technicalRecord: evidence, unrelated: 'discarded' })).toEqual(evidence);
    expect(LatencyRecord.parse(evidence)).toEqual(evidence);
  });
  it('marks fixture funding rather than presenting it as measured blockchain time', () => {
    const report = purchaseLatency({ ...evidence, funding: [{ observedAt: at(2), verifiedAt: at(2), evidenceMode: 'local_fixture' }] });
    expect(formatLatency(report)).toContain('SIMULATED funding');
  });
  it('counts later ticket issuance as merchant latency rather than console visibility', () => {
    const report = purchaseLatency({ ...evidence, events: [...evidence.events, { sequence: 11, type: 'outcome.refreshed', at: at(55) }] }, at(56));
    expect(report.milestones.receiptIssued).toBe(at(25));
    expect(report.milestones.verified).toBe(at(55));
    expect(report.phases.find(p => p.label === 'Merchant execution + verification')?.ms).toBe(43_000);
    expect(report.phases.find(p => p.label === 'Console visibility')?.ms).toBe(1000);
    expect(report.totalMs).toBe(55_000);
  });
});
