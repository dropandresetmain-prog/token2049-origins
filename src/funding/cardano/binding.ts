/** Public transaction metadata contains only a digest, never buyer fulfillment or credentials. */
import { createHash } from 'node:crypto';
import { AuxiliaryData, Transaction } from '@evolution-sdk/evolution';
import type { PaymentRequirements } from '@x402/core/types';
export const FUNDING_METADATA_LABEL = 2049n;

export function fundingCommitment(resourceUrl: string, entry: PaymentRequirements): string {
  const extra = entry.extra ?? {};
  return createHash('sha256').update(JSON.stringify([
    'commerce-funding-v1', resourceUrl, extra.purchaseId, extra.quoteId, extra.quoteDigest,
    extra.expiresAt, entry.network, entry.asset, entry.amount, entry.payTo,
    ...(extra.settlement ? [extra.settlement, extra.chainDecimals] : []),
  ])).digest('hex');
}

/** The body's auxiliary hash is signed. Refuse metadata detached from that signed hash. */
export function readFundingCommitment(transactionBase64: string): string | null {
  const tx = Transaction.fromCBORBytes(Buffer.from(transactionBase64, 'base64'));
  const aux = tx.auxiliaryData;
  if (!aux || !tx.body.auxiliaryDataHash) return null;
  const actual = Buffer.from(AuxiliaryData.toHash(aux).bytes).toString('hex');
  if (actual !== Buffer.from(tx.body.auxiliaryDataHash.bytes).toString('hex')) return null;
  const value = aux.metadata?.get(FUNDING_METADATA_LABEL);
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : null;
}
