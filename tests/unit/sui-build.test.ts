import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { loadSuiPayerConfig } from '../../clients/sui/config.js';
import { buildPayment } from '../../clients/sui/pay.js';
import { SolanaLedger } from '../../clients/solana/ledger.js';
import { readCandidate } from '../../src/funding/sui/wire.js';
import { SUI_TYPE, TESTNET_GENESIS, USDC_TYPE } from '../../src/funding/sui/config.js';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { suiEnv, suiInput } from '../support/sui.js';

const roots: string[] = [];
const OBJECT_DIGEST = '11111111111111111111111111111111';
const now = () => new Date(Date.now() + 15 * 60_000).toISOString();

function coin(index: number, type: string, balance: string, owner: string) {
  return {
    objectId: '0x' + index.toString(16).padStart(64, '0'),
    version: '1',
    digest: OBJECT_DIGEST,
    owner: { $kind: 'AddressOwner', AddressOwner: owner },
    type: `0x2::coin::Coin<${type}>`,
    balance,
  };
}

function setup(options: {
  tokenAddressBalance?: string;
  tokenCoinBalance?: string;
  gasAddressBalance?: string;
  gasCoinBalance?: string;
  tokenCoins?: Array<ReturnType<typeof coin>>;
  gasCoins?: Array<ReturnType<typeof coin>>;
  keypair?: Ed25519Keypair;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'sui-build-'));
  roots.push(root);
  SolanaLedger.protectDirectory(root);
  const keypair = options.keypair ?? Ed25519Keypair.generate();
  const payer = keypair.getPublicKey().toSuiAddress();
  const keyFile = join(root, 'payer.key');
  writeFileSync(keyFile, keypair.getSecretKey(), { mode: 0o600 });
  const config = loadSuiPayerConfig({
    ...suiEnv,
    SUI_PAYER_ADDRESS: payer,
    SUI_PAYER_KEY_FILE: keyFile,
    SUI_LEDGER_DIRECTORY: join(root, 'ledger'),
    SUI_GATEWAY_URL: 'http://127.0.0.1:8787',
    SUI_GATEWAY_TOKEN_FILE: join(root, 'unused-token-file'),
    SUI_PAYER_MAX_PAYMENT_BASE_UNITS: '5000',
    SUI_PAYER_MAX_DAILY_BASE_UNITS: '10000',
    SUI_PAYER_MAX_TOTAL_BASE_UNITS: '20000',
    SUI_PAYER_MAX_TOTAL_GAS_MIST: '20000000',
    SUI_PAYER_MAX_COMMERCIAL_USD_MINOR: '50000',
  });
  const input: FundingRequirementInput = suiInput({ expiresAt: now() });
  const defaultTokenCoins = [coin(1, USDC_TYPE, '2000', payer)];
  const defaultGasCoins = [coin(2, SUI_TYPE, '20000000', payer)];
  const calls = {
    balances: [] as Array<{ owner: string; coinType: string }>,
    lists: [] as Array<{ owner: string; coinType: string; limit?: number }>,
  };
  const client = {
    async getChainIdentifier() { return { chainIdentifier: TESTNET_GENESIS }; },
    async getCoinMetadata({ coinType }: { coinType: string }) {
      expect(coinType).toBe(USDC_TYPE);
      return { coinMetadata: { decimals: 6, symbol: 'USDC' } };
    },
    async getBalance({ owner, coinType }: { owner: string; coinType: string }) {
      calls.balances.push({ owner, coinType });
      const isToken = coinType === USDC_TYPE;
      return { balance: { coinType, balance: '0', coinBalance: isToken ? options.tokenCoinBalance ?? '2000' : options.gasCoinBalance ?? '20000000',
        addressBalance: isToken ? options.tokenAddressBalance ?? '0' : options.gasAddressBalance ?? '0' } };
    },
    async listCoins({ owner, coinType, limit }: { owner: string; coinType: string; limit?: number }) {
      calls.lists.push({ owner, coinType, limit });
      const objects = coinType === USDC_TYPE ? options.tokenCoins ?? defaultTokenCoins : options.gasCoins ?? defaultGasCoins;
      return { objects, hasNextPage: false, cursor: null };
    },
    async getReferenceGasPrice() { return { referenceGasPrice: '1000' }; },
    async getCurrentSystemState() { return { systemState: { epoch: '42' } }; },
  } as unknown as SuiGrpcClient;
  return { root, keypair, payer, keyFile, config, input, client, calls };
}

