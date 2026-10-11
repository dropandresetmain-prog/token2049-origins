import { describe, expect, it } from 'vitest';
import { projectProgress, completionReference } from '../../src/contracts/presentation.js';
import type { PurchaseView } from '../../src/contracts/commerce.js';

const purchase = (category: PurchaseView['category'], commerceStatus: PurchaseView['commerceStatus']): PurchaseView => ({
  category, commerceStatus, state: 'succeeded', paymentState: 'confirmed', merchantPaymentStatus: 'test_balance_paid',
  providerReference: 'REFERENCE-123', receipt: { receiptId: 'receipt-123', providerReference: 'RECEIPT-REF' },
} as PurchaseView);

describe('durable successful presentation', () => {
  it.each([
    ['retail', 'paid', 'Order confirmed', 'Order reference'],
    ['hotel', 'confirmed', 'Booking confirmed', 'Booking reference'],
    ['flight', 'ticketed', 'Ticket issued', 'Flight reference'],
  ] as const)('%s reports the verified commerce outcome', (category, commerceStatus, label, refLabel) => {
    const p = purchase(category, commerceStatus);
    expect(projectProgress(p)).toMatchObject({ label, stage: 'complete', outcomeFinal: true });
    expect(projectProgress(p).message).toContain(`${refLabel}: REFERENCE-123`);
    expect(completionReference(p)).toEqual({ label: refLabel, value: 'REFERENCE-123' });
  });

  it('uses the receipt reference when the purchase reference is absent, then the receipt number', () => {
    const p = purchase('flight', 'ticketed'); p.providerReference = null;
    expect(completionReference(p)).toEqual({ label: 'Flight reference', value: 'RECEIPT-REF' });
    p.receipt!.providerReference = null;
    expect(completionReference(p)).toEqual({ label: 'Receipt number', value: 'receipt-123' });
  });

  it.each(['held', 'ticketing', 'payment_pending', 'unknown', 'not_started'] as const)('never claims issuance for %s', commerceStatus => {
    expect(projectProgress(purchase('flight', commerceStatus))).toMatchObject({ stage: 'verifying_result', outcomeFinal: false });
  });
  it('preserves all success gates and does not guess from category alone', () => {
    const p = purchase('retail', 'paid');
    for (const patch of [{ state: 'unresolved' }, { merchantPaymentStatus: 'pending' }, { receipt: null }] as const) {
      expect(projectProgress({ ...p, ...patch })).toMatchObject({ stage: 'verifying_result', outcomeFinal: false });
    }
    expect(projectProgress(purchase('flight', 'confirmed')).label).toBe('Purchase confirmed');
    expect(projectProgress(purchase('hotel', 'paid')).label).toBe('Purchase confirmed');
  });

  // A mislabeled rejection leaves a historical failed handoff on the view, but independent recovery confirmed
  // the same digest and the merchant completed. paymentAttempt is a channel diagnostic; canonical state wins.
  const staleFailedHandoff = {
    attemptId: 'pat_01ARBITRARY00', status: 'failed', retrySafe: false,
    errorCode: 'payment_rejected', updatedAt: '2026-10-11T15:20:16.656Z',
  } as const;

  it('never lets a stale failed handoff override a canonical completed purchase', () => {
    const p = { ...purchase('flight', 'ticketed'), paymentAttempt: staleFailedHandoff };
    expect(projectProgress(p)).toMatchObject({ stage: 'complete', label: 'Ticket issued', outcomeFinal: true, paymentConfirmed: true });
    expect(projectProgress(p).stage).not.toBe('needs_attention');
  });

  it('reports confirmation pending (not a failed handoff) while an unknown payment is still being checked', () => {
    const p = { ...purchase('flight', 'not_started'), state: 'awaiting_funding', paymentState: 'unknown', paymentAttempt: staleFailedHandoff } as unknown as PurchaseView;
    const progress = projectProgress(p);
    expect(progress).toMatchObject({ stage: 'confirming_payment', outcomeFinal: false, paymentConfirmed: false });
    expect(progress.label).not.toBe('Payment handoff failed');
    expect(progress.message).toContain('being checked');
    expect(progress.nextAction).toBeNull();
  });
});
