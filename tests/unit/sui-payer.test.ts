import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { bindingMessage, encodeCandidate } from '../../src/funding/sui/wire.js';
import { SUI_TYPE, USDC_TYPE } from '../../src/funding/sui/config.js';
import { SuiLedger, type SuiLedgerEntry } from '../../clients/sui/ledger.js';
import { SolanaLedger } from '../../clients/solana/ledger.js';
import { loadSuiPayerConfig } from '../../clients/sui/config.js';
import { paySuiPurchase } from '../../clients/sui/pay.js';
import { suiClock, suiEnv, suiInput, SUI_PAYEE, makeSuiCandidate } from '../support/sui.js';

const ID = 'pur_1234567890';
const GATEWAY = 'http://127.0.0.1:8787';
const roots: string[] = [];

function settlement(amountBaseUnits: string, commercialMinor = '100') {
  const expected = BigInt(commercialMinor) * 10n;
  if (expected.toString() !== amountBaseUnits) throw new Error('test settlement amount mismatch');
  return {
    policy: { mode: 'scaled_testnet' as const, numerator: 1 as const, denominator: 1000 as const },
    commercialPrincipal: { currency: 'USD' as const, amountMinor: commercialMinor, scale: 2 as const },
    commercialServiceFee: { currency: 'USD' as const, amountMinor: '0', scale: 2 as const },
    commercialTotal: { currency: 'USD' as const, amountMinor: commercialMinor, scale: 2 as const },
    principalBaseUnits: amountBaseUnits,
    feeBaseUnits: '0',
    totalBaseUnits: amountBaseUnits,
  };
}

function makeInput(amount = '1000'): FundingRequirementInput {
  return suiInput({
    purchaseId: ID,
    quoteId: 'quo_1234567890',
    quoteDigest: 'sha256:' + 'd'.repeat(64),
    amount: { network: 'sui:testnet', assetId: USDC_TYPE, decimals: 6, amountBaseUnits: amount },
    payTo: SUI_PAYEE,
    resourceUrl: `${GATEWAY}/v1/purchases/${ID}/fund`,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    settlement: settlement(amount),
  });
}

interface SetupOptions {
  amount?: string;
  maxPayment?: string;
  maxDaily?: string;
  maxTotal?: string;
  maxGasTotal?: string;
  maxCommercial?: string;
}

async function setup(options: SetupOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sui-payer-'));
  roots.push(root);
  const input = makeInput(options.amount);
  const candidate = await makeSuiCandidate(input);
  const tokenFile = join(root, 'gateway-token.txt');
  writeFileSync(tokenFile, 'test-only-gateway-token\n', { mode: 0o600 });
  const env = {
    ...suiEnv,
    SUI_GATEWAY_URL: GATEWAY,
    SUI_GATEWAY_TOKEN_FILE: tokenFile,
    SUI_PAYER_ADDRESS: candidate.payer,
    SUI_PAYER_KEY_FILE: join(root, 'unused-test-key-file'),
    SUI_LEDGER_DIRECTORY: join(root, 'ledger'),
    SUI_PAYER_MAX_PAYMENT_BASE_UNITS: options.maxPayment ?? '10000',
    SUI_PAYER_MAX_DAILY_BASE_UNITS: options.maxDaily ?? '10000',
    SUI_PAYER_MAX_TOTAL_BASE_UNITS: options.maxTotal ?? '10000',
    SUI_PAYER_MAX_TOTAL_GAS_MIST: options.maxGasTotal ?? '20000000',
    SUI_PAYER_MAX_COMMERCIAL_USD_MINOR: options.maxCommercial ?? '50000',
  };
  const config = loadSuiPayerConfig(env);
  const ledger = new SuiLedger(config.ledger, config.payer);
  ledger.initialize();
  // The ledger directory is really protected above; payer cases need not shell out to ACL inspection on every read.
  vi.spyOn(SolanaLedger.prototype, 'assertProtected').mockImplementation(() => {});

  let challenge: any = {
    protocol: 'sui-usdc-transfer',
    version: 1,
    paymentHeader: 'sui-payment',
    requirement: input,
    maxGasBudgetMist: config.maxGasBudget.toString(),
    binding: 'payer_signed_application_candidate',
    onChainPurchaseCommitment: false,
  };
  let purchase = { state: 'awaiting_funding', paymentState: 'not_received', funding: [] as Array<{ transferReference?: string }> };
  let loseNextSubmission = false;
  const challengeRequests: string[] = [];
  const viewRequests: string[] = [];
  const submittedHeaders: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const headers = new Headers(init?.headers);
    const suffix = method === 'GET' ? 'GET' : headers.has('sui-payment') ? 'SIGNED_POST' : 'CHALLENGE_POST';
    if (suffix === 'GET') {
      viewRequests.push(String(url));
      return new Response(JSON.stringify({ purchase }), { status: 200 });
    }
    if (suffix === 'CHALLENGE_POST') {
      challengeRequests.push(String(url));
      // The application HTTP response may include its normal purchase view alongside the payment challenge.
      return new Response(JSON.stringify({ ...challenge, purchase }), { status: 402 });
    }
    const header = headers.get('sui-payment')!;
    submittedHeaders.push(header);
    if (loseNextSubmission) {
      loseNextSubmission = false;
      throw new Error('simulated response loss after gateway acceptance');
    }
    purchase = { state: 'funded_queued', paymentState: 'confirmed', funding: [{ transferReference: candidate.digest }] };
    return new Response(JSON.stringify({ purchase }), { status: 202 });
  }) as typeof fetch;
  const build = vi.fn(async (_requirement: FundingRequirementInput) => candidate.header);

  return {
    root, input, candidate, config, ledger, fetchImpl, build,
    calls: { challengeRequests, viewRequests, submittedHeaders },
    setChallenge(value: unknown) { challenge = value; },
    setPurchase(value: typeof purchase) { purchase = value; },
    loseNextSubmission() { loseNextSubmission = true; },
    pay: (deps: { fetchImpl?: typeof fetch; build?: (input: FundingRequirementInput) => Promise<string> } = {}) =>
      paySuiPurchase(config, ID, { ledger, fetchImpl, build, ...deps }),
  };
}

