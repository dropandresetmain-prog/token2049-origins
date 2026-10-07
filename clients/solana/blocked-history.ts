import { createHash, createPublicKey, verify } from 'node:crypto';
import { z } from 'zod';
import { address, getAddressEncoder, getBase58Decoder, getCompiledTransactionMessageDecoder, decompileTransactionMessage } from '@solana/kit';
import { decodeTransactionFromPayload } from '@x402/svm';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import type { SolanaImportInput } from './ledger-import.js';
import type { SolanaLedgerEntry } from './ledger.js';

export const HistoricalBlockPolicy = z.object({
  version: z.literal(1),
  mode: z.literal('historical_unresolved_permanently_blocked'),
  payerSourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  sponsorSourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  purchaseIds: z.array(z.string().regex(/^pur_[A-Za-z0-9]{10,40}$/)).min(1),
}).strict();
export type HistoricalBlockPolicy = z.infer<typeof HistoricalBlockPolicy>;
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');

/** Offline evidence is a replay prohibition, never a claim about submission or chain finality. */
export function blockedHistoryEvidence(policyInput: HistoricalBlockPolicy, inputs: [SolanaImportInput, SolanaImportInput], rows: SolanaLedgerEntry[][]) {
  const policy = HistoricalBlockPolicy.parse(policyInput);
  if (policy.payerSourceSha256 !== inputs[0].expectedSha256 || policy.sponsorSourceSha256 !== inputs[1].expectedSha256 || new Set(policy.purchaseIds).size !== policy.purchaseIds.length) throw new Error('historical block policy source or ID conflict');
  const incomplete = rows.flatMap((entries, index) => entries.filter(e => !e.id.startsWith('history:') && (!e.signature || !e.header)).map(entry => ({ index, entry })));
  if (incomplete.length !== policy.purchaseIds.length || incomplete.some(({ index, entry }) => index !== 0 || !policy.purchaseIds.includes(entry.id))) throw new Error('historical block policy must cover exactly all unresolved source attempts');
  return policy.purchaseIds.map(id => {
    const entry = rows[0]!.find(e => e.id === id);
    if (!entry?.header || entry.signature) throw new Error('historical candidate state differs from approved policy');
    const payload = decodePaymentSignatureHeader(entry.header);
    const transaction = decodeTransactionFromPayload(payload.payload as { transaction: string });
    const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    const decompiled = decompileTransactionMessage(message);
    const payer = address(inputs[0].owner), sponsor = address(inputs[1].owner);
    const payerSig = transaction.signatures[payer], sponsorSig = transaction.signatures[sponsor];
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(getAddressEncoder().encode(payer))]), format: 'der', type: 'spki' });
    const messageSha256 = hash(Buffer.from(transaction.messageBytes));
    const funding = payload.accepted.extra?.funding as { purchaseId?: unknown } | undefined;
    if (funding?.purchaseId !== id || payload.accepted.amount !== entry.amount || message.staticAccounts[0] !== sponsor || message.header.numSignerAccounts !== 2 || !payerSig || !verify(null, Buffer.from(transaction.messageBytes), key, Buffer.from(payerSig)) || (sponsorSig && sponsorSig.some(x => x !== 0)) || rows[1]!.some(e => e.id === messageSha256)) throw new Error('historical payer/sponsor evidence mismatch');
    const raw = (payload.payload as { transaction: string }).transaction;
    return {
      purchaseId: id, messageSha256, candidateSha256: hash(raw), payerSignature: getBase58Decoder().decode(payerSig),
      evidence: JSON.stringify({ classification: 'historical_unresolved', replayPolicy: 'permanently_blocked', chainEvidence: null,
        reason: 'Operator chose permanent replay prohibition while chain reconciliation was unavailable; exposure remains committed.',
        originalEntry: entry, payerSourceSha256: policy.payerSourceSha256, sponsorSourceSha256: policy.sponsorSourceSha256,
        payerSignatureValid: true, sponsorSignaturePresent: false, matchingSponsorReservations: 0,
        recentBlockhash: message.lifetimeToken, memo: Buffer.from(decompiled.instructions.at(-1)!.data!).toString('utf8') }),
    };
  });
}
