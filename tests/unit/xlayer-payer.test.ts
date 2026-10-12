import { afterEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTransaction, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { CHAIN_ID, NETWORK, TOKEN } from '../../src/funding/xlayer/config.js';
import { PROTOCOL, readCandidate, transferCalldata } from '../../src/funding/xlayer/wire.js';
import { SolanaLedger } from '../../clients/solana/ledger.js';
import { loadXLayerPayerConfig } from '../../clients/xlayer/config.js';
import { XLayerLedger, type XLayerLedgerEntry } from '../../clients/xlayer/ledger.js';
import { buildPayment, payXLayerPurchase, validateChallenge } from '../../clients/xlayer/pay.js';
import { loadSigner } from '../../clients/xlayer/signer.js';
import { FakeXLayerRpc, OTHER_ADDRESS, OTHER_TOKEN, XLAYER_PAYEE, makeXLayerCandidate, xlayerEnv, xlayerInput } from '../support/xlayer.js';

const ID = 'pur_1234567890';
const GATEWAY = 'http://127.0.0.1:8787';
const roots: string[] = [];
const gasBudgetFor = (gas: bigint, fee: bigint) => (gas * 125n / 100n) * fee;
const DEFAULT_GAS_BUDGET = gasBudgetFor(60_000n, 1_000_000_000n); // estimate x 1.25 x max fee

function settlement(amountBaseUnits: string, commercialMinor = '100') {
  if ((BigInt(commercialMinor) * 10n).toString() !== amountBaseUnits) throw new Error('test settlement amount mismatch');
  return {
    policy: { mode: 'scaled_testnet' as const, numerator: 1 as const, denominator: 1000 as const },
    commercialPrincipal: { currency: 'USD' as const, amountMinor: commercialMinor, scale: 2 as const },
    commercialServiceFee: { currency: 'USD' as const, amountMinor: '0', scale: 2 as const },
    commercialTotal: { currency: 'USD' as const, amountMinor: commercialMinor, scale: 2 as const },
    principalBaseUnits: amountBaseUnits, feeBaseUnits: '0', totalBaseUnits: amountBaseUnits,
  };
}
function makeInput(amount = '1000', changes: Partial<FundingRequirementInput> = {}): FundingRequirementInput {
  return xlayerInput({
    purchaseId: ID, quoteId: 'quo_1234567890', quoteDigest: 'sha256:' + 'd'.repeat(64),
    amount: { network: NETWORK, assetId: TOKEN, decimals: 6, amountBaseUnits: amount },
    resourceUrl: `${GATEWAY}/v1/purchases/${ID}/fund`, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    settlement: settlement(amount), ...changes,
  });
}

interface SetupOptions { amount?: string; env?: Record<string, string>; real?: boolean; skipKeyFile?: boolean }
const BASE_PAYER_ENV = {
  XLAYER_PAYER_MAX_PAYMENT_BASE_UNITS: '5000', XLAYER_PAYER_MAX_DAILY_BASE_UNITS: '10000', XLAYER_PAYER_MAX_TOTAL_BASE_UNITS: '20000',
  XLAYER_PAYER_MAX_TOTAL_GAS_WEI: '10000000000000000', XLAYER_PAYER_MAX_COMMERCIAL_USD_MINOR: '50000',
};

function tempRoot(real = false): string {
  const root = mkdtempSync(join(tmpdir(), 'xlayer-payer-'));
  roots.push(root);
  if (real) SolanaLedger.protectDirectory(root);
  return root;
}
/** Real ACL inspection shells out to PowerShell/icacls; stub it unless a case is specifically about protection. */
function stubProtection(): void {
  vi.spyOn(SolanaLedger.prototype, 'assertProtected').mockImplementation(() => {});
  vi.spyOn(SolanaLedger, 'protectDirectory').mockImplementation(path => { mkdirSync(path, { recursive: true }); });
}
function payerEnv(root: string, payer: string, extra: Record<string, string> = {}) {
  return { ...xlayerEnv, XLAYER_GATEWAY_URL: GATEWAY, XLAYER_GATEWAY_TOKEN_FILE: join(root, 'gateway-token.txt'), XLAYER_PAYER_ADDRESS: payer,
    XLAYER_PAYER_KEY_FILE: join(root, 'payer.key'), XLAYER_LEDGER_DIRECTORY: join(root, 'ledger'), ...BASE_PAYER_ENV, ...extra };
}

async function setup(options: SetupOptions = {}) {
  const root = tempRoot(options.real);
  if (!options.real) stubProtection();
  const privateKey = generatePrivateKey(), payer = privateKeyToAccount(privateKey).address.toLowerCase();
  if (!options.skipKeyFile) writeFileSync(join(root, 'payer.key'), privateKey + '\n', { mode: 0o600 });
  writeFileSync(join(root, 'gateway-token.txt'), 'test-only-gateway-token\n', { mode: 0o600 });
  const config = loadXLayerPayerConfig(payerEnv(root, payer, options.env));
  const ledger = new XLayerLedger(config.ledger, config.payer);
  ledger.initialize();
  const rpc = new FakeXLayerRpc().fund(payer);
  const input = makeInput(options.amount);

  let challenge: any = { protocol: PROTOCOL, version: 1, paymentHeader: 'xlayer-payment', requirement: input,
    maxGasBudgetWei: config.maxGasBudget.toString(), binding: 'payer_signed_application_candidate', onChainPurchaseCommitment: false };
  let purchase: any = { state: 'awaiting_funding', paymentState: 'not_received', funding: [] };
  let loseNextSubmission = false, viewStatus = 200, viewBody: unknown, challengeStatus = 402, signedStatus = 202;
  const requests: Array<{ kind: 'challenge' | 'view' | 'signed'; url: string; auth: string | null; header: string | null }> = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? 'GET', headers = new Headers(init?.headers);
    const kind = method === 'GET' ? 'view' : headers.has('xlayer-payment') ? 'signed' : 'challenge';
    requests.push({ kind, url: String(url), auth: headers.get('authorization'), header: headers.get('xlayer-payment') });
    if (kind === 'view') return new Response(JSON.stringify(viewBody ?? { purchase }), { status: viewStatus });
    if (kind === 'challenge') return new Response(JSON.stringify({ ...challenge, purchase }), { status: challengeStatus });
    if (loseNextSubmission) { loseNextSubmission = false; throw new Error('simulated response loss after gateway acceptance'); }
    if (signedStatus === 202) purchase = { state: 'funded_queued', paymentState: 'confirmed', funding: [{ transferReference: 'x' }] };
    return new Response(JSON.stringify({ purchase }), { status: signedStatus });
  }) as typeof fetch;
  const build = vi.fn((i: FundingRequirementInput, entries: XLayerLedgerEntry[]) => buildPayment(config, i, rpc, entries, ID));
  const of = (kind: string) => requests.filter(r => r.kind === kind);

  return {
    root, input, config, ledger, rpc, fetchImpl, build, privateKey, payer, requests, of,
    signedHeaders: () => of('signed').map(r => r.header),
    setChallenge(value: unknown) { challenge = value; },
    challenge: () => challenge,
    setPurchase(value: unknown) { purchase = value; },
    setView(status: number, body?: unknown) { viewStatus = status; viewBody = body; },
    setChallengeStatus(status: number) { challengeStatus = status; },
    setSignedStatus(status: number) { signedStatus = status; },
    loseNextSubmission() { loseNextSubmission = true; },
    pay: (deps: Parameters<typeof payXLayerPurchase>[2] = {}) => payXLayerPurchase(config, ID, { ledger, fetchImpl, rpc, build, ...deps }),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function store(ledger: XLayerLedger, entry: XLayerLedgerEntry): Promise<void> { await ledger.exclusive(async () => ledger.upsert(entry)); }
function reservation(id: string, values: Partial<XLayerLedgerEntry> = {}): XLayerLedgerEntry {
  return { id, amount: '1', gasBudget: '1', nonce: null, header: null, hash: null, createdAt: new Date().toISOString(), status: 'reserved', ...values };
}
const hashOf = (n: number) => '0x' + n.toString(16).padStart(64, '0');

afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('X Layer payer configuration', () => {
  const env = (extra: Record<string, string> = {}, drop: string[] = []) => {
    const e: Record<string, string> = { ...payerEnv('C:\\payer-root'.replace(/\\/g, '/').replace(/^C:/, tmpdir().slice(0, 2)), '0x' + 'a'.repeat(40)), ...extra };
    for (const k of drop) delete e[k];
    return e;
  };

  it('loads gateway bounds, spend policy and derived paths', () => {
    const cfg = loadXLayerPayerConfig(env({ XLAYER_GATEWAY_URL: 'http://localhost:8787/' }));
    expect(cfg).toMatchObject({ payer: '0x' + 'a'.repeat(40), payee: XLAYER_PAYEE, gatewayUrl: 'http://localhost:8787', maxCommercial: 50000n, maxGasBudget: 10n ** 15n,
      policy: { maxPerPayment: 5000n, maxDaily: 10000n, maxTotal: 20000n, maxGasPerPayment: 10n ** 15n, maxGasTotal: 10n ** 16n } });
    expect(cfg.ledger.replace(/\\/g, '/')).toMatch(/\/ledger\/xlayer-ledger\.json$/);
  });

  it('supports an external (hosted) ledger without a ledger directory', () => {
    expect(loadXLayerPayerConfig(env({}, ['XLAYER_LEDGER_DIRECTORY']), { ledger: 'external' }).ledger).toBe('');
    expect(() => loadXLayerPayerConfig(env({}, ['XLAYER_LEDGER_DIRECTORY']))).toThrow(/XLAYER_LEDGER_DIRECTORY/);
  });

  it('names the invalid gateway variable without echoing values', () => {
    expect(() => loadXLayerPayerConfig(env({ XLAYER_TREASURY_ADDRESS: 'nope' }))).toThrow(/invalid X Layer configuration: XLAYER_TREASURY_ADDRESS/);
    expect(() => loadXLayerPayerConfig(env({ XLAYER_RPC_URL: 'https://rpc.example.com' }))).toThrow(/XLAYER_RPC_URL/);
    expect(() => loadXLayerPayerConfig(env({}, ['XLAYER_PAYER_ADDRESS', 'XLAYER_PAYER_MAX_TOTAL_GAS_WEI']))).toThrow(/XLAYER_PAYER_ADDRESS,XLAYER_PAYER_MAX_TOTAL_GAS_WEI/);
  });

  it.each([
    ['payer equal to the treasury (signer isolation)', { XLAYER_PAYER_ADDRESS: XLAYER_PAYEE }],
    ['payer equal to the treasury in other case', { XLAYER_PAYER_ADDRESS: XLAYER_PAYEE.slice(0, 2) + XLAYER_PAYEE.slice(2).toUpperCase() }],
    ['per-payment above the daily cap', { XLAYER_PAYER_MAX_PAYMENT_BASE_UNITS: '5000', XLAYER_PAYER_MAX_DAILY_BASE_UNITS: '4999' }],
    ['daily above the total cap', { XLAYER_PAYER_MAX_DAILY_BASE_UNITS: '20001' }],
    ['per-payment above the gateway maximum', { XLAYER_PAYER_MAX_PAYMENT_BASE_UNITS: '10001', XLAYER_PAYER_MAX_DAILY_BASE_UNITS: '20000' }],
    ['total above the 5,100,000 ceiling', { XLAYER_PAYER_MAX_TOTAL_BASE_UNITS: '5100001' }],
    ['commercial cap above 510000 minor units', { XLAYER_PAYER_MAX_COMMERCIAL_USD_MINOR: '510001' }],
    ['total gas above the 0.1 OKB ceiling', { XLAYER_PAYER_MAX_TOTAL_GAS_WEI: (10n ** 17n + 1n).toString() }],
    ['total gas below the per-payment gas cap', { XLAYER_PAYER_MAX_TOTAL_GAS_WEI: (10n ** 15n - 1n).toString() }],
    ['zero per-payment cap', { XLAYER_PAYER_MAX_PAYMENT_BASE_UNITS: '0' }],
    ['relative key file', { XLAYER_PAYER_KEY_FILE: 'payer.key' }],
    ['relative token file', { XLAYER_GATEWAY_TOKEN_FILE: 'token.txt' }],
    ['relative ledger directory', { XLAYER_LEDGER_DIRECTORY: 'ledger' }],
    ['plain-http remote gateway', { XLAYER_GATEWAY_URL: 'http://gateway.example.com' }],
    ['gateway with a path', { XLAYER_GATEWAY_URL: 'https://gateway.example.com/v1' }],
    ['gateway with credentials', { XLAYER_GATEWAY_URL: 'https://user:pw@gateway.example.com' }],
    ['gateway with a query', { XLAYER_GATEWAY_URL: 'https://gateway.example.com/?x=1' }],
    ['malformed payer address', { XLAYER_PAYER_ADDRESS: '0x1234' }],
    ['zero payer address', { XLAYER_PAYER_ADDRESS: '0x' + '0'.repeat(40) }],
  ])('rejects %s', (_name, change) => {
    expect(() => loadXLayerPayerConfig(env(change))).toThrow(/X Layer (payer configuration|signer isolation)/);
  });

  it('accepts the exact ceilings and loopback or https gateways', () => {
    expect(() => loadXLayerPayerConfig(env({ XLAYER_PAYER_MAX_TOTAL_BASE_UNITS: '5100000', XLAYER_PAYER_MAX_DAILY_BASE_UNITS: '5100000',
      XLAYER_PAYER_MAX_COMMERCIAL_USD_MINOR: '510000', XLAYER_PAYER_MAX_TOTAL_GAS_WEI: (10n ** 17n).toString(),
      XLAYER_MAX_PAYMENT_BASE_UNITS: '5100000', XLAYER_PAYER_MAX_PAYMENT_BASE_UNITS: '5100000' }))).not.toThrow();
    for (const url of ['https://gateway.example.com', 'http://127.0.0.1:8787', 'http://[::1]:8787']) {
      expect(() => loadXLayerPayerConfig(env({ XLAYER_GATEWAY_URL: url }))).not.toThrow();
    }
  });
});

describe('X Layer signer loading', () => {
  const keyFile = (contents: string, address?: string) => {
    const root = tempRoot(true), path = join(root, 'payer.key');
    writeFileSync(path, contents, { mode: 0o600 });
    return { path, address: address ?? privateKeyToAccount(contents.trim() as Hex).address };
  };
  const FAIL = /protected X Layer signer file unavailable or identity mismatch/;

  it('loads a protected key and verifies its identity (any address case)', () => {
    const key = generatePrivateKey(), k = keyFile(key + '\n');
    expect(loadSigner(k.path, k.address).address).toBe(k.address);
    expect(loadSigner(k.path, k.address.toLowerCase()).address).toBe(k.address);
  });

  it('refuses a key whose derived address is not the configured payer', () => {
    const k = keyFile(generatePrivateKey());
    expect(() => loadSigner(k.path, OTHER_ADDRESS)).toThrow(FAIL);
  });

  it.each([
    ['empty', ''], ['not hex', 'not-a-key'], ['no 0x prefix', 'ab'.repeat(32)], ['31 bytes', '0x' + 'ab'.repeat(31)],
    ['33 bytes', '0x' + 'ab'.repeat(33)], ['trailing garbage', '0x' + 'ab'.repeat(32) + ' extra'],
  ])('refuses a malformed key file (%s) without echoing its contents', (_name, contents) => {
    const k = keyFile(contents, OTHER_ADDRESS);
    try { loadSigner(k.path, OTHER_ADDRESS); expect.unreachable(); } catch (error) {
      expect((error as Error).message).toMatch(FAIL);
      if (contents) expect((error as Error).message).not.toContain(contents.trim());
    }
  });

  it('refuses a missing key file', () => {
    expect(() => loadSigner(join(tempRoot(true), 'missing.key'), OTHER_ADDRESS)).toThrow(FAIL);
  });

  it('refuses a key file that other local principals can read', () => {
    const k = keyFile(generatePrivateKey());
    if (process.platform === 'win32') execFileSync('icacls.exe', [k.path, '/grant', '*S-1-1-0:(R)'], { stdio: 'pipe' });
    else chmodSync(k.path, 0o644);
    expect(() => loadSigner(k.path, k.address)).toThrow(FAIL);
  });
});

describe('X Layer challenge validation', () => {
  const NOW = new Date('2026-10-08T00:00:00.000Z');
  const make = async (requirement: Partial<FundingRequirementInput> = {}, top: Record<string, unknown> = {}, env: Record<string, string> = {}) => {
    const s = await setup({ env });
    const input = makeInput('1000', { expiresAt: new Date(NOW.getTime() + 15 * 60_000).toISOString(), ...requirement });
    const raw = { protocol: PROTOCOL, version: 1, paymentHeader: 'xlayer-payment', requirement: input, maxGasBudgetWei: s.config.maxGasBudget.toString(),
      binding: 'payer_signed_application_candidate', onChainPurchaseCommitment: false, ...top };
    return { s, raw, input };
  };

  it('accepts the exact gateway challenge (with its optional purchase view)', async () => {
    const { s, raw, input } = await make({}, { purchase: { state: 'awaiting_funding' } });
    expect(validateChallenge(raw, s.config, ID, NOW)).toEqual(input);
  });

  it.each([
    ['wrong protocol (rail)', {}, { protocol: 'sui-usdc-transfer' }],
    ['wrong version', {}, { version: 2 }],
    ['wrong payment header name', {}, { paymentHeader: 'sui-payment' }],
    ['unbound application candidate', {}, { binding: 'on_chain_commitment' }],
    ['claimed on-chain commitment', {}, { onChainPurchaseCommitment: true }],
    ['unknown top-level field', {}, { surprise: true }],
    ['gas cap mismatch (higher)', {}, { maxGasBudgetWei: (10n ** 15n + 1n).toString() }],
    ['gas cap mismatch (lower)', {}, { maxGasBudgetWei: (10n ** 15n - 1n).toString() }],
    ['wrong network', { amount: { network: 'eip155:196', assetId: TOKEN, decimals: 6, amountBaseUnits: '1000' } }, {}],
    ['wrong asset', { amount: { network: NETWORK, assetId: OTHER_TOKEN, decimals: 6, amountBaseUnits: '1000' } }, {}],
    ['wrong decimals', { amount: { network: NETWORK, assetId: TOKEN, decimals: 18, amountBaseUnits: '1000' } }, {}],
    ['wrong recipient', { payTo: OTHER_ADDRESS }, {}],
    ['other purchase id', { purchaseId: 'pur_0987654321' }, {}],
    ['other gateway host', { resourceUrl: `http://127.0.0.1:9999/v1/purchases/${ID}/fund` }, {}],
    ['other gateway path', { resourceUrl: `${GATEWAY}/v1/purchases/pur_0987654321/fund` }, {}],
    ['expired', { expiresAt: '2026-10-07T23:59:59.000Z' }, {}],
    ['expiry more than an hour away', { expiresAt: '2026-10-08T01:00:01.000Z' }, {}],
    ['missing settlement', { settlement: undefined }, {}],
    ['settlement total different from amount', { settlement: settlement('2000', '200') }, {}],
    ['unscaled settlement policy', { settlement: { ...settlement('1000'), policy: { mode: 'real_value', numerator: 1, denominator: 1 } } as never }, {}],
  ])('rejects a challenge with %s', async (_name, requirement, top) => {
    const { s, raw } = await make(requirement as never, top);
    expect(() => validateChallenge(raw, s.config, ID, NOW)).toThrow();
  });

  it('accepts expiry at exactly one hour and rejects a commercial total above the payer cap', async () => {
    const edge = await make({ expiresAt: '2026-10-08T01:00:00.000Z' });
    expect(() => validateChallenge(edge.raw, edge.s.config, ID, NOW)).not.toThrow();
    const capped = await make({}, {}, { XLAYER_PAYER_MAX_COMMERCIAL_USD_MINOR: '99' });
    expect(() => validateChallenge(capped.raw, capped.s.config, ID, NOW)).toThrow(/commercial cap/);
    const exact = await make({}, {}, { XLAYER_PAYER_MAX_COMMERCIAL_USD_MINOR: '100' });
    expect(() => validateChallenge(exact.raw, exact.s.config, ID, NOW)).not.toThrow();
  });

  it('rejects a requirement carrying an extra field', async () => {
    const { s, raw } = await make();
    (raw.requirement as any).surprise = 1;
    expect(() => validateChallenge(raw, s.config, ID, NOW)).toThrow();
  });
});

describe('X Layer payment builder', () => {
  const build = (s: Setup, entries: XLayerLedgerEntry[] = [], input = s.input) => buildPayment(s.config, input, s.rpc, entries, ID);

  it('builds a really-signed exact transfer that round-trips through the funding wire reader and broadcasts nothing', async () => {
    const s = await setup();
    const built = await build(s);
    const decoded = await readCandidate(built.header, s.input, s.config);
    expect(decoded.transfer).toMatchObject({ payer: s.payer, nonce: 0, hash: built.hash, gasBudget: DEFAULT_GAS_BUDGET });
    expect(built).toMatchObject({ nonce: 0, hash: decoded.candidate.hash, gasBudget: DEFAULT_GAS_BUDGET });
    const tx = parseTransaction(decoded.candidate.rawTransaction as Hex);
    expect(tx).toMatchObject({ type: 'eip1559', chainId: CHAIN_ID, to: TOKEN, data: transferCalldata(s.input.payTo, 1000n),
      gas: 75_000n, maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 100_000_000n });
    expect(tx.value ?? 0n).toBe(0n);
    expect(tx.accessList ?? []).toEqual([]);
    expect(s.rpc.sent).toEqual([]);
    expect(built.header).not.toContain(s.privateKey.slice(2));
    expect(Buffer.from(built.header, 'base64').toString()).not.toContain(s.privateKey.slice(2));
  });

  it('takes the nonce from the chain pending count (mempool included), never a local counter', async () => {
    const s = await setup();
    s.rpc.setNonceBase(s.payer, 7);
    expect((await build(s)).nonce).toBe(7);
    s.rpc.setNonceBase(s.payer, 8);
    expect((await build(s)).nonce).toBe(8);
    const a = await build(s), b = await (async () => { s.rpc.setNonceBase(s.payer, 9); return build(s); })();
    expect(a.hash).not.toBe(b.hash);
    expect(s.rpc.count('transactionCount')).toBe(4);
  });

  it('refuses to sign while another purchase holds a signed, unconsumed nonce, and ignores its own and consumed ones', async () => {
    const s = await setup();
    const other = reservation('pur_other0001', { status: 'signed', nonce: 0, header: 'h', hash: hashOf(1) });
    await expect(build(s, [other])).rejects.toThrow(/unconsumed nonce/);
    expect(s.rpc.count('estimateTransferGas')).toBe(0);
    s.rpc.setNonceBase(s.payer, 1); // the other candidate's nonce is now consumed on-chain
    expect((await build(s, [other])).nonce).toBe(1);
    const own = reservation(ID, { status: 'signed', nonce: 1, header: 'h', hash: hashOf(2) });
    expect((await build(s, [own])).nonce).toBe(1);
  });

  it('enforces the gas cap boundary exactly', async () => {
    const s = await setup();
    s.rpc.gasEstimate = 80_000n; // x1.25 = 100,000 gas
    s.rpc.fees = { maxFeePerGas: 10n ** 10n, maxPriorityFeePerGas: 1n }; // 100,000 x 1e10 = 1e15 == cap
    await expect(build(s)).resolves.toMatchObject({ gasBudget: 10n ** 15n });
    s.rpc.fees = { maxFeePerGas: 10n ** 10n + 1n, maxPriorityFeePerGas: 1n };
    await expect(build(s)).rejects.toThrow(/per-payment gas cap/);
  });

  it.each([
    ['zero gas estimate', (r: FakeXLayerRpc) => { r.gasEstimate = 0n; }, /invalid X Layer gas estimate/],
    ['zero max fee', (r: FakeXLayerRpc) => { r.fees = { maxFeePerGas: 0n, maxPriorityFeePerGas: 0n }; }, /invalid X Layer gas estimate/],
    ['tip above the fee cap', (r: FakeXLayerRpc) => { r.fees = { maxFeePerGas: 10n, maxPriorityFeePerGas: 11n }; }, /invalid X Layer gas estimate/],
    ['insufficient USD\u20AE0', (r: FakeXLayerRpc, p: string) => { r.fund(p, { token: 999n }); }, /insufficient X Layer USD\u20AE0 or OKB/],
    ['insufficient OKB for gas', (r: FakeXLayerRpc, p: string) => { r.fund(p, { native: DEFAULT_GAS_BUDGET - 1n }); }, /insufficient X Layer USD\u20AE0 or OKB/],
    ['wrong chain id', (r: FakeXLayerRpc) => { r.chainId = 196; }, /chain id mismatch/],
    ['wrong token metadata', (r: FakeXLayerRpc) => { r.symbol = 'FAKE'; }, /metadata/],
    ['gas estimation failure', (r: FakeXLayerRpc) => { r.fail('estimateTransferGas'); }, /timed out/],
  ])('refuses to sign on %s', async (_name, arrange, error) => {
    const s = await setup();
    arrange(s.rpc, s.payer);
    await expect(build(s)).rejects.toThrow(error);
    expect(s.rpc.sent).toEqual([]);
  });

  it('accepts exact balances', async () => {
    const s = await setup();
    s.rpc.fund(s.payer, { token: 1000n, native: DEFAULT_GAS_BUDGET });
    await expect(build(s)).resolves.toMatchObject({ gasBudget: DEFAULT_GAS_BUDGET });
  });

  it('refuses an expired or out-of-policy requirement after the chain checks', async () => {
    const s = await setup();
    await expect(build(s, [], { ...s.input, expiresAt: new Date(Date.now() - 1000).toISOString() })).rejects.toThrow(/expired or outside policy/);
    await expect(build(s, [], { ...s.input, payTo: OTHER_ADDRESS })).rejects.toThrow(/outside policy/);
  });

  it('refuses to sign with a key that is missing or belongs to another identity', async () => {
    const missing = await setup({ skipKeyFile: true });
    await expect(build(missing)).rejects.toThrow(/signer file unavailable/);
    const wrong = await setup();
    writeFileSync(join(wrong.root, 'payer.key'), generatePrivateKey());
    await expect(build(wrong)).rejects.toThrow(/signer file unavailable or identity mismatch/);
  });
});

describe('X Layer payer', () => {
  it('reserves, signs once and submits the signed candidate to the gateway, never broadcasting itself', async () => {
    const s = await setup();
    const result = await s.pay();
    const [row] = s.ledger.read();
    expect(result).toEqual({ status: 202, hash: row!.hash, resumed: false });
    expect(row).toMatchObject({ id: ID, status: 'accepted', amount: '1000', gasBudget: s.config.maxGasBudget.toString(), nonce: 0 });
    expect(s.requests.map(r => r.kind)).toEqual(['challenge', 'view', 'signed']);
    expect(s.requests.every(r => r.auth === 'Bearer test-only-gateway-token')).toBe(true);
    expect(s.requests[0]!.header).toBeNull();
    expect(s.requests[0]!.url).toBe(`${GATEWAY}/v1/purchases/${ID}/fund`);
    expect(s.requests[1]!.url).toBe(`${GATEWAY}/v1/purchases/${ID}`);
    const decoded = await readCandidate(s.signedHeaders()[0]!, s.input, s.config);
    expect(decoded.candidate.hash).toBe(row!.hash);
    expect(decoded.transfer.payer).toBe(s.payer);
    expect(row!.header).toBe(s.signedHeaders()[0]);
    expect(s.rpc.sent).toEqual([]);
    expect(s.build).toHaveBeenCalledTimes(1);
  });

  it('reuses the same hash on a repeat call and neither signs, reserves nor submits again once the gateway shows funded', async () => {
    const s = await setup();
    const first = await s.pay();
    const estimates = s.rpc.count('estimateTransferGas');
    const second = await s.pay();
    expect(second).toEqual({ status: 202, hash: first.hash, resumed: true });
    expect(s.build).toHaveBeenCalledTimes(1);
    expect(s.rpc.count('estimateTransferGas')).toBe(estimates);
    expect(s.signedHeaders()).toHaveLength(1);
    expect(s.of('challenge')).toHaveLength(1);
    expect(s.ledger.read()).toHaveLength(1);
  });

  it.each([
    ['funding unknown', { state: 'funding_unknown', paymentState: 'unknown', funding: [] }],
    ['already funded', { state: 'funded_queued', paymentState: 'confirmed', funding: [] }],
    ['awaiting but unknown payment', { state: 'awaiting_funding', paymentState: 'unknown', funding: [] }],
  ])('does not submit again when a stored candidate meets a gateway view that is %s', async (_name, view) => {
    const s = await setup();
    const c = await makeXLayerCandidate(s.input, { privateKey: s.privateKey as Hex });
    await store(s.ledger, reservation(ID, { amount: '1000', gasBudget: s.config.maxGasBudget.toString(), status: 'signed', nonce: 0, header: c.header, hash: c.hash }));
    s.setPurchase(view);
    expect(await s.pay()).toEqual({ status: 202, hash: c.hash, resumed: true });
    expect(s.build).not.toHaveBeenCalled();
    expect(s.requests.map(r => r.kind)).toEqual(['view']);
    expect(s.ledger.read()[0]!.status).toBe('signed');
  });

  it('retains the same real signed candidate after response loss and resubmits exactly those bytes', async () => {
    const s = await setup();
    s.loseNextSubmission();
    await expect(s.pay()).rejects.toThrow(/simulated response loss/);
    const [signed] = s.ledger.read();
    expect(signed).toMatchObject({ status: 'signed', nonce: 0 });
    expect(s.build).toHaveBeenCalledTimes(1);
    s.setPurchase({ state: 'awaiting_funding', paymentState: 'not_received', funding: [] });
    const resumed = await s.pay();
    expect(resumed).toEqual({ status: 202, hash: signed!.hash, resumed: true });
    expect(s.build).toHaveBeenCalledTimes(1);
    expect(s.signedHeaders()).toEqual([signed!.header, signed!.header]);
    expect(s.ledger.read()).toMatchObject([{ status: 'accepted', hash: signed!.hash }]);
    expect(s.of('challenge')).toHaveLength(1);
  });

  it('keeps a candidate that the gateway did not accept signed, and reports its status', async () => {
    const s = await setup();
    s.setSignedStatus(409);
    expect(await s.pay()).toMatchObject({ status: 409, resumed: false });
    expect(s.ledger.read()[0]!.status).toBe('signed');
  });

  it('refuses to resubmit an accepted candidate that the gateway no longer shows as received', async () => {
    const s = await setup();
    await s.pay();
    s.setPurchase({ state: 'awaiting_funding', paymentState: 'not_received', funding: [] });
    await expect(s.pay()).rejects.toThrow(/requires reconciliation/);
    expect(s.signedHeaders()).toHaveLength(1);
  });

  it.each([
    ['signing blows up', () => { throw new Error('transaction build failed'); }, /transaction build failed/],
    ['signer is unavailable', () => { throw new Error('protected X Layer signer file unavailable or identity mismatch'); }, /signer file unavailable/],
  ])('blocks the purchase after a crash between reservation and signing when %s, with no second reservation', async (_name, boom, error) => {
    const s = await setup();
    const build = vi.fn(async () => boom());
    await expect(s.pay({ build })).rejects.toThrow(error);
    expect(s.ledger.read()).toMatchObject([{ id: ID, amount: '1000', status: 'reserved', header: null, hash: null, nonce: null }]);
    expect(s.signedHeaders()).toEqual([]);
    // A restart never signs again or reserves again: it demands operator recovery.
    await expect(s.pay()).rejects.toThrow(/no signed candidate; operator recovery required/);
    await expect(s.pay({ build })).rejects.toThrow(/no signed candidate/);
    expect(build).toHaveBeenCalledTimes(1);
    expect(s.build).not.toHaveBeenCalled();
    expect(s.ledger.read()).toHaveLength(1);
    expect(s.of('challenge')).toHaveLength(1);
    expect(s.signedHeaders()).toEqual([]);
  });

  it('retains the reservation when the chain refuses to fund or price the payment', async () => {
    const s = await setup();
    s.rpc.fund(s.payer, { token: 1n });
    await expect(s.pay()).rejects.toThrow(/insufficient X Layer/);
    expect(s.ledger.read()).toMatchObject([{ status: 'reserved', header: null }]);
    expect(s.signedHeaders()).toEqual([]);
  });

  it.each([
    ['per-payment', { XLAYER_PAYER_MAX_PAYMENT_BASE_UNITS: '999' }, /per-payment cap/, 0],
    ['rolling-day', { XLAYER_PAYER_MAX_PAYMENT_BASE_UNITS: '1000', XLAYER_PAYER_MAX_DAILY_BASE_UNITS: '1000', XLAYER_PAYER_MAX_TOTAL_BASE_UNITS: '2000' }, /rolling 24-hour cap/, 1],
    ['cumulative', { XLAYER_PAYER_MAX_PAYMENT_BASE_UNITS: '1000', XLAYER_PAYER_MAX_DAILY_BASE_UNITS: '1000', XLAYER_PAYER_MAX_TOTAL_BASE_UNITS: '1000' }, /cumulative spend cap/, 1],
    ['cumulative gas', { XLAYER_PAYER_MAX_TOTAL_GAS_WEI: '1500000000000000' }, /cumulative gas cap/, 1],
  ] as const)('enforces the %s cap before reserving, signing or submitting', async (name, env, error, prior) => {
    const s = await setup({ env });
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000).toISOString();
    if (name === 'rolling-day') await store(s.ledger, reservation('prior-day'));
    if (name === 'cumulative') await store(s.ledger, reservation('prior-total', { createdAt: old, status: 'accepted', nonce: 0, header: 'h', hash: hashOf(1) }));
    if (name === 'cumulative gas') await store(s.ledger, reservation('prior-gas', { createdAt: old, gasBudget: (10n ** 15n).toString() }));
    await expect(s.pay()).rejects.toThrow(error);
    expect(s.build).not.toHaveBeenCalled();
    expect(s.signedHeaders()).toEqual([]);
    expect(s.ledger.read()).toHaveLength(prior);
  });

  it.each([
    ['asset', (c: any) => { c.requirement.amount.assetId = OTHER_TOKEN; }],
    ['recipient', (c: any) => { c.requirement.payTo = OTHER_ADDRESS; }],
    ['network', (c: any) => { c.requirement.amount.network = 'eip155:196'; }],
    ['expiry', (c: any) => { c.requirement.expiresAt = '2020-01-01T00:00:00.000Z'; }],
    ['gas cap', (c: any) => { c.maxGasBudgetWei = '1'; }],
    ['protocol', (c: any) => { c.protocol = 'sui-usdc-transfer'; }],
  ])('rejects a challenge with a wrong %s without reserving or signing', async (_name, mutate) => {
    const s = await setup();
    const changed = structuredClone(s.challenge());
    mutate(changed);
    s.setChallenge(changed);
    await expect(s.pay()).rejects.toThrow();
    expect(s.build).not.toHaveBeenCalled();
    expect(s.ledger.read()).toEqual([]);
    expect(s.signedHeaders()).toEqual([]);
  });

  it('rejects a challenge above the commercial cap without reserving or signing', async () => {
    const s = await setup({ env: { XLAYER_PAYER_MAX_COMMERCIAL_USD_MINOR: '99' } });
    await expect(s.pay()).rejects.toThrow(/commercial cap/);
    expect(s.build).not.toHaveBeenCalled();
    expect(s.ledger.read()).toEqual([]);
  });

  it('requires a 402 challenge and a well-formed purchase id', async () => {
    const s = await setup();
    s.setChallengeStatus(200);
    await expect(s.pay()).rejects.toThrow(/did not issue X Layer payment requirements/);
    expect(s.ledger.read()).toEqual([]);
    await expect(payXLayerPurchase(s.config, 'not-a-purchase', { ledger: s.ledger, fetchImpl: s.fetchImpl })).rejects.toThrow(/invalid purchase id/);
    expect(s.requests).toHaveLength(1);
  });

  it('requires a ledger implementation for an external ledger configuration', async () => {
    const s = await setup();
    await expect(payXLayerPurchase({ ...s.config, ledger: '' }, ID, { fetchImpl: s.fetchImpl })).rejects.toThrow(/ledger implementation required/);
    expect(s.requests).toEqual([]);
  });

  it('keeps the signed candidate when the gateway readback fails, then resubmits the identical candidate', async () => {
    const s = await setup();
    s.setView(503);
    await expect(s.pay()).rejects.toThrow(/readback unavailable; signed X Layer candidate retained/);
    const [signed] = s.ledger.read();
    expect(signed).toMatchObject({ status: 'signed', header: expect.any(String) });
    expect(s.signedHeaders()).toEqual([]);
    s.setView(200);
    expect(await s.pay()).toEqual({ status: 202, hash: signed!.hash, resumed: true });
    expect(s.signedHeaders()).toEqual([signed!.header]);
    expect(s.build).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['no purchase', {}], ['missing states', { purchase: {} }], ['numeric state', { purchase: { state: 1, paymentState: 2 } }],
  ])('treats a malformed readback (%s) as unavailable and submits nothing', async (_name, body) => {
    const s = await setup();
    s.setView(200, body);
    await expect(s.pay()).rejects.toThrow(/invalid purchase readback/);
    expect(s.signedHeaders()).toEqual([]);
    expect(s.ledger.read()).toMatchObject([{ status: 'signed' }]);
  });

  it('retains only the safe reservation when the builder returns a candidate that does not bind this requirement or payer', async () => {
    for (const [label, make] of [
      ['other expiry', (s: Setup) => makeXLayerCandidate(s.input, { privateKey: s.privateKey as Hex, bindingInput: { ...s.input, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() } })],
      ['other payer', (s: Setup) => makeXLayerCandidate(s.input, {})],
      ['other recipient', (s: Setup) => makeXLayerCandidate(s.input, { privateKey: s.privateKey as Hex, recipient: OTHER_ADDRESS })],
      ['binding by other key', (s: Setup) => makeXLayerCandidate(s.input, { privateKey: s.privateKey as Hex, bindingSigner: 'other' })],
    ] as const) {
      const s = await setup();
      const bad = await make(s);
      const build = vi.fn(async () => ({ header: bad.header, nonce: bad.nonce, hash: bad.hash, gasBudget: 1n }));
      await expect(s.pay({ build }), label).rejects.toThrow();
      expect(s.ledger.read(), label).toMatchObject([{ status: 'reserved', header: null, hash: null, nonce: null }]);
      expect(s.signedHeaders(), label).toEqual([]);
    }
  });

  it('rejects a built candidate whose reported nonce disagrees with the signed transaction', async () => {
    const s = await setup();
    const good = await makeXLayerCandidate(s.input, { privateKey: s.privateKey as Hex, nonce: 3 });
    const build = vi.fn(async () => ({ header: good.header, nonce: 4, hash: good.hash, gasBudget: 1n }));
    await expect(s.pay({ build })).rejects.toThrow(/nonce or reserved gas mismatch/);
    expect(s.ledger.read()).toMatchObject([{ status: 'reserved', nonce: null }]);
  });

  it('does not sign a second payment while another purchase holds an unconsumed signed nonce', async () => {
    const s = await setup();
    await store(s.ledger, reservation('pur_other0001', { status: 'signed', nonce: 0, header: 'h', hash: hashOf(1), createdAt: new Date(Date.now() - 1000).toISOString() }));
    await expect(s.pay()).rejects.toThrow(/unconsumed nonce/);
    expect(s.ledger.read().find(e => e.id === ID)).toMatchObject({ status: 'reserved', header: null });
    expect(s.signedHeaders()).toEqual([]);
    s.rpc.setNonceBase(s.payer, 1); // the earlier candidate was mined, so its nonce is no longer outstanding
    await expect(s.pay()).rejects.toThrow(/no signed candidate/); // but this purchase is already blocked for operator recovery
  });

  it('signs with the next nonce for a new purchase once earlier nonces are consumed on-chain', async () => {
    const s = await setup();
    await store(s.ledger, reservation('pur_other0001', { status: 'accepted', nonce: 0, header: 'h', hash: hashOf(1), createdAt: new Date(Date.now() - 1000).toISOString() }));
    s.rpc.setNonceBase(s.payer, 1);
    await s.pay();
    expect(s.ledger.read().find(e => e.id === ID)).toMatchObject({ status: 'accepted', nonce: 1 });
  });

  it('fails concurrent calls for the same purchase at the ledger lock: one succeeds, the other signs and submits nothing', async () => {
    const s = await setup();
    let unblock!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { unblock = resolve; });
    const requestEntered = new Promise<void>(resolve => { entered = resolve; });
    const blockedFetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST' && !new Headers(init.headers).has('xlayer-payment')) { entered(); await gate; }
      return s.fetchImpl(url, init);
    }) as typeof fetch;
    const first = s.pay({ fetchImpl: blockedFetch });
    await requestEntered;
    await expect(s.pay()).rejects.toThrow(/locked/);
    unblock();
    await expect(first).resolves.toMatchObject({ status: 202 });
    expect(s.build).toHaveBeenCalledTimes(1);
    expect(s.signedHeaders()).toHaveLength(1);
    expect(s.ledger.read()).toHaveLength(1);
  });

  it('works unchanged with an in-memory (async, hosted-style) ledger implementation', async () => {
    const s = await setup();
    const rows: XLayerLedgerEntry[] = [];
    let locked = false;
    const ledger = {
      read: async () => structuredClone(rows),
      upsert: async (e: XLayerLedgerEntry) => { const i = rows.findIndex(r => r.id === e.id); if (i >= 0) rows[i] = e; else rows.push(e); },
      assertCaps: async () => {},
      exclusive: async <T,>(fn: () => Promise<T>) => { if (locked) throw new Error('locked'); locked = true; try { return await fn(); } finally { locked = false; } },
    };
    const first = await s.pay({ ledger });
    expect(rows).toMatchObject([{ id: ID, status: 'accepted', hash: first.hash }]);
    expect(await s.pay({ ledger })).toEqual({ status: 202, hash: first.hash, resumed: true });
    expect(s.build).toHaveBeenCalledTimes(1);
  });

  it('runs end to end against the real file ledger and real key/ledger permission checks', async () => {
    const s = await setup({ real: true });
    const result = await s.pay();
    expect(result.status).toBe(202);
    expect(new XLayerLedger(s.config.ledger, s.config.payer).read()).toMatchObject([{ id: ID, status: 'accepted', hash: result.hash }]);
  });
});
