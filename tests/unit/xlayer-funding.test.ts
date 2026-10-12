import { afterEach, describe, expect, it } from 'vitest';
import type { Hex } from 'viem';
import { createXLayerFundingAdapter } from '../../src/funding/xlayer/adapter.js';
import { CHAIN_ID, NETWORK, TOKEN } from '../../src/funding/xlayer/config.js';
import { encodeCandidate } from '../../src/funding/xlayer/wire.js';
import {
  FakeXLayerRpc, OTHER_ADDRESS, OTHER_TOKEN, XLAYER_PAYEE, makeXLayerCandidate, transferLog, xlayerClock, xlayerEnv, xlayerInput, xlayerScenario,
  type CandidateOptions,
} from '../support/xlayer.js';

afterEach(() => xlayerClock.set('2026-10-08T00:00:00.000Z'));

const payloadOf = (prepared: unknown) => (prepared as { recoveryPayload: Record<string, unknown> }).recoveryPayload;
const EXPIRY = '2026-10-08T00:10:00.000Z';

describe('X Layer readiness and configuration', () => {
  it('reports EXTERNAL_CHECK_PASSED only after chain id and USD₮0 metadata checks', async () => {
    const s = await xlayerScenario();
    expect(await s.adapter.readiness()).toMatchObject({ status: 'EXTERNAL_CHECK_PASSED', component: 'xlayer', environment: 'xlayer-testnet', missing: [] });
    expect(s.rpc.count('assertNetwork')).toBe(1);
    expect(s.rpc.count('assertAsset')).toBe(1);
    expect(s.adapter.acceptedAsset()).toMatchObject({ assetId: TOKEN, decimals: 6, payTo: XLAYER_PAYEE, supportsUsdNotional: true });
    expect(s.adapter).toMatchObject({ rail: 'xlayer', network: NETWORK, paymentHeaderName: 'xlayer-payment' });
  });

  it.each([
    ['chain id', (r: FakeXLayerRpc) => { r.chainId = 196; }],
    ['symbol', (r: FakeXLayerRpc) => { r.symbol = 'USDT'; }],
    ['decimals', (r: FakeXLayerRpc) => { r.decimals = 18; }],
    ['missing contract code', (r: FakeXLayerRpc) => { r.tokenHasCode = false; }],
    ['unreachable node', (r: FakeXLayerRpc) => { r.fail('assertNetwork'); }],
  ])('is ACCESS_BLOCKED when %s fails independent verification', async (_name, mutate) => {
    const s = await xlayerScenario();
    mutate(s.rpc);
    expect(await s.adapter.readiness()).toMatchObject({ status: 'ACCESS_BLOCKED' });
  });

  it('is MISSING_CONFIG and exposes no asset when unconfigured', async () => {
    const adapter = createXLayerFundingAdapter({}, { clock: xlayerClock, rpc: new FakeXLayerRpc() });
    expect(adapter.acceptedAsset()).toBeNull();
    expect(await adapter.readiness()).toMatchObject({ status: 'MISSING_CONFIG' });
    expect(() => adapter.paymentRequirements(xlayerInput())).toThrow(/unavailable/);
    expect(await adapter.verify('x', xlayerInput())).toMatchObject({ ok: false, code: 'payment_invalid', settlementAttempted: false });
  });

  it.each([
    ['non-allowlisted RPC URL', { XLAYER_RPC_URL: 'https://rpc.example.com' }, 'XLAYER_RPC_URL'],
    ['mainnet RPC URL', { XLAYER_RPC_URL: 'https://rpc.xlayer.tech' }, 'XLAYER_RPC_URL'],
    ['wrong token', { XLAYER_TOKEN_ADDRESS: OTHER_TOKEN }, 'XLAYER_TOKEN_ADDRESS'],
    ['wrong chain id', { XLAYER_CHAIN_ID: '196' }, 'XLAYER_CHAIN_ID'],
    ['wrong network label', { XLAYER_NETWORK: 'eip155:196' }, 'XLAYER_NETWORK'],
    ['wrong decimals', { XLAYER_ASSET_DECIMALS: '18' }, 'XLAYER_ASSET_DECIMALS'],
    ['zero-address treasury', { XLAYER_TREASURY_ADDRESS: '0x' + '0'.repeat(40) }, 'XLAYER_TREASURY_ADDRESS'],
    ['malformed treasury', { XLAYER_TREASURY_ADDRESS: '0x1234' }, 'XLAYER_TREASURY_ADDRESS'],
    ['max payment over the 5,100,000 ceiling', { XLAYER_MAX_PAYMENT_BASE_UNITS: '5100001' }, 'XLAYER_MAX_PAYMENT_BASE_UNITS'],
    ['max gas over the 0.01 OKB ceiling', { XLAYER_MAX_GAS_BUDGET_WEI: (10n ** 16n + 1n).toString() }, 'XLAYER_MAX_GAS_BUDGET_WEI'],
    ['zero confirmations', { XLAYER_CONFIRMATIONS: '0' }, 'XLAYER_CONFIRMATIONS'],
    ['too many confirmations', { XLAYER_CONFIRMATIONS: '21' }, 'XLAYER_CONFIRMATIONS'],
  ])('rejects configuration with %s', async (_name, change, key) => {
    const adapter = createXLayerFundingAdapter({ ...xlayerEnv, ...change }, { clock: xlayerClock, rpc: new FakeXLayerRpc() });
    expect(adapter.acceptedAsset()).toBeNull();
    expect(await adapter.readiness()).toMatchObject({ status: 'MISSING_CONFIG', missing: [key] });
  });

  it('accepts the exact ceilings and the second official RPC endpoint', () => {
    const adapter = createXLayerFundingAdapter({ ...xlayerEnv, XLAYER_RPC_URL: 'https://xlayertestrpc.okx.com/terigon',
      XLAYER_MAX_PAYMENT_BASE_UNITS: '5100000', XLAYER_MAX_GAS_BUDGET_WEI: (10n ** 16n).toString(), XLAYER_CONFIRMATIONS: '20',
      XLAYER_TOKEN_ADDRESS: TOKEN.toUpperCase().replace('0X', '0x') }, { clock: xlayerClock, rpc: new FakeXLayerRpc() });
    expect(adapter.acceptedAsset()).not.toBeNull();
  });
});

