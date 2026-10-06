import { z } from 'zod';
import type { PurchaseView } from './commerce.js';

export const HumanProgress = z.object({
  stage: z.enum(['confirming_payment', 'purchasing', 'verifying_result', 'complete', 'needs_attention']),
  label: z.string(), message: z.string(), paymentConfirmed: z.boolean(),
  merchantAction: z.enum(['not_started', 'in_progress', 'reported', 'unknown']),
  outcomeFinal: z.boolean(), nextAction: z.string().nullable(),
}).strict();
export type HumanProgress = z.infer<typeof HumanProgress>;
const completeCommerce = new Set(['paid', 'confirmed', 'ticketed']);
const paidMerchant = new Set(['paid', 'simulated_paid', 'test_balance_paid']);
export function projectProgress(p: PurchaseView): HumanProgress {
  const paymentConfirmed = ['confirmed', 'escrow_locked', 'released'].includes(p.paymentState);
  const merchantAction = p.commerceStatus === 'unknown' || p.state === 'unresolved' ? 'unknown' :
    p.commerceStatus !== 'not_started' ? 'reported' : p.state === 'executing' ? 'in_progress' : 'not_started';
  const base = { paymentConfirmed, merchantAction } as const;
  if (p.state === 'unresolved' || (p.state === 'succeeded' && (!completeCommerce.has(p.commerceStatus) || !paidMerchant.has(p.merchantPaymentStatus) || !p.receipt))) {
    return { ...base, stage: 'verifying_result', label: 'Verifying result',
      message: "We're verifying whether the merchant completed the purchase. No further action is needed right now.", outcomeFinal: false, nextAction: null };
  }
  switch (p.state) {
    case 'awaiting_funding': return { ...base, stage: 'confirming_payment', label: p.paymentState === 'not_received' ? 'Awaiting payment' : 'Confirming payment',
      message: p.paymentState === 'not_received' ? 'Nothing has been purchased yet. Confirm payment from the selected source.' : paymentConfirmed ? 'Payment confirmed. We are checking its application to this purchase. No further action is needed right now.' : 'Your payment is being checked. No further action is needed right now.',
      outcomeFinal: false, nextAction: p.paymentState === 'not_received' ? 'Pay using the selected funding option.' : null };
    case 'funded_queued': return { ...base, stage: 'purchasing', label: 'Purchase queued', message: `${paymentConfirmed ? 'Payment confirmed. ' : ''}Your purchase is queued for submission.`, outcomeFinal: false, nextAction: null };
    case 'executing': return { ...base, stage: 'purchasing', label: 'Purchasing', message: `${paymentConfirmed ? 'Payment confirmed. ' : ''}Your purchase is being submitted to the provider.`, outcomeFinal: false, nextAction: null };
    case 'succeeded': return { ...base, stage: 'complete', label: 'Complete', message: `Purchase complete.${p.providerReference ? ` Provider reference ${p.providerReference}.` : ''} Read the receipt for the environment and proof limitations.`, outcomeFinal: true, nextAction: null };
    case 'requires_reauthorization': return { ...base, stage: 'needs_attention', label: 'Terms changed', message: 'Terms changed before purchase. Nothing was bought; fresh approval is required.', outcomeFinal: true, nextAction: 'Request a fresh quote, select a funding option and approve the new terms.' };
    case 'expired': return { ...base, stage: 'needs_attention', label: 'Quote expired', message: 'The quote expired before this purchase could proceed.', outcomeFinal: true, nextAction: 'Request and approve a fresh quote. Check proof for any payment already received.' };
    case 'failed': return { ...base, stage: 'needs_attention', label: 'Purchase could not be completed', message: 'The purchase could not be completed. Check the proof for the payment and merchant result.', outcomeFinal: true, nextAction: 'Review the result with the gateway operator.' };
  }
}

export const FundingSource = z.object({
  sourceId: z.string().regex(/^src_[0-9a-f]{32}$/), rail: z.literal('cardano'), network: z.string().min(1).max(100),
  publicAddress: z.string().regex(/^addr_test1[0-9a-z]{10,200}$/),
  displayAddress: z.string().max(40), assetId: z.string().min(1).max(150),
  readiness: z.enum(['configured', 'unavailable']),
}).strict();
export type FundingSource = z.infer<typeof FundingSource>;
