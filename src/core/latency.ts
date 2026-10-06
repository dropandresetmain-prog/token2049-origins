import { z } from 'zod';

/** A narrow projection of a downloaded technical record; credentials and provider payloads are discarded. */
export const LatencyEvidence = z.object({
  quote: z.object({ createdAt: z.iso.datetime() }).nullable().optional(),
  funding: z.array(z.object({ observedAt: z.iso.datetime(), verifiedAt: z.iso.datetime(), evidenceMode: z.string().optional() })).optional(),
  events: z.array(z.object({ sequence: z.number().int(), type: z.string(), at: z.iso.datetime() })),
});
export type LatencyEvidence = z.infer<typeof LatencyEvidence>;
// Console proof downloads wrap the gateway response in technicalRecord; direct API exports do not.
export const LatencyRecord = z.union([
  z.object({ technicalRecord: LatencyEvidence }).transform(record => record.technicalRecord),
  LatencyEvidence,
]);

export function elapsedMs(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const elapsed = Date.parse(to) - Date.parse(from);
  return Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null;
}

/** Missing timestamps stay missing. One provider call can include execution and independent readback. */
export function purchaseLatency(evidence: LatencyEvidence, visibleAt: string | null = null) {
  const events = [...evidence.events].sort((a, b) => a.sequence - b.sequence);
  const first = (type: string) => events.find(e => e.type === type)?.at ?? null;
  const last = (type: string) => events.findLast(e => e.type === type)?.at ?? null;
  const milestones = {
    quoteCreated: evidence.quote?.createdAt ?? null,
    authorized: first('approval.recorded'),
    paymentPrepared: first('funding.attempt_prepared'),
    paymentSubmitted: first('funding.submitted'),
    // observedAt can be updated on later confirmation. The submitted event retains earlier detection.
    paymentDetected: first('funding.submitted') ?? evidence.funding?.[0]?.verifiedAt ?? null,
    paymentConfirmed: first('funding.confirmed'),
    queued: first('execution.queued'),
    pickedUp: first('execution.picked_up'),
    merchantStarted: first('execution.started'),
    referenceObserved: first('execution.reference_observed'),
    adapterReturned: first('execution.adapter_returned'),
    initiallyVerified: first('execution.succeeded'),
    verified: last('outcome.refreshed') ?? last('execution.succeeded'),
    receiptIssued: first('receipt.issued'),
    // Ticket issuance may become final after an earlier ticketing receipt. That wait is provider work,
    // not console lag; outcome.refreshed is currently emitted only for independently proven ticketed status.
    finalPublished: events.findLast(e => ['outcome.refreshed', 'receipt.issued'].includes(e.type))?.at ?? null,
    visible: visibleAt,
  };
  const m = milestones;
  const phases = [
    { label: 'Approval to confirmed payment', ms: elapsedMs(m.authorized, m.paymentConfirmed), source: 'buyer + blockchain + gateway' },
    { label: 'Payment confirmation', ms: elapsedMs(m.paymentSubmitted, m.paymentConfirmed), source: 'blockchain + confirmation polling' },
    { label: 'Queue wait', ms: elapsedMs(m.queued, m.pickedUp), source: 'internal' },
    { label: 'Execution gates', ms: elapsedMs(m.pickedUp, m.merchantStarted), source: 'internal + provider readiness' },
    { label: 'Merchant execution + verification', ms: elapsedMs(m.merchantStarted, m.verified), source: 'provider + readback + internal persistence' },
    { label: '  Execution to reference observed', ms: elapsedMs(m.merchantStarted, m.referenceObserved), source: 'approximate; Shopify/Nuitee only' },
    { label: '  Reference to verified result', ms: elapsedMs(m.referenceObserved, m.verified), source: 'approximate; includes readback/recovery' },
    { label: 'Receipt persistence', ms: elapsedMs(m.initiallyVerified, m.receiptIssued), source: 'internal; same transaction timestamp' },
    { label: 'Console visibility', ms: elapsedMs(m.finalPublished, m.visible), source: 'internal + HTTP; browser/server clocks must agree' },
  ];
  return { milestones, phases, totalMs: elapsedMs(m.authorized, m.visible ?? m.finalPublished),
    simulatedFunding: evidence.funding?.some(f => f.evidenceMode === 'local_fixture') ?? false };
}

export function formatLatency(report: ReturnType<typeof purchaseLatency>): string {
  const seconds = (ms: number | null) => ms === null ? 'unavailable' : `${(ms / 1000).toFixed(3)}s`;
  return [
    ...(report.simulatedFunding ? ['SIMULATED funding: these durations do not measure a real blockchain payment.'] : []),
    ...Object.entries(report.milestones).map(([label, at]) => `${label.padEnd(38)} ${at ?? 'unavailable'}`),
    '',
    ...report.phases.map(p => `${p.label.padEnd(38)} ${seconds(p.ms).padStart(11)}  (${p.source})`),
    `${'Total (authorization to receipt/visible)'.padEnd(38)} ${seconds(report.totalMs).padStart(11)}`,
    'Phases overlap; do not sum the confirmation and merchant sub-breakdowns.',
    'Unavailable means no measured boundary. Prepared is before submission; reference observed is not success.',
  ].join('\n');
}