describe('X Layer payment requirements', () => {
  it('publishes the exact requirement without the private expectedPayer', async () => {
    const s = await xlayerScenario();
    const req = s.adapter.paymentRequirements({ ...s.input, expectedPayer: s.candidate.payer }) as Record<string, any>;
    expect(req).toMatchObject({ protocol: 'xlayer-usdt0-transfer', version: 1, paymentHeader: 'xlayer-payment',
      maxGasBudgetWei: '1000000000000000', binding: 'payer_signed_application_candidate', onChainPurchaseCommitment: false });
    expect(req.requirement).toEqual(s.input);
    expect(JSON.stringify(req)).not.toContain('expectedPayer');
    expect(JSON.stringify(req)).not.toContain(s.candidate.payer);
  });

  it.each([
    ['wrong recipient', { payTo: OTHER_ADDRESS }],
    ['amount over policy max', { amount: { network: NETWORK, assetId: TOKEN, decimals: 6, amountBaseUnits: '10001' } }],
    ['zero amount', { amount: { network: NETWORK, assetId: TOKEN, decimals: 6, amountBaseUnits: '0' } }],
    ['wrong asset', { amount: { network: NETWORK, assetId: OTHER_TOKEN, decimals: 6, amountBaseUnits: '1000' } }],
    ['wrong network', { amount: { network: 'eip155:196', assetId: TOKEN, decimals: 6, amountBaseUnits: '1000' } }],
    ['wrong decimals', { amount: { network: NETWORK, assetId: TOKEN, decimals: 18, amountBaseUnits: '1000' } }],
    ['expired requirement', { expiresAt: '2026-10-08T00:00:00.000Z' }],
    ['unparseable expiry', { expiresAt: 'tomorrow' }],
  ])('refuses to publish a requirement with %s', async (_name, change) => {
    const s = await xlayerScenario();
    expect(() => s.adapter.paymentRequirements(xlayerInput(change as never))).toThrow();
  });
});

const CORRUPTIONS: Array<[string, CandidateOptions]> = [
  ['wrong chain id', { chainId: 196 }],
  ['wrong token contract', { to: OTHER_TOKEN }],
  ['wrong recipient', { recipient: OTHER_ADDRESS }],
  ['wrong amount', { amount: 999n }],
  ['nonzero native value', { value: 1n }],
  ['non-empty access list', { accessList: [{ address: OTHER_ADDRESS as Hex, storageKeys: [] }] }],
  ['legacy transaction type', { txType: 'legacy' }],
  ['type-2930 transaction', { txType: 'eip2930' }],
  ['type-7702 transaction', { txType: 'eip7702' }],
  ['gas budget above the configured maximum', { gas: 2_000_000n }],
  ['binding signed by a different key', { bindingSigner: 'other' }],
  ['declared hash differing from the raw transaction', { hashMismatch: true }],
  ['payer equal to the recipient', { payerIsRecipient: true }],
];

