import { afterEach, describe, expect, it } from 'vitest';
import { encodeCandidate } from '../../src/funding/sui/wire.js';
import { TESTNET_GENESIS } from '../../src/funding/sui/config.js';
import { makeSuiCandidate, suiClock, suiScenario, suiInput } from '../support/sui.js';

afterEach(() => suiClock.set('2026-10-08T00:00:00.000Z'));

describe('Sui Testnet funding adapter', () => {
  it('prepares and verifies an exact payer-signed USDC transfer, then recovers its digest after restart', async () => {
    const s = await suiScenario();
    expect(await s.adapter.prepare(s.candidate.header, s.input)).toMatchObject({
      ok: true, transferReference: s.candidate.digest,
      recoveryPayload: { header: s.candidate.header },
    });

    const result = await s.adapter.verify(s.candidate.header, s.input);
    expect(result).toMatchObject({
      ok: true,
      funding: {
        rail: 'sui', network: 'sui:testnet', assetId: s.input.amount.assetId,
        amountBaseUnits: '1000', payer: s.candidate.payer, payee: s.input.payTo,
        transferReference: s.candidate.digest, paymentState: 'confirmed',
        details: { checkpoint: '1', transactionDigest: s.candidate.digest, onChainPurchaseCommitment: false },
      },
    });
    expect(s.counts().executed).toBe(1);
    expect(s.counts().objectChecks).toBe(1);

    const restarted = s.restart();
    expect(await restarted.recover(s.candidate.digest, s.input)).toMatchObject({ ok: true, funding: { transferReference: s.candidate.digest } });
    expect(s.counts().executed).toBe(1);
  });

  it.each([
    ['network', (i: ReturnType<typeof suiInput>) => { i.amount.network = 'sui:mainnet'; }],
    ['recipient', (i: ReturnType<typeof suiInput>) => { i.payTo = '0x' + 'c'.repeat(64); }],
    ['amount', (i: ReturnType<typeof suiInput>) => { i.amount.amountBaseUnits = '1001'; }],
    ['quote', (i: ReturnType<typeof suiInput>) => { i.quoteDigest = 'different-quote'; }],
    ['asset', (i: ReturnType<typeof suiInput>) => { i.amount.assetId = '0x2::sui::SUI'; }],
    ['expiry', (i: ReturnType<typeof suiInput>) => { i.expiresAt = '2026-10-08T00:00:00.000Z'; }],
  ])('rejects a signed candidate when its requirement %s changes before any chain action', async (_name, mutate) => {
    const s = await suiScenario();
    const changed = structuredClone(s.input);
    mutate(changed);
    expect(await s.adapter.prepare(s.candidate.header, changed)).toMatchObject({ ok: false });
    expect(await s.adapter.verify(s.candidate.header, changed)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(s.counts().executed).toBe(0);
  });

  it.each(['transaction signature', 'application binding signature', 'digest'] as const)(
    'requires a valid %s', async mutation => {
      const s = await suiScenario();
      const candidate = { ...s.candidate.candidate };
      const alter = (signature: string) => signature.slice(0, 4) + (signature[4] === 'A' ? 'B' : 'A') + signature.slice(5);
      if (mutation === 'transaction signature') candidate.signature = alter(candidate.signature);
      if (mutation === 'application binding signature') candidate.bindingSignature = alter(candidate.bindingSignature);
      if (mutation === 'digest') candidate.digest = (candidate.digest[0] === '1' ? '2' : '1') + candidate.digest.slice(1);
      expect(await s.adapter.prepare(encodeCandidate(candidate), s.input)).toMatchObject({ ok: false });
      expect(await s.adapter.verify(encodeCandidate(candidate), s.input)).toMatchObject({ ok: false, settlementAttempted: false });
      expect(s.counts().executed).toBe(0);
    },
  );

  it.each(['amount', 'recipient'] as const)('rejects an independently signed transaction with a different %s', async mutation => {
    const s = await suiScenario({}, {}, mutation === 'amount' ? { amount: 999n } : { recipient: '0x' + 'c'.repeat(64) });
    expect(await s.adapter.prepare(s.candidate.header, s.input)).toMatchObject({ ok: false });
    expect(await s.adapter.verify(s.candidate.header, s.input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(s.counts().executed).toBe(0);
  });

  it.each([
    ['framework package', { package: '0x3' }],
    ['framework module', { module: 'clock' }],
    ['framework function', { function: 'timestamp_ms' }],
    ['withdrawal type', { typeArgument: '0x2::sui::SUI' }],
    ['sender-only source', { from: 'sponsor' as const }],
    ['reserved amount', { reservation: 999n }],
    ['destination', { recipient: '0x' + 'c'.repeat(64) }],
  ])('rejects an independently signed balance redemption with a different %s', async (_name, balance) => {
    const s = await suiScenario({}, {}, { commands: 'balance', validity: {}, balance });
    expect(await s.adapter.prepare(s.candidate.header, s.input)).toMatchObject({ ok: false });
    expect(await s.adapter.verify(s.candidate.header, s.input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(s.counts().executed).toBe(0);
  });

  it('accepts the exact sender USDC address-balance path with chain, epoch window and nonce', async () => {
    const s = await suiScenario({}, {}, { commands: 'balance', validity: { nonce: 23 } });
    const prepared = await s.adapter.prepare(s.candidate.header, s.input);
    expect(prepared).toMatchObject({ ok: true, recoveryPayload: { header: s.candidate.header } });
    const result = await s.adapter.verify(s.candidate.header, s.input);
    expect(result).toMatchObject({ ok: true, funding: { payer: s.candidate.payer, transferReference: s.candidate.digest } });
    expect(s.counts().executed).toBe(1);

    const { Transaction } = await import('@mysten/sui/transactions');
    const expiration = Transaction.from(s.candidate.bytes).getData().expiration?.ValidDuring;
    expect(expiration).toMatchObject({
      chain: TESTNET_GENESIS,
      maxTimestamp: null,
      nonce: 23,
    });
  });

  it.each([
    ['chain', { chain: '11111111111111111111111111111111' }],
    ['expiry', { expiryMs: Date.parse('2026-10-08T00:09:00.000Z') }],
  ])('rejects a balance redemption with a mismatched signed validity %s', async (_name, validity) => {
    const s = await suiScenario({}, {}, { commands: 'balance', validity });
    expect(await s.adapter.prepare(s.candidate.header, s.input)).toMatchObject({ ok: false });
    expect(await s.adapter.verify(s.candidate.header, s.input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(s.counts().executed).toBe(0);
  });

  it('rejects a transaction whose gas owner is not its signed sender', async () => {
    const s = await suiScenario({}, {}, { gasOwner: '0x' + 'c'.repeat(64) });
    expect(await s.adapter.prepare(s.candidate.header, s.input)).toMatchObject({ ok: false });
    expect(await s.adapter.verify(s.candidate.header, s.input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(s.counts().executed).toBe(0);
  });

  it('validates address-funded SUI gas using the same chain and expiry binding', async () => {
    const s = await suiScenario({}, {}, { gasAddressBalance: true, validity: { nonce: 31 } });
    expect(await s.adapter.prepare(s.candidate.header, s.input)).toMatchObject({ ok: true });
    expect(await s.adapter.verify(s.candidate.header, s.input)).toMatchObject({ ok: true });
    expect(s.counts().executed).toBe(1);
  });

  it.each(['move', 'extra-output'] as const)('rejects %s commands and outputs in the payment transaction', async commands => {
    const s = await suiScenario({}, {}, { commands });
    expect(await s.adapter.prepare(s.candidate.header, s.input)).toMatchObject({ ok: false });
    expect(await s.adapter.verify(s.candidate.header, s.input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(s.counts().executed).toBe(0);
  });

  it('checks Testnet identity and the configured Circle asset before submitting', async () => {
    const wrongNetwork = await suiScenario({}, { wrongGenesis: true });
    expect(await wrongNetwork.adapter.verify(wrongNetwork.candidate.header, wrongNetwork.input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(wrongNetwork.counts().executed).toBe(0);

    const wrongAsset = await suiScenario({}, { wrongAsset: true });
    expect(await wrongAsset.adapter.verify(wrongAsset.candidate.header, wrongAsset.input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(wrongAsset.counts().executed).toBe(0);
  });

  it('never confirms a failed transaction or mismatched USDC balance changes', async () => {
    const failed = await suiScenario({}, { missingTransaction: false, failedTransaction: true });
    expect(await failed.adapter.recover(failed.candidate.digest, failed.input)).toMatchObject({ ok: false, code: 'payment_invalid' });

    const wrongChange = await suiScenario({}, { missingTransaction: false, mutateBalanceChanges: true });
    expect(await wrongChange.adapter.recover(wrongChange.candidate.digest, wrongChange.input)).toMatchObject({ ok: false, code: 'payment_invalid' });
  });

  it.each([
    ['missing transaction', { missingTransaction: true }],
    ['missing checkpoint', { missingTransaction: false, missingCheckpoint: true }],
    ['missing timestamp', { missingTransaction: false, omitTimestamp: true }],
    ['read timeout', { missingTransaction: false, throwTransaction: true }],
  ] as const)('retains the candidate when finalized evidence is %s', async (_case, options) => {
    const s = await suiScenario({}, options);
    expect(await s.adapter.recover(s.candidate.digest, s.input)).toMatchObject({ ok: false, code: 'payment_required', settlementAttempted: true });
    expect(s.counts().executed).toBe(0);
  });

  it('rechecks expiry after the asynchronous read and refuses to submit once expired', async () => {
    const s = await suiScenario({}, { advanceClockOnReadMs: 10 * 60 * 1000 });
    expect(await s.adapter.verify(s.candidate.header, s.input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(s.counts().executed).toBe(0);
  });

  it('recovers a previously executed payment after expiry without submitting again', async () => {
    const s = await suiScenario();
    expect((await s.adapter.verify(s.candidate.header, s.input)).ok).toBe(true);
    suiClock.set('2026-10-08T01:00:00.000Z');
    const result = await s.restart().recover(s.candidate.digest, s.input);
    expect(result).toMatchObject({ ok: true, funding: { paymentState: 'confirmed', transferReference: s.candidate.digest } });
    expect(s.counts().executed).toBe(1);
  });

  it('prepares an exact durable candidate and resumes it after restart only when the digest matches', async () => {
    const s = await suiScenario();
    const prepared = await s.adapter.prepare(s.candidate.header, s.input);
    expect(prepared).toMatchObject({ ok: true, transferReference: s.candidate.digest, recoveryPayload: { header: s.candidate.header } });
    const payload = (prepared as { recoveryPayload: Record<string, unknown> }).recoveryPayload;
    const result = await s.restart().resume!(s.candidate.digest, s.input, payload);
    expect(result).toMatchObject({ ok: true, funding: { transferReference: s.candidate.digest } });
    expect(s.counts().executed).toBe(1);

    const other = await makeSuiCandidate(s.input);
    expect(await s.restart().resume!(s.candidate.digest, s.input, { header: other.header })).toMatchObject({ ok: false });
    expect(s.counts().executed).toBe(1);
  });

  it.each([
    ['missing payload', {}],
    ['wrong payload shape', { header: 123 }],
    ['additional payload fields', { header: 'unused', extra: true }],
  ])('rejects %s without submitting a replacement candidate', async (_name, payload) => {
    const s = await suiScenario();
    expect(await s.adapter.resume!(s.candidate.digest, s.input, payload)).toMatchObject({ ok: false });
    expect(s.counts().executed).toBe(0);
  });

  it.each([
    ['already present without checkpoint', { missingTransaction: false, missingCheckpoint: true }],
    ['transaction read timeout', { missingTransaction: false, throwTransaction: true }],
  ] as const)('does not resubmit a retained transaction during resume when it is %s', async (_name, options) => {
    const s = await suiScenario({}, options);
    const prepared = await s.adapter.prepare(s.candidate.header, s.input);
    const payload = (prepared as { recoveryPayload: Record<string, unknown> }).recoveryPayload;
    expect(await s.restart().resume!(s.candidate.digest, s.input, payload)).toMatchObject({ ok: false, settlementAttempted: true });
    expect(s.counts().executed).toBe(0);
  });

  it('does not submit an absent candidate during resume after its requirement expires', async () => {
    const s = await suiScenario();
    const prepared = await s.adapter.prepare(s.candidate.header, s.input);
    const payload = (prepared as { recoveryPayload: Record<string, unknown> }).recoveryPayload;
    suiClock.set(s.input.expiresAt);
    expect(await s.restart().resume!(s.candidate.digest, s.input, payload)).toMatchObject({ ok: false, settlementAttempted: true });
    expect(s.counts().executed).toBe(0);
  });

  it('keeps recover read-only when no finalized transaction is available', async () => {
    const s = await suiScenario();
    expect(await s.adapter.recover!(s.candidate.digest, s.input)).toMatchObject({ ok: false, settlementAttempted: true });
    expect(s.counts().executed).toBe(0);
  });

  it('keeps an ambiguous execute timeout recoverable under the same digest', async () => {
    const s = await suiScenario({}, { throwExecute: true });
    expect(await s.adapter.verify(s.candidate.header, s.input)).toMatchObject({ ok: false, code: 'payment_required', settlementAttempted: true });
    expect(s.counts().executed).toBe(1);
    s.setOptions({ throwExecute: false, missingTransaction: false });
    expect(await s.restart().recover(s.candidate.digest, s.input)).toMatchObject({ ok: true });
    expect(s.counts().executed).toBe(1);
  });

  it('reports readiness only when Testnet identity and Circle metadata checks pass', async () => {
    const ready = await suiScenario();
    expect(await ready.adapter.readiness()).toMatchObject({ status: 'EXTERNAL_CHECK_PASSED', environment: 'sui-testnet' });

    const blocked = await suiScenario({}, { wrongGenesis: true });
    expect(await blocked.adapter.readiness()).toMatchObject({ status: 'ACCESS_BLOCKED' });

    const disabled = (await import('../../src/funding/sui/adapter.js')).createSuiFundingAdapter({});
    expect(disabled.acceptedAsset()).toBeNull();
    expect(await disabled.readiness()).toMatchObject({ status: 'MISSING_CONFIG' });
  });
});
