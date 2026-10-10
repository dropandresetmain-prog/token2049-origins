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

/** Category alone cannot prove ticket issuance or a confirmed booking. */
function successLabel(p: PurchaseView): string {
  if (p.category === 'retail' && ['paid', 'confirmed'].includes(p.commerceStatus)) return 'Order confirmed';
  if (p.category === 'hotel' && p.commerceStatus === 'confirmed') return 'Booking confirmed';
  if (p.category === 'flight' && p.commerceStatus === 'ticketed') return 'Ticket issued';
  return 'Purchase confirmed';
}

/** Provider references are opaque: a flight order number must not be described as a PNR. */
export function completionReference(p: PurchaseView): { label: string; value: string } | null {
  const reference = p.providerReference || p.receipt?.providerReference;
  if (reference) return {
    label: p.category === 'retail' ? 'Order reference' : p.category === 'hotel' ? 'Booking reference' : p.category === 'flight' ? 'Flight reference' : 'Confirmation reference',
    value: reference,
  };
  return p.receipt?.receiptId ? { label: 'Receipt number', value: p.receipt.receiptId } : null;
}
export function projectProgress(p: PurchaseView): HumanProgress {
  const paymentConfirmed = ['confirmed', 'escrow_locked', 'released'].includes(p.paymentState);
  const merchantAction = p.commerceStatus === 'unknown' || p.state === 'unresolved' ? 'unknown' :
    p.commerceStatus !== 'not_started' ? 'reported' : p.state === 'executing' ? 'in_progress' : 'not_started';
  const base = { paymentConfirmed, merchantAction } as const;
  if (p.operatorAttention) return { ...base, stage: 'needs_attention', label: 'Operator review required',
    message: 'Automatic recovery needs operator review. Follow this purchase; do not submit another payment or order.', outcomeFinal: false, nextAction: 'Ask the operator to reconcile this purchase.' };
  if (p.state === 'awaiting_funding' && p.paymentState === 'not_received' && p.paymentAttempt) {
    const attempt = p.paymentAttempt;
    if (attempt.status === 'failed') return { ...base, stage: 'needs_attention', label: 'Payment handoff failed',
      message: `No purchase has been made yet. Payment handoff failed (${attempt.errorCode ?? 'payer_error'}). ${attempt.retrySafe ? 'The payer confirmed nothing was signed or submitted; retry the same approved purchase once the cause is resolved.' : 'The payment outcome requires reconciliation; do not submit another payment.'}`,
      outcomeFinal: false, nextAction: attempt.retrySafe ? 'Retry buy with the same quote and approval after resolving the failure.' : 'Ask the operator to reconcile the existing payment attempt.' };
    const overdue = attempt.reviewRequired === true;
    return { ...base, stage: overdue ? 'needs_attention' : 'confirming_payment', label: overdue ? 'Payment handoff needs review' : 'Payment handoff pending',
      message: overdue ? 'The payment handoff has not reported an outcome. Ask the operator to reconcile it; do not pay again.' : 'The payer handoff is pending. Follow this purchase; do not pay again.',
      outcomeFinal: false, nextAction: overdue ? 'Ask the operator to reconcile the payment handoff.' : 'Call get_purchase again in about 20 seconds.' };
  }
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
    case 'succeeded': {
      const label = successLabel(p);
      const reference = completionReference(p);
      return { ...base, stage: 'complete', label,
        message: `${label}.${reference ? ` ${reference.label}: ${reference.value}.` : ''} View the receipt for purchase details.`,
        outcomeFinal: true, nextAction: null };
    }
    case 'requires_reauthorization': return { ...base, stage: 'needs_attention', label: 'Terms changed', message: 'Terms changed before purchase. Nothing was bought; fresh approval is required.', outcomeFinal: true, nextAction: 'Request a fresh quote, select a funding option and approve the new terms.' };
    case 'expired': return { ...base, stage: 'needs_attention', label: 'Quote expired', message: 'The quote expired before this purchase could proceed.', outcomeFinal: true, nextAction: 'Request and approve a fresh quote. Check proof for any payment already received.' };
    case 'failed': return { ...base, stage: 'needs_attention', label: 'Purchase could not be completed', message: 'The purchase could not be completed. Check the proof for the payment and merchant result.', outcomeFinal: true, nextAction: 'Review the result with the gateway operator.' };
  }
}

/**
 * Connected payer identity, a closed union per rail. Addresses and networks are validated per rail so a
 * Cardano, Solana and Sui addresses cannot be presented as belonging to another rail. Masumi is deliberately absent: Masumi
 * task remuneration is never a connected purchase-principal payer.
 * The Solana literals mirror src/funding/solana/wire.ts (NETWORK / TEST_MINT); a unit test pins them.
 */
export const SOLANA_DEVNET_NETWORK = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' as const;
export const SOLANA_DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' as const;
export const SUI_TESTNET_NETWORK = 'sui:testnet' as const;
// Circle's canonical native USDC package and type on Sui testnet.
export const SUI_TESTNET_USDC_TYPE = '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC' as const;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const SUI_ADDRESS = /^0x[0-9a-f]{64}$/i;
const sourceBase = {
  sourceId: z.string().regex(/^src_[0-9a-f]{32}$/),
  displayAddress: z.string().max(40),
  readiness: z.enum(['configured', 'unavailable']),
};
export const CardanoFundingSource = z.object({
  ...sourceBase, rail: z.literal('cardano'), network: z.literal('cardano:preprod'),
  publicAddress: z.string().regex(/^addr_test1[0-9a-z]{10,200}$/),
  assetId: z.string().min(1).max(150),
}).strict();
export const SolanaFundingSource = z.object({
  ...sourceBase, rail: z.literal('solana'), network: z.literal(SOLANA_DEVNET_NETWORK),
  publicAddress: z.string().regex(SOLANA_ADDRESS),
  assetId: z.literal(SOLANA_DEVNET_USDC_MINT),
}).strict();
export const SuiFundingSource = z.object({
  ...sourceBase, rail: z.literal('sui'), network: z.literal(SUI_TESTNET_NETWORK),
  publicAddress: z.string().regex(SUI_ADDRESS),
  assetId: z.literal(SUI_TESTNET_USDC_TYPE),
}).strict();
export const FundingSource = z.discriminatedUnion('rail', [CardanoFundingSource, SolanaFundingSource, SuiFundingSource]);
export type FundingSource = z.infer<typeof FundingSource>;

/** Stable mask shown to humans: first 14 and last 6 characters of a public address. */
export function maskAddress(address: string): string {
  return `${address.slice(0, 14)}…${address.slice(-6)}`;
}