describe('X Layer candidate preparation', () => {
  it('prepares an exact, really-signed candidate and keeps it as the durable recovery payload', async () => {
    const s = await xlayerScenario();
    expect(await s.adapter.prepare(s.c.header, s.input)).toEqual({ ok: true, transferReference: s.c.hash, recoveryPayload: { header: s.c.header } });
    expect(s.rpc.sent).toEqual([]);
    expect(s.c.hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it.each(CORRUPTIONS)('rejects a candidate with %s before any chain action', async (_name, options) => {
    const s = await xlayerScenario({}, options);
    expect(await s.adapter.prepare(s.c.header, s.input)).toMatchObject({ ok: false, code: 'payment_invalid', settlementAttempted: false });
    expect(await s.adapter.verify(s.c.header, s.input)).toMatchObject({ ok: false, code: 'payment_invalid', settlementAttempted: false });
    expect(s.rpc.sent).toEqual([]);
    expect(s.rpc.count('assertNetwork')).toBe(0);
  });

  it.each([
    ['network', (i: ReturnType<typeof xlayerInput>) => { i.amount.network = 'eip155:196'; }],
    ['recipient', (i: ReturnType<typeof xlayerInput>) => { i.payTo = OTHER_ADDRESS; }],
    ['amount', (i: ReturnType<typeof xlayerInput>) => { i.amount.amountBaseUnits = '1001'; }],
    ['quote digest', (i: ReturnType<typeof xlayerInput>) => { i.quoteDigest = 'different-quote'; }],
    ['purchase id', (i: ReturnType<typeof xlayerInput>) => { i.purchaseId = 'pur_0987654321'; }],
    ['resource url', (i: ReturnType<typeof xlayerInput>) => { i.resourceUrl = 'http://127.0.0.1:8787/v1/purchases/pur_other/fund'; }],
    ['expiry', (i: ReturnType<typeof xlayerInput>) => { i.expiresAt = '2026-10-08T00:11:00.000Z'; }],
  ])('rejects a signed candidate when its requirement %s changes (binding signature covers it)', async (_name, mutate) => {
    const s = await xlayerScenario();
    const changed = structuredClone(s.input);
    mutate(changed);
    expect(await s.adapter.prepare(s.c.header, changed)).toMatchObject({ ok: false });
    expect(await s.adapter.verify(s.c.header, changed)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(s.rpc.sent).toEqual([]);
  });

  it.each([
    ['transaction signature', (c: any) => ({ ...c, rawTransaction: c.rawTransaction.slice(0, -4) + (c.rawTransaction.endsWith('0000') ? '1111' : '0000') })],
    ['binding signature', (c: any) => ({ ...c, bindingSignature: c.bindingSignature.slice(0, 10) + (c.bindingSignature[10] === 'a' ? 'b' : 'a') + c.bindingSignature.slice(11) })],
  ])('requires an intact %s', async (_name, alter) => {
    const s = await xlayerScenario();
    const header = encodeCandidate(alter(s.c.candidate));
    expect(await s.adapter.prepare(header, s.input)).toMatchObject({ ok: false });
    expect(await s.adapter.verify(header, s.input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(s.rpc.sent).toEqual([]);
  });

  it.each([
    ['not base64', '!!!not-base64!!!'],
    ['non-canonical base64', 'e30'],
    ['oversized', 'A'.repeat(12004)],
    ['empty candidate', Buffer.from('{}').toString('base64')],
    ['unknown extra field', Buffer.from(JSON.stringify({ extra: 1 })).toString('base64')],
  ])('rejects a malformed header: %s', async (_name, header) => {
    const s = await xlayerScenario();
    expect(await s.adapter.prepare(header, s.input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(await s.adapter.verify(header, s.input)).toMatchObject({ ok: false, settlementAttempted: false });
  });

  it('rejects a candidate from a payer other than the approved wallet', async () => {
    const s = await xlayerScenario();
    const input = { ...s.input, expectedPayer: OTHER_ADDRESS };
    expect(await s.adapter.prepare(s.c.header, input)).toMatchObject({ ok: false, reason: 'payer differs from approved wallet' });
    expect(await s.adapter.verify(s.c.header, input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(s.rpc.sent).toEqual([]);
    // The approved wallet itself (any address case) is accepted.
    const approved = { ...s.input, expectedPayer: s.c.account.address };
    expect(await s.adapter.prepare(s.c.header, approved)).toMatchObject({ ok: true });
  });
});

describe('X Layer verification and submission', () => {
  it('submits exactly one broadcast and verifies the confirmed exact USD₮0 Transfer', async () => {
    const s = await xlayerScenario();
    const result = await s.adapter.verify(s.c.header, s.input);
    expect(result).toMatchObject({ ok: true, funding: {
      rail: 'xlayer', network: NETWORK, assetId: TOKEN, decimals: 6, amountBaseUnits: '1000', payer: s.c.payer, payee: XLAYER_PAYEE,
      transferReference: s.c.hash, paymentState: 'confirmed', confirmations: 2, purpose: 'purchase_principal', evidenceMode: 'fresh_external',
      details: { chainId: CHAIN_ID, tokenContract: TOKEN, txHash: s.c.hash, blockHeight: '1001', logIndex: 0, quoteDigest: 'quote-digest',
        onChainPurchaseCommitment: false, onChainQuoteExpiry: false, quoteExpiryEnforcement: 'application', receivedAfterExpiry: false },
    } });
    expect(s.rpc.sent).toEqual([s.c.raw]); // the exact signed bytes, once
    expect(s.rpc.count('sendRaw')).toBe(1);
    expect(s.rpc.count('assertNetwork')).toBeGreaterThanOrEqual(1);
    expect(s.rpc.count('assertAsset')).toBe(1);
    // Repeating verification finds the mined transaction and never broadcasts again.
    expect(await s.adapter.verify(s.c.header, s.input)).toMatchObject({ ok: true, funding: { transferReference: s.c.hash } });
    expect(await s.restart().recover(s.c.hash, s.input)).toMatchObject({ ok: true });
    expect(s.rpc.sent).toHaveLength(1);
  });

  it('never resubmits a transaction that already exists, whatever its state', async () => {
    const mined = await xlayerScenario({}, {}, (rpc, c) => rpc.include(c.raw));
    expect(await mined.adapter.verify(mined.c.header, mined.input)).toMatchObject({ ok: true });
    expect(mined.rpc.sent).toEqual([]);

    const mempool = await xlayerScenario({}, {}, async (rpc, c) => { rpc.mempool.set(c.hash, await import('../support/xlayer.js').then(m => m.parseRawTransaction(c.raw))); });
    expect(await mempool.adapter.verify(mempool.c.header, mempool.input)).toMatchObject({ ok: false, code: 'payment_required', settlementAttempted: true });
    expect(mempool.rpc.sent).toEqual([]);

    const reverted = await xlayerScenario({}, {}, (rpc, c) => rpc.include(c.raw, { status: 'reverted' }));
    expect(await reverted.adapter.verify(reverted.c.header, reverted.input)).toMatchObject({ ok: false, definitiveFailure: true });
    expect(reverted.rpc.sent).toEqual([]);
  });

  it('retains the candidate without submitting when an existence read times out', async () => {
    const s = await xlayerScenario();
    s.rpc.fail('transaction');
    expect(await s.adapter.verify(s.c.header, s.input)).toMatchObject({ ok: false, code: 'payment_required', settlementAttempted: true });
    expect(s.rpc.sent).toEqual([]);
  });

  it('recovers a send timeout whose transaction was actually included, without a second broadcast', async () => {
    const s = await xlayerScenario();
    s.rpc.sendThrows = true;
    expect(await s.adapter.verify(s.c.header, s.input)).toMatchObject({ ok: true, funding: { transferReference: s.c.hash } });
    expect(s.rpc.sent).toHaveLength(1);
    expect(await s.restart().recover(s.c.hash, s.input)).toMatchObject({ ok: true });
    expect(s.rpc.sent).toHaveLength(1);
  });

  it.each([
    ['timed out and was dropped', (r: FakeXLayerRpc) => { r.sendEffect = 'drop'; r.sendThrows = true; }],
    ['was rejected by the node', (r: FakeXLayerRpc) => { r.fail('sendRaw'); }],
    ['left the transaction unmined in the mempool', (r: FakeXLayerRpc) => { r.sendEffect = 'mempool'; }],
  ])('keeps an ambiguous outcome retained and recoverable when the broadcast %s', async (_name, arrange) => {
    const s = await xlayerScenario();
    arrange(s.rpc);
    expect(await s.adapter.verify(s.c.header, s.input)).toMatchObject({ ok: false, code: 'payment_required', settlementAttempted: true });
    expect(s.rpc.sent).toHaveLength(1);
    expect(s.rpc.count('transaction')).toBe(4); // initial existence check + 3 bounded polls
    expect(s.rpc.count('sendRaw')).toBe(1);
  });

  it('later confirms a mempool transaction by independent recovery without another send', async () => {
    const s = await xlayerScenario();
    s.rpc.sendEffect = 'mempool';
    await s.adapter.verify(s.c.header, s.input);
    s.rpc.mempool.delete(s.c.hash);
    await s.rpc.include(s.c.raw);
    expect(await s.restart().recover(s.c.hash, s.input)).toMatchObject({ ok: true });
    expect(s.rpc.sent).toHaveLength(1);
  });

  it.each([
    ['insufficient USD₮0', (r: FakeXLayerRpc, payer: string) => { r.fund(payer, { token: 999n }); }],
    ['insufficient OKB for the gas budget', (r: FakeXLayerRpc, payer: string) => { r.fund(payer, { native: 69_999n * 1_000_000_000n }); }],
    ['no balance at all', (r: FakeXLayerRpc, payer: string) => { r.fund(payer, { token: 0n, native: 0n }); }],
  ])('does not submit with %s', async (_name, arrange) => {
    const s = await xlayerScenario({}, {}, (rpc, c) => arrange(rpc, c.payer));
    expect(await s.adapter.verify(s.c.header, s.input)).toMatchObject({ ok: false, code: 'payment_invalid', settlementAttempted: false });
    expect(s.rpc.sent).toEqual([]);
  });

  it('accepts the exact balance boundary (token == amount, OKB == gas budget)', async () => {
    const s = await xlayerScenario({}, {}, (rpc, c) => { rpc.fund(c.payer, { token: 1000n, native: 70_000n * 1_000_000_000n }); });
    expect(await s.adapter.verify(s.c.header, s.input)).toMatchObject({ ok: true });
  });

  it('does not submit a candidate whose nonce would queue behind a gap', async () => {
    const s = await xlayerScenario({}, { nonce: 5 }, (rpc, c) => rpc.setNonceBase(c.payer, 3));
    expect(await s.adapter.verify(s.c.header, s.input)).toMatchObject({ ok: false, code: 'payment_invalid', settlementAttempted: false });
    expect(s.rpc.sent).toEqual([]);
  });

  it('does not submit when the nonce was just consumed and fails definitively once that is confirmed deep', async () => {
    const s = await xlayerScenario({}, { nonce: 0 }, (rpc, c) => rpc.consumeNonce(c.payer, rpc.height));
    expect(await s.adapter.verify(s.c.header, s.input)).toMatchObject({ ok: false, code: 'payment_invalid', settlementAttempted: false });
    expect(await s.adapter.verify(s.c.header, s.input)).not.toHaveProperty('definitiveFailure');
    expect(s.rpc.sent).toEqual([]);

    s.rpc.advance(3);
    expect(await s.adapter.verify(s.c.header, s.input)).toMatchObject({ ok: false, code: 'payment_invalid', definitiveFailure: true });
    expect(s.rpc.sent).toEqual([]);
  });

  it('refuses an expired quote and re-checks expiry after the asynchronous asset read', async () => {
    const expired = await xlayerScenario();
    xlayerClock.set(EXPIRY);
    expect(await expired.adapter.verify(expired.c.header, expired.input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(expired.rpc.sent).toEqual([]);

    xlayerClock.set('2026-10-08T00:00:00.000Z');
    const racing = await xlayerScenario();
    racing.rpc.onCall('assertAsset', () => xlayerClock.advance(10 * 60_000));
    expect(await racing.adapter.verify(racing.c.header, racing.input)).toMatchObject({ ok: false, settlementAttempted: false });
    expect(racing.rpc.sent).toEqual([]);
  });

  it.each([
    ['wrong chain id', (r: FakeXLayerRpc) => { r.chainId = 196; }],
    ['unreachable network check', (r: FakeXLayerRpc) => { r.fail('assertNetwork'); }],
    ['wrong asset metadata', (r: FakeXLayerRpc) => { r.symbol = 'FAKE'; }],
  ])('refuses to submit on %s', async (_name, arrange) => {
    const s = await xlayerScenario();
    arrange(s.rpc);
    expect(await s.adapter.verify(s.c.header, s.input)).toMatchObject({ ok: false, code: 'payment_invalid', settlementAttempted: false });
    expect(s.rpc.sent).toEqual([]);
  });
});

describe('X Layer recovery (read-only)', () => {
  const recoverCase = async (include: Parameters<FakeXLayerRpc['include']>[1] = {}, input = {}, candidate: CandidateOptions = {}) => {
    const s = await xlayerScenario(input, candidate, (rpc, c) => rpc.include(c.raw, include));
    return { s, result: await s.adapter.recover(s.c.hash, s.input) };
  };

  it('is pending while unmined, in the mempool, or under-confirmed, and never broadcasts', async () => {
    const s = await xlayerScenario();
    expect(await s.adapter.recover(s.c.hash, s.input)).toMatchObject({ ok: false, code: 'payment_required', settlementAttempted: true });
    const { parseRawTransaction } = await import('../support/xlayer.js');
    s.rpc.mempool.set(s.c.hash, await parseRawTransaction(s.c.raw));
    expect(await s.adapter.recover(s.c.hash, s.input)).toMatchObject({ ok: false, code: 'payment_required' });

    const shallow = await recoverCase({ confirmations: 1 });
    expect(shallow.result).toMatchObject({ ok: false, code: 'payment_required', settlementAttempted: true });
    shallow.s.rpc.advance(1);
    expect(await shallow.s.adapter.recover(shallow.s.c.hash, shallow.s.input)).toMatchObject({ ok: true, funding: { confirmations: 2 } });
    expect(s.rpc.sent).toEqual([]);
    expect(shallow.s.rpc.sent).toEqual([]);
  });

  it('honours a configured confirmation depth', async () => {
    const s = await xlayerScenario({}, {}, (rpc, c) => rpc.include(c.raw, { confirmations: 3 }), { XLAYER_CONFIRMATIONS: '4' });
    expect(await s.adapter.recover(s.c.hash, s.input)).toMatchObject({ ok: false, code: 'payment_required' });
    s.rpc.advance(1);
    expect(await s.adapter.recover(s.c.hash, s.input)).toMatchObject({ ok: true, funding: { confirmations: 4 } });
  });

  it.each([
    ['receipt read', 'receipt'], ['transaction read', 'transaction'], ['head read', 'latestBlock'], ['network check', 'assertNetwork'],
  ] as const)('retains the candidate when the %s times out', async (_name, method) => {
    const s = await xlayerScenario({}, {}, (rpc, c) => rpc.include(c.raw));
    s.rpc.fail(method);
    expect(await s.adapter.recover(s.c.hash, s.input)).toMatchObject({ ok: false, code: 'payment_required', settlementAttempted: true });
  });

  it('returns invalid for an unusable hash or unconfigured adapter', async () => {
    const s = await xlayerScenario();
    expect(await s.adapter.recover('0xABC', s.input)).toMatchObject({ ok: false, code: 'payment_invalid' });
    expect(await createXLayerFundingAdapter({}, { rpc: s.rpc }).recover(s.c.hash, s.input)).toMatchObject({ ok: false, code: 'payment_invalid' });
  });

  it('accepts only the exact Transfer event and ignores unrelated logs', async () => {
    const exact = (c: { payer: string }) => transferLog({ from: c.payer, to: XLAYER_PAYEE, amount: 1000n });
    const noise = [
      transferLog({ from: OTHER_ADDRESS, to: OTHER_ADDRESS, amount: 5n, address: OTHER_TOKEN }), // same event from another contract
      { address: TOKEN, topics: ['0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'], data: '0x', logIndex: 3 }, // Approval topic
    ];
    const s = await xlayerScenario({}, {}, (rpc, c) => rpc.include(c.raw, { logs: [noise[0]!, exact(c), noise[1]!] }));
    expect(await s.adapter.recover(s.c.hash, s.input)).toMatchObject({ ok: true, funding: { details: { logIndex: 0 } } });
  });

  it.each([
    ['wrong recipient', (c: any) => [transferLog({ from: c.payer, to: OTHER_ADDRESS, amount: 1000n })]],
    ['wrong amount', (c: any) => [transferLog({ from: c.payer, to: XLAYER_PAYEE, amount: 999n })]],
    ['amount above the requirement', (c: any) => [transferLog({ from: c.payer, to: XLAYER_PAYEE, amount: 1001n })]],
    ['sender other than the transaction sender', (c: any) => [transferLog({ from: OTHER_ADDRESS, to: XLAYER_PAYEE, amount: 1000n })]],
    ['two Transfer logs from the token', (c: any) => [transferLog({ from: c.payer, to: XLAYER_PAYEE, amount: 1000n }), transferLog({ from: c.payer, to: XLAYER_PAYEE, amount: 1000n, logIndex: 1 })]],
    ['no Transfer log', () => []],
    ['Transfer log from another contract only', (c: any) => [transferLog({ from: c.payer, to: XLAYER_PAYEE, amount: 1000n, address: OTHER_TOKEN })]],
    ['unindexed amount topic layout', (c: any) => [{ ...transferLog({ from: c.payer, to: XLAYER_PAYEE, amount: 1000n }), topics: transferLog({ from: c.payer, to: XLAYER_PAYEE, amount: 1000n }).topics.slice(0, 2) }]],
    ['malformed data', (c: any) => [{ ...transferLog({ from: c.payer, to: XLAYER_PAYEE, amount: 1000n }), data: '0x03e8' }]],
    ['address topic with dirty high bytes', (c: any) => { const l = transferLog({ from: c.payer, to: XLAYER_PAYEE, amount: 1000n }); l.topics[2] = '0x' + '1'.repeat(24) + XLAYER_PAYEE.slice(2); return [l]; }],
  ])('rejects a successful transaction whose event has %s', async (_name, logs) => {
    const s = await xlayerScenario();
    await s.rpc.include(s.c.raw, { logs: logs(s.c) as never });
    expect(await s.adapter.recover(s.c.hash, s.input)).toMatchObject({ ok: false, code: 'payment_invalid' });
  });

  it('treats a reverted transaction as a definitive, zero-principal failure', async () => {
    const { result } = await recoverCase({ status: 'reverted' });
    expect(result).toMatchObject({ ok: false, code: 'payment_invalid', definitiveFailure: true });
    expect(result).not.toHaveProperty('funding');
  });

  it('does not call a reverted transaction with a Transfer log definitive (unexpected principal effects)', async () => {
    const s = await xlayerScenario();
    await s.rpc.include(s.c.raw, { status: 'reverted', logs: [transferLog({ from: s.c.payer, to: XLAYER_PAYEE, amount: 1000n })] });
    const result = await s.adapter.recover(s.c.hash, s.input);
    expect(result).toMatchObject({ ok: false, code: 'payment_invalid' });
    expect(result).not.toHaveProperty('definitiveFailure');
  });

  it('does not decide a reverted transaction before it is confirmed deep', async () => {
    const { result } = await recoverCase({ status: 'reverted', confirmations: 1 });
    expect(result).toMatchObject({ ok: false, code: 'payment_required' });
    expect(result).not.toHaveProperty('definitiveFailure');
  });

  it.each([
    ['receipt sender', { receipt: { from: OTHER_ADDRESS } }],
    ['receipt target', { receipt: { to: OTHER_TOKEN } }],
    ['receipt hash', { receipt: { hash: '0x' + '9'.repeat(64) } }],
    ['transaction target', { tx: { to: OTHER_TOKEN } }],
    ['transaction calldata', { tx: { input: '0x' } }],
    ['transaction chain id', { tx: { chainId: 196 } }],
    ['transaction hash', { tx: { hash: '0x' + '9'.repeat(64) } }],
  ] as const)('rejects when the %s disagrees with the exact requirement', async (_name, include) => {
    const { result } = await recoverCase(include as never);
    expect(result).toMatchObject({ ok: false, code: 'payment_invalid' });
  });

  it('treats a receipt/transaction block disagreement as transient (pending), never invalid or funded', async () => {
    const { result } = await recoverCase({ receipt: { blockNumber: 1000n } } as never);
    expect(result).toMatchObject({ ok: false, code: 'payment_required' });
  });

  it('rejects a transaction from an unapproved payer', async () => {
    const { result } = await recoverCase({}, { expectedPayer: OTHER_ADDRESS });
    expect(result).toMatchObject({ ok: false, code: 'payment_invalid' });
  });

  it('flags late confirmation with receivedAfterExpiry and still recovers after expiry', async () => {
    const late = await recoverCase({ timestampMs: Date.parse(EXPIRY) + 1000 });
    expect(late.result).toMatchObject({ ok: true, funding: { details: { receivedAfterExpiry: true } } });
    const onTime = await recoverCase({ timestampMs: Date.parse(EXPIRY) - 1000 });
    expect(onTime.result).toMatchObject({ ok: true, funding: { details: { receivedAfterExpiry: false } } });
    xlayerClock.set('2026-10-08T01:00:00.000Z');
    expect(await onTime.s.restart().recover(onTime.s.c.hash, onTime.s.input)).toMatchObject({ ok: true });
    expect(onTime.s.rpc.sent).toEqual([]);
  });

  it('refuses to recover under a requirement outside policy', async () => {
    const s = await xlayerScenario({}, {}, (rpc, c) => rpc.include(c.raw));
    expect(await s.adapter.recover(s.c.hash, { ...s.input, payTo: OTHER_ADDRESS })).toMatchObject({ ok: false });
  });
});

describe('X Layer resume after restart', () => {
  it('re-sends the exact stored bytes at most once, and only before expiry', async () => {
    const s = await xlayerScenario();
    const payload = payloadOf(await s.adapter.prepare(s.c.header, s.input));
    expect(await s.restart().resume!(s.c.hash, s.input, payload)).toMatchObject({ ok: true, funding: { transferReference: s.c.hash } });
    expect(s.rpc.sent).toEqual([s.c.raw]);
    expect(await s.restart().resume!(s.c.hash, s.input, payload)).toMatchObject({ ok: true });
    expect(s.rpc.sent).toHaveLength(1);
  });

  it('does not re-send after the quote expires', async () => {
    const s = await xlayerScenario();
    const payload = payloadOf(await s.adapter.prepare(s.c.header, s.input));
    xlayerClock.set(EXPIRY);
    expect(await s.restart().resume!(s.c.hash, s.input, payload)).toMatchObject({ ok: false, code: 'payment_required', settlementAttempted: true });
    expect(s.rpc.sent).toEqual([]);
  });

  it('still recovers an included payment on resume after expiry', async () => {
    const s = await xlayerScenario({}, {}, (rpc, c) => rpc.include(c.raw));
    const payload = { header: s.c.header };
    xlayerClock.set('2026-10-08T02:00:00.000Z');
    expect(await s.restart().resume!(s.c.hash, s.input, payload)).toMatchObject({ ok: true });
    expect(s.rpc.sent).toEqual([]);
  });

  it('rejects a recovery payload that does not match the hash, without sending anything', async () => {
    const s = await xlayerScenario();
    const other = await makeXLayerCandidate(s.input);
    expect(await s.restart().resume!(s.c.hash, s.input, { header: other.header })).toMatchObject({ ok: false, reason: expect.stringMatching(/hash mismatch/) });
    expect(s.rpc.sent).toEqual([]);
  });

  it.each([
    ['missing', {}],
    ['wrong shape', { header: 123 }],
    ['extra fields', { header: 'unused', extra: true }],
    ['a tampered header', { header: 'AAAA' }],
  ])('rejects %s payload without sending a replacement', async (_name, payload) => {
    const s = await xlayerScenario();
    expect(await s.adapter.resume!(s.c.hash, s.input, payload)).toMatchObject({ ok: false });
    expect(s.rpc.sent).toEqual([]);
  });

  it('rejects a durable payload whose requirement was altered', async () => {
    const s = await xlayerScenario();
    const payload = { header: s.c.header };
    expect(await s.restart().resume!(s.c.hash, { ...s.input, quoteDigest: 'changed' }, payload)).toMatchObject({ ok: false });
    expect(s.rpc.sent).toEqual([]);
  });

  it.each([
    ['present in the mempool', async (rpc: FakeXLayerRpc, c: { raw: string; hash: string }) => {
      const { parseRawTransaction } = await import('../support/xlayer.js');
      rpc.mempool.set(c.hash, await parseRawTransaction(c.raw));
    }],
    ['present but under-confirmed', (rpc: FakeXLayerRpc, c: { raw: string }) => { void rpc.include(c.raw, { confirmations: 1 }); }],
    ['unreadable', (rpc: FakeXLayerRpc) => { rpc.fail('transaction'); }],
  ])('does not re-send a transaction that is %s', async (_name, arrange) => {
    const s = await xlayerScenario({}, {}, async (rpc, c) => { await arrange(rpc, c); });
    const result = await s.restart().resume!(s.c.hash, s.input, { header: s.c.header });
    expect(result).toMatchObject({ ok: false, code: 'payment_required', settlementAttempted: true });
    expect(s.rpc.sent).toEqual([]);
  });

  it('is definitively failed when the nonce is consumed by another transaction at confirmed depth and the hash is absent', async () => {
    const s = await xlayerScenario({}, {}, (rpc, c) => rpc.setNonceBase(c.payer, 1));
    const result = await s.restart().resume!(s.c.hash, s.input, { header: s.c.header });
    expect(result).toMatchObject({ ok: false, code: 'payment_invalid', definitiveFailure: true });
    expect(s.rpc.sent).toEqual([]);
  });

  it('recovers normally when the nonce is consumed and the signed hash is the consumer', async () => {
    const s = await xlayerScenario({}, {}, (rpc, c) => rpc.include(c.raw, { confirmations: 5 }));
    const result = await s.restart().resume!(s.c.hash, s.input, { header: s.c.header });
    expect(result).toMatchObject({ ok: true, funding: { transferReference: s.c.hash } });
    expect(result).not.toHaveProperty('definitiveFailure');
    expect(s.rpc.sent).toEqual([]);
  });

  it('does not declare supersession until the consuming block is confirmed deep', async () => {
    const s = await xlayerScenario({}, {}, (rpc, c) => rpc.consumeNonce(c.payer, rpc.height));
    const early = await s.restart().resume!(s.c.hash, s.input, { header: s.c.header });
    expect(early).toMatchObject({ ok: false });
    expect(early).not.toHaveProperty('definitiveFailure');
    expect(s.rpc.sent).toEqual([]);
    s.rpc.advance(2);
    expect(await s.restart().resume!(s.c.hash, s.input, { header: s.c.header })).toMatchObject({ ok: false, definitiveFailure: true });
    expect(s.rpc.sent).toEqual([]);
  });

  it('does not treat a transient transaction-count failure as supersession', async () => {
    const s = await xlayerScenario();
    s.rpc.fail('transactionCount');
    const result = await s.restart().resume!(s.c.hash, s.input, { header: s.c.header });
    expect(result).toMatchObject({ ok: false, code: 'payment_required' });
    expect(result).not.toHaveProperty('definitiveFailure');
    expect(s.rpc.sent).toEqual([]);
  });
});