async function store(ledger: SuiLedger, entry: SuiLedgerEntry): Promise<void> {
  await ledger.exclusive(async () => ledger.upsert(entry));
}

function reservation(id: string, values: Partial<SuiLedgerEntry> = {}): SuiLedgerEntry {
  return { id, amount: '1', gasBudget: '1', header: null, digest: null, createdAt: new Date().toISOString(), status: 'reserved', ...values };
}

afterEach(() => {
  vi.restoreAllMocks();
  suiClock.set('2026-10-08T00:00:00.000Z');
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Sui payer', () => {
  it('signs once, retains the same real signed candidate after response loss, and resumes by digest', async () => {
    const s = await setup();
    s.loseNextSubmission();
    await expect(s.pay()).rejects.toThrow(/simulated response loss/);
    expect(s.build).toHaveBeenCalledTimes(1);
    expect(s.ledger.read()).toMatchObject([{ id: ID, status: 'signed', header: s.candidate.header, digest: s.candidate.digest }]);

    const resumed = await s.pay();
    expect(resumed).toEqual({ status: 202, digest: s.candidate.digest, resumed: true });
    expect(s.build).toHaveBeenCalledTimes(1);
    expect(s.calls.submittedHeaders).toHaveLength(2);
    expect(s.calls.submittedHeaders[0]).toBe(s.calls.submittedHeaders[1]);
    expect(s.calls.submittedHeaders[0]).toBe(s.candidate.header);
    expect(s.ledger.read()).toMatchObject([{ status: 'accepted', digest: s.candidate.digest }]);

    const known = await s.pay();
    expect(known).toEqual({ status: 202, digest: s.candidate.digest, resumed: true });
    expect(s.calls.submittedHeaders).toHaveLength(2);
    expect(s.calls.challengeRequests).toHaveLength(1);
    expect(s.calls.viewRequests).toHaveLength(3);
  });

  it('does not submit again when the readback payment state is unknown or already changed', async () => {
    const s = await setup();
    await store(s.ledger, reservation(ID, { amount: s.input.amount.amountBaseUnits, gasBudget: s.config.maxGasBudget.toString(), header: s.candidate.header, digest: s.candidate.digest, status: 'signed' }));
    s.setPurchase({ state: 'funding_unknown', paymentState: 'unknown', funding: [] });
    const result = await s.pay();
    expect(result).toEqual({ status: 202, digest: s.candidate.digest, resumed: true });
    expect(s.build).not.toHaveBeenCalled();
    expect(s.calls.submittedHeaders).toEqual([]);

    s.setPurchase({ state: 'funded_queued', paymentState: 'confirmed', funding: [{ transferReference: s.candidate.digest }] });
    await s.pay();
    expect(s.calls.submittedHeaders).toEqual([]);
  });

  it.each([
    ['per-payment', { maxPayment: '999' }, /per-payment spend cap|per-payment cap/],
    ['rolling-day', { maxPayment: '1000', maxDaily: '1000', maxTotal: '2000' }, /rolling 24-hour cap/],
    ['cumulative', { maxPayment: '1000', maxDaily: '1000', maxTotal: '1000' }, /cumulative spend cap/],
    ['gas total', { maxDaily: '10000', maxTotal: '10000', maxGasTotal: '10000000' }, /cumulative gas cap/],
  ] as const)('enforces the %s cap before signing or submitting', async (_name, options, error) => {
    const s = await setup(options);
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000).toISOString();
    if (_name === 'rolling-day') await store(s.ledger, reservation('prior-day', { createdAt: new Date().toISOString() }));
    if (_name === 'cumulative') await store(s.ledger, reservation('prior-total', { createdAt: old, status: 'accepted', header: s.candidate.header, digest: s.candidate.digest }));
    if (_name === 'gas total') await store(s.ledger, reservation('prior-gas', { createdAt: old }));

    await expect(s.pay()).rejects.toThrow(error);
    expect(s.build).not.toHaveBeenCalled();
    expect(s.calls.submittedHeaders).toEqual([]);
    expect(s.ledger.read()).toHaveLength(_name === 'per-payment' ? 0 : 1);
  });

  it.each(['insufficient Sui USDC or gas coin balance', 'transaction build failed'])(
    'retains a reserved cap hold when %s', async reason => {
      const s = await setup();
      const build = vi.fn(async () => { throw new Error(reason); });
      await expect(s.pay({ build })).rejects.toThrow(reason);
      expect(s.ledger.read()).toMatchObject([{ id: ID, amount: '1000', status: 'reserved', header: null, digest: null }]);
      expect(s.calls.submittedHeaders).toEqual([]);
      await expect(s.pay()).rejects.toThrow(/no signed candidate/);
      expect(build).toHaveBeenCalledTimes(1);
      expect(s.calls.submittedHeaders).toEqual([]);
    },
  );

  it.each([
    ['asset', (challenge: any) => { challenge.requirement.amount.assetId = SUI_TYPE; }],
    ['recipient', (challenge: any) => { challenge.requirement.payTo = '0x' + 'c'.repeat(64); }],
    ['expired challenge', (challenge: any) => { challenge.requirement.expiresAt = '2020-01-01T00:00:00.000Z'; }],
  ])('rejects a challenge with a wrong %s before building a transaction', async (_name, mutate) => {
    const s = await setup();
    const changed = structuredClone({
      protocol: 'sui-usdc-transfer', version: 1, paymentHeader: 'sui-payment', requirement: s.input,
      maxGasBudgetMist: s.config.maxGasBudget.toString(), binding: 'payer_signed_application_candidate', onChainPurchaseCommitment: false,
    });
    mutate(changed);
    s.setChallenge(changed);
    await expect(s.pay()).rejects.toThrow();
    expect(s.build).not.toHaveBeenCalled();
    expect(s.ledger.read()).toEqual([]);
    expect(s.calls.submittedHeaders).toEqual([]);
  });

  it('rejects a challenge above the commercial cap without reserving or signing', async () => {
    const s = await setup({ maxCommercial: '99' });
    await expect(s.pay()).rejects.toThrow(/commercial cap/);
    expect(s.build).not.toHaveBeenCalled();
    expect(s.ledger.read()).toEqual([]);
    expect(s.calls.submittedHeaders).toEqual([]);
  });

  it('rejects a signed candidate bound to a different expiry and retains only the safe reservation', async () => {
    const s = await setup();
    const differentExpiry = { ...s.input, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
    const { signature } = await s.candidate.keypair.signPersonalMessage(bindingMessage(differentExpiry, s.candidate.digest));
    const wrongExpiryHeader = encodeCandidate({ ...s.candidate.candidate, bindingSignature: signature });
    const build = vi.fn(async () => wrongExpiryHeader);
    await expect(s.pay({ build })).rejects.toThrow();
    expect(build).toHaveBeenCalledTimes(1);
    expect(s.ledger.read()).toMatchObject([{ status: 'reserved', header: null, digest: null }]);
    expect(s.calls.submittedHeaders).toEqual([]);
  });

  it('fails concurrent requests at the ledger lock before a second challenge or signature', async () => {
    const s = await setup();
    let unblock!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const requestEntered = new Promise<void>(resolve => { entered = resolve; });
    const blockedFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST' && !new Headers(init.headers).has('sui-payment')) {
        entered();
        await gate;
        return new Response(JSON.stringify({
          protocol: 'sui-usdc-transfer', version: 1, paymentHeader: 'sui-payment', requirement: s.input,
          maxGasBudgetMist: s.config.maxGasBudget.toString(), binding: 'payer_signed_application_candidate', onChainPurchaseCommitment: false,
        }), { status: 402 });
      }
      return s.fetchImpl(url, init);
    }) as typeof fetch;
    const first = s.pay({ fetchImpl: blockedFetch });
    await requestEntered;
    await expect(s.pay()).rejects.toThrow(/locked/);
    unblock();
    await first;
    expect(blockedFetch).toHaveBeenCalledTimes(3); // challenge, purchase readback, signed submission
    expect(s.build).toHaveBeenCalledTimes(1);
    expect(s.calls.submittedHeaders).toHaveLength(1);
  });
});
