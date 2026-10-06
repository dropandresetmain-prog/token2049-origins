/** Deterministic offline key material is test-only and is never used to create a wallet or payment. */
import { describe, expect, it } from 'vitest';
import { AuxiliaryData, PrivateKey, Transaction, TransactionBody, TransactionWitnessSet } from '@evolution-sdk/evolution';
import { decodeCardanoTransaction } from '@x402/cardano';
import { FUNDING_METADATA_LABEL, fundingCommitment, readFundingCommitment } from '../../src/funding/cardano/binding.js';
import type { PaymentRequirements } from '@x402/core/types';
const entry: PaymentRequirements = { scheme: 'exact', network: 'cardano:preprod', asset: 'lovelace', amount: '2000000', payTo: 'test-only', maxTimeoutSeconds: 60,
  extra: { purchaseId: 'pur_TESTONLY', quoteId: 'quo_TESTONLY', quoteDigest: 'd'.repeat(64), expiresAt: '2026-10-06T00:10:00Z' } };
const resource = 'https://gateway.example.test/v1/purchases/pur_TESTONLY/fund';
const digest = fundingCommitment(resource, entry);
function fixture() {
  const aux = AuxiliaryData.conway({ metadata: new Map([[FUNDING_METADATA_LABEL, digest]]) });
  const body = new TransactionBody.TransactionBody({ inputs: [], outputs: [], fee: 0n, auxiliaryDataHash: AuxiliaryData.toHash(aux) });
  const key = PrivateKey.fromBytes(new Uint8Array(32).fill(1));
  const witness = new TransactionWitnessSet.VKeyWitness({ vkey: PrivateKey.toPublicKey(key), signature: PrivateKey.sign(key, TransactionBody.toHash(body).hash) });
  return new Transaction.Transaction({ body, auxiliaryData: aux, isValid: true, witnessSet: TransactionWitnessSet.fromVKeyWitnesses([witness]) });
}
const encode = (tx: Transaction.Transaction) => Buffer.from(Transaction.toCBORBytes(tx)).toString('base64');
describe('signed funding commitment', () => {
  it('round trips real CBOR with a valid body signature and committed metadata', () => {
    const tx = encode(fixture()); expect(readFundingCommitment(tx)).toBe(digest);
    expect(decodeCardanoTransaction(tx).signaturesValid).toBe(true);
  });
  it('rejects metadata substitution and makes a replaced auxiliary hash invalidate the original signature', () => {
    const original = fixture();
    const aux = AuxiliaryData.conway({ metadata: new Map([[FUNDING_METADATA_LABEL, 'f'.repeat(64)]]) });
    const substituted = new Transaction.Transaction({ ...original, auxiliaryData: aux });
    expect(readFundingCommitment(encode(substituted))).toBeNull();
    const changedBody = new TransactionBody.TransactionBody({ ...original.body, auxiliaryDataHash: AuxiliaryData.toHash(aux) });
    const forged = new Transaction.Transaction({ ...original, body: changedBody, auxiliaryData: aux });
    expect(decodeCardanoTransaction(encode(forged)).signaturesValid).toBe(false);
  });
  it.each(['purchaseId', 'quoteId', 'quoteDigest', 'expiresAt'])('changes when %s changes', key => {
    expect(fundingCommitment(resource, { ...entry, extra: { ...entry.extra, [key]: 'changed' } })).not.toBe(digest);
  });
  it.each(['network', 'asset', 'amount', 'payTo'])('changes when %s changes', key => {
    expect(fundingCommitment(resource, { ...entry, [key]: 'changed' })).not.toBe(digest);
  });
  it('changes when the resource changes', () => { expect(fundingCommitment(`${resource}changed`, entry)).not.toBe(digest); });
});