async function build(s: ReturnType<typeof setup>, nonce = 1) {
  const header = await buildPayment(s.config, s.input, s.client, nonce);
  const decoded = await readCandidate(header, s.input, s.config);
  return { header, decoded, tx: Transaction.from(decoded.bytes), data: Transaction.from(decoded.bytes).getData() };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Sui payer transaction builder', () => {
  it('builds a signed exact USDC coin transfer with selected SUI gas coins', async () => {
    const s = setup();
    const result = await build(s, 7);
    expect(result.decoded.transfer).toMatchObject({ payer: s.payer, gasBudget: s.config.maxGasBudget.toString(), digest: result.decoded.candidate.digest });
    expect(result.data.commands[0]?.SplitCoins).toBeDefined();
    expect(result.data.commands[0]?.MoveCall).toBeUndefined();
    expect(result.data.gasData.payment).toHaveLength(1);
    expect(result.decoded.transfer.objects).toHaveLength(1);
    expect(result.data.expiration?.ValidDuring).toMatchObject({
      minEpoch: '42', maxEpoch: '43', maxTimestamp: String(Date.parse(s.input.expiresAt)), chain: TESTNET_GENESIS, nonce: 7,
    });
    expect(s.calls.lists.map(x => x.coinType)).toEqual([USDC_TYPE, SUI_TYPE]);
    expect(s.calls.balances.map(x => x.coinType)).toEqual([USDC_TYPE, SUI_TYPE]);
    expect(result.header).not.toContain(s.keypair.getSecretKey());
  });

  it('merges a bounded set of USDC coins to cover the exact payment', async () => {
    const keypair = Ed25519Keypair.generate();
    const owner = keypair.getPublicKey().toSuiAddress();
    const s = setup({ keypair, tokenCoins: [coin(10, USDC_TYPE, '400', owner), coin(11, USDC_TYPE, '600', owner)] });
    const result = await build(s);
    expect(result.data.commands.some(command => command.MergeCoins)).toBe(true);
    expect(result.decoded.transfer.objects).toHaveLength(2);
    expect(s.calls.lists[0]).toMatchObject({ coinType: USDC_TYPE, limit: 32, owner });
  });

  it('uses address balance for gas without attaching gas objects and signs a chain/expiry-bound nonce', async () => {
    const s = setup({ gasAddressBalance: '20000000', gasCoinBalance: '0' });
    const result = await build(s, 19);
    expect(result.data.gasData.payment).toEqual([]);
    expect(result.data.expiration?.ValidDuring).toMatchObject({ chain: TESTNET_GENESIS, nonce: 19, maxTimestamp: String(Date.parse(s.input.expiresAt)) });
    expect(result.decoded.transfer.payer).toBe(s.payer);
  });

  it('redeems the exact USDC sender address balance and leaves gas funded by coins', async () => {
    const s = setup({ tokenAddressBalance: '1000', tokenCoinBalance: '0' });
    const result = await build(s, 23);
    expect(result.data.commands).toHaveLength(2);
    expect(result.data.commands[0]?.MoveCall).toMatchObject({ module: 'coin', function: 'redeem_funds' });
    const withdrawal = result.data.inputs.find(input => input.FundsWithdrawal)?.FundsWithdrawal;
    expect(withdrawal?.reservation).toEqual({ $kind: 'MaxAmountU64', MaxAmountU64: s.input.amount.amountBaseUnits });
    expect(withdrawal?.typeArg).toMatchObject({ $kind: 'Balance', Balance: USDC_TYPE });
    expect(result.data.gasData.payment).toHaveLength(1);
    expect(result.decoded.transfer.payer).toBe(s.payer);
  });

  it('uses address balances for both assets when coin balances are empty', async () => {
    const s = setup({ tokenAddressBalance: '1000', tokenCoinBalance: '0', gasAddressBalance: '10000000', gasCoinBalance: '0', tokenCoins: [], gasCoins: [] });
    const result = await build(s, 29);
    expect(result.data.commands[0]?.MoveCall?.function).toBe('redeem_funds');
    expect(result.data.gasData.payment).toEqual([]);
    expect(result.decoded.transfer.gasBudget).toBe('10000000');
  });

  it('produces a distinct digest for each reserved nonce', async () => {
    const s = setup();
    const first = await build(s, 31);
    const second = await build(s, 32);
    expect(first.decoded.candidate.digest).not.toBe(second.decoded.candidate.digest);
    expect(first.data.expiration?.ValidDuring?.nonce).toBe(31);
    expect(second.data.expiration?.ValidDuring?.nonce).toBe(32);
  });

  it.each([
    ['USDC', { tokenCoinBalance: '999', tokenAddressBalance: '0' }],
    ['gas', { gasCoinBalance: '9999999', gasAddressBalance: '0' }],
  ])('refuses insufficient %s balance before signing', async (_name, balances) => {
    const s = setup(balances);
    await expect(buildPayment(s.config, s.input, s.client, 1)).rejects.toThrow(/insufficient Sui USDC or gas balance/);
  });

  it('refuses USDC fragmented across more than the bounded coin selection page', async () => {
    const s = setup({ tokenCoins: Array.from({ length: 32 }, (_, index) => coin(100 + index, USDC_TYPE, '1', '0x' + '1'.repeat(64))) });
    await expect(buildPayment(s.config, s.input, s.client, 1)).rejects.toThrow(/coin selection exceeds bounded object policy/);
    expect(s.calls.lists[0]).toMatchObject({ coinType: USDC_TYPE, limit: 32 });
  });
});
