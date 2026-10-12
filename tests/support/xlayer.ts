import { decodeFunctionData, keccak256, pad, parseTransaction, recoverTransactionAddress, toHex, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { createXLayerFundingAdapter } from '../../src/funding/xlayer/adapter.js';
import { CHAIN_ID, NETWORK, RPC_URLS, TOKEN, TOKEN_DECIMALS, TOKEN_SYMBOL } from '../../src/funding/xlayer/config.js';
import type { ChainLog, ChainReceipt, ChainTransaction, XLayerRpcPort } from '../../src/funding/xlayer/rpc.js';
import { ERC20_ABI, PROTOCOL, TRANSFER_TOPIC, bindingMessage, encodeCandidate, transferCalldata, type XLayerCandidate } from '../../src/funding/xlayer/wire.js';
import { ManualClock } from '../../src/infrastructure/clock.js';

export const xlayerClock = new ManualClock(Date.parse('2026-10-08T00:00:00.000Z'));
/** Fixed test-only key whose address is the treasury, so a "payer == recipient" candidate can really be signed. */
export const XLAYER_TREASURY_KEY: Hex = ('0x' + '07'.repeat(32)) as Hex;
export const XLAYER_PAYEE = privateKeyToAccount(XLAYER_TREASURY_KEY).address.toLowerCase();
export const OTHER_ADDRESS = '0x' + 'c'.repeat(40);
export const OTHER_TOKEN = '0x' + 'd'.repeat(40);
export const MAX_GAS_BUDGET_WEI = 10n ** 15n;

export function xlayerInput(changes: Partial<FundingRequirementInput> = {}): FundingRequirementInput {
  return {
    purchaseId: 'pur_1234567890',
    quoteId: 'quo_1234567890',
    quoteDigest: 'quote-digest',
    amount: { network: NETWORK, assetId: TOKEN, decimals: TOKEN_DECIMALS, amountBaseUnits: '1000' },
    payTo: XLAYER_PAYEE,
    resourceUrl: 'http://127.0.0.1:8787/v1/purchases/pur_1234567890/fund',
    description: 'Test purchase',
    expiresAt: '2026-10-08T00:10:00.000Z',
    ...changes,
  };
}

export const xlayerEnv = {
  XLAYER_NETWORK: NETWORK,
  XLAYER_CHAIN_ID: String(CHAIN_ID),
  XLAYER_RPC_URL: RPC_URLS[0],
  XLAYER_TOKEN_ADDRESS: TOKEN,
  XLAYER_ASSET_DECIMALS: String(TOKEN_DECIMALS),
  XLAYER_TREASURY_ADDRESS: XLAYER_PAYEE,
  XLAYER_MAX_PAYMENT_BASE_UNITS: '10000',
  XLAYER_MAX_GAS_BUDGET_WEI: MAX_GAS_BUDGET_WEI.toString(),
};

/** The real ERC-20 Transfer(address indexed from, address indexed to, uint256 value) log. */
export function transferLog(args: { from: string; to: string; amount: bigint; address?: string; logIndex?: number }): ChainLog {
  return {
    address: (args.address ?? TOKEN).toLowerCase(),
    topics: [TRANSFER_TOPIC, pad(args.from.toLowerCase() as Hex, { size: 32 }), pad(args.to.toLowerCase() as Hex, { size: 32 })],
    data: pad(toHex(args.amount), { size: 32 }),
    logIndex: args.logIndex ?? 0,
  };
}

export async function parseRawTransaction(raw: string): Promise<ChainTransaction> {
  const tx = parseTransaction(raw as Hex);
  const from = (await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` })).toLowerCase();
  return { hash: keccak256(raw as Hex), from, to: tx.to?.toLowerCase() ?? null, input: tx.data ?? '0x', nonce: tx.nonce ?? 0,
    chainId: tx.chainId ?? null, blockNumber: null };
}

export interface IncludeOptions {
  status?: 'success' | 'reverted';
  block?: bigint;
  /** Chain height after inclusion is raised to at least block + confirmations - 1. */
  confirmations?: number;
  /** Replace the logs (or derive them from the default exact Transfer log). */
  logs?: ChainLog[] | ((defaults: ChainLog[]) => ChainLog[]);
  receipt?: Partial<ChainReceipt>;
  tx?: Partial<ChainTransaction>;
  timestampMs?: number;
}
export type RpcMethod = keyof XLayerRpcPort;

/** A small deterministic in-memory X Layer. No network access. */
export class FakeXLayerRpc implements XLayerRpcPort {
  chainId = CHAIN_ID;
  symbol = TOKEN_SYMBOL;
  decimals = TOKEN_DECIMALS;
  tokenHasCode = true;
  height = 1000n;
  gasEstimate = 60_000n;
  fees = { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 100_000_000n };
  /** What an accepted broadcast does: land in the next block, sit in the mempool, or vanish. */
  sendEffect: 'mine' | 'mempool' | 'drop' = 'mine';
  /** The node answers the broadcast with a timeout/error even though the effect above occurred. */
  sendThrows = false;
  confirmDepth = 2;
  readonly sent: string[] = [];
  readonly calls: Record<string, number> = {};
  readonly mempool = new Map<string, ChainTransaction>();
  readonly mined = new Map<string, { tx: ChainTransaction; receipt: ChainReceipt }>();
  private readonly failures = new Map<string, { times: number; error: Error }>();
  private readonly hooks = new Map<string, () => void>();
  private readonly accounts = new Map<string, { base: number; blocks: bigint[] }>();
  private readonly tokenBalances = new Map<string, bigint>();
  private readonly nativeBalances = new Map<string, bigint>();
  private readonly timestamps = new Map<bigint, number>();

  constructor(readonly clock: ManualClock = xlayerClock) {}

  count(method: RpcMethod): number { return this.calls[method] ?? 0; }
  /** Make a method fail (default: always). A failing read is a timeout, not evidence of absence. */
  fail(method: RpcMethod, options: { times?: number; error?: Error } = {}): this {
    this.failures.set(method, { times: options.times ?? Infinity, error: options.error ?? new Error(`${method} timed out`) });
    return this;
  }
  clearFailures(): void { this.failures.clear(); }
  /** Run a side effect (e.g. advance the clock) each time `method` is called, before it answers. */
  onCall(method: RpcMethod, fn: () => void): this { this.hooks.set(method, fn); return this; }
  fund(address: string, balances: { token?: bigint; native?: bigint } = {}): this {
    this.tokenBalances.set(address.toLowerCase(), balances.token ?? 10_000_000n);
    this.nativeBalances.set(address.toLowerCase(), balances.native ?? 10n ** 18n);
    return this;
  }
  setNonceBase(address: string, base: number): this { this.account(address).base = base; return this; }
  advance(blocks = 1): void { this.height += BigInt(blocks); }

  /** A different transaction from `address` consumed the next nonce at `block` (default: the current head). */
  consumeNonce(address: string, block: bigint = this.height): void { this.account(address).blocks.push(block); }
  drop(hash: string): void { this.mempool.delete(hash); this.mined.delete(hash); }

  /** Mine a signed transaction: tx + receipt + real Transfer log, account nonce consumed, height advanced. */
  async include(raw: string, options: IncludeOptions = {}): Promise<string> {
    const parsed = await parseRawTransaction(raw);
    this.mempool.delete(parsed.hash);
    const block = options.block ?? this.height + 1n, status = options.status ?? 'success';
    this.height = [this.height, block + BigInt(options.confirmations ?? this.confirmDepth) - 1n].reduce((a, b) => (a > b ? a : b));
    this.account(parsed.from).blocks.push(block);
    this.timestamps.set(block, options.timestampMs ?? this.clock.now().getTime());
    const { args } = decodeFunctionData({ abi: ERC20_ABI, data: parsed.input as Hex });
    const defaults = status === 'success' ? [transferLog({ from: parsed.from, to: args![0] as string, amount: args![1] as bigint })] : [];
    const logs = typeof options.logs === 'function' ? options.logs(defaults) : options.logs ?? defaults;
    const tx: ChainTransaction = { ...parsed, blockNumber: block, ...options.tx };
    const receipt: ChainReceipt = { hash: parsed.hash, status, blockNumber: block, blockHash: pad(toHex(block), { size: 32 }), from: parsed.from,
      to: parsed.to, gasUsed: 51_000n, effectiveGasPrice: 1_000_000_000n, logs, ...options.receipt };
    this.mined.set(parsed.hash, { tx, receipt });
    return parsed.hash;
  }

  private account(address: string) {
    const key = address.toLowerCase();
    let a = this.accounts.get(key);
    if (!a) { a = { base: 0, blocks: [] }; this.accounts.set(key, a); }
    return a;
  }
  private enter(method: RpcMethod): void {
    this.calls[method] = (this.calls[method] ?? 0) + 1;
    this.hooks.get(method)?.();
    const f = this.failures.get(method);
    if (f && f.times > 0) { f.times--; throw f.error; }
  }

  async assertNetwork() { this.enter('assertNetwork'); if (this.chainId !== CHAIN_ID) throw new Error('X Layer chain id mismatch'); }
  async assertAsset() {
    this.enter('assertAsset');
    if (!this.tokenHasCode || this.decimals !== TOKEN_DECIMALS || this.symbol !== TOKEN_SYMBOL) throw new Error('X Layer USD₮0 metadata unavailable or mismatched');
  }
  async transaction(hash: string) {
    this.enter('transaction');
    return this.mined.get(hash)?.tx ?? this.mempool.get(hash) ?? null;
  }
  async receipt(hash: string) { this.enter('receipt'); return this.mined.get(hash)?.receipt ?? null; }
  async latestBlock() { this.enter('latestBlock'); return this.height; }
  async blockTimestampMs(block: bigint) { this.enter('blockTimestampMs'); return this.timestamps.get(block) ?? this.clock.now().getTime(); }
  async transactionCount(address: string, block?: bigint) {
    this.enter('transactionCount');
    const a = this.account(address);
    if (block !== undefined) return a.base + a.blocks.filter(b => b <= block).length;
    const pending = [...this.mempool.values()].filter(t => t.from === address.toLowerCase()).length;
    return a.base + a.blocks.filter(b => b <= this.height).length + pending;
  }
  async tokenBalance(address: string) { this.enter('tokenBalance'); return this.tokenBalances.get(address.toLowerCase()) ?? 0n; }
  async nativeBalance(address: string) { this.enter('nativeBalance'); return this.nativeBalances.get(address.toLowerCase()) ?? 0n; }
  async estimateTransferGas(_from: string, _data: string) { this.enter('estimateTransferGas'); return this.gasEstimate; }
  async feeCaps() { this.enter('feeCaps'); return { ...this.fees }; }
  async sendRaw(raw: string) {
    this.sent.push(raw);
    this.enter('sendRaw');
    const parsed = await parseRawTransaction(raw);
    if (this.sendEffect === 'mine') await this.include(raw);
    else if (this.sendEffect === 'mempool') this.mempool.set(parsed.hash, parsed);
    if (this.sendThrows) throw new Error('broadcast response timed out');
  }
}

export interface CandidateOptions {
  privateKey?: Hex;
  nonce?: number;
  chainId?: number;
  /** Transaction target; default is the pinned token. */
  to?: string;
  recipient?: string;
  amount?: bigint;
  value?: bigint;
  accessList?: Array<{ address: Hex; storageKeys: Hex[] }>;
  txType?: 'eip1559' | 'legacy' | 'eip2930' | 'eip7702';
  gas?: bigint;
  maxFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  /** Sign the binding message with a different key than the transaction. */
  bindingSigner?: 'other';
  /** Declare a hash that is not the keccak256 of the raw transaction (binding signature still covers the real hash). */
  hashMismatch?: boolean;
  /** Sign with the treasury key, so payer == recipient. */
  payerIsRecipient?: boolean;
  /** Sign the binding message over a different requirement. */
  bindingInput?: FundingRequirementInput;
}

export async function makeXLayerCandidate(input: FundingRequirementInput, options: CandidateOptions = {}) {
  const privateKey = options.payerIsRecipient ? XLAYER_TREASURY_KEY : options.privateKey ?? generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const data = transferCalldata(options.recipient ?? input.payTo, options.amount ?? BigInt(input.amount.amountBaseUnits));
  const maxFeePerGas = options.maxFeePerGas ?? 1_000_000_000n;
  const base = { chainId: options.chainId ?? CHAIN_ID, to: (options.to ?? TOKEN) as Hex, data, value: options.value ?? 0n,
    nonce: options.nonce ?? 0, gas: options.gas ?? 70_000n };
  const type = options.txType ?? 'eip1559';
  const raw: Hex = type === 'eip1559'
    ? await account.signTransaction({ ...base, type, maxFeePerGas, maxPriorityFeePerGas: options.maxPriorityFeePerGas ?? 100_000_000n, accessList: options.accessList })
    : type === 'legacy'
    ? await account.signTransaction({ ...base, type, gasPrice: maxFeePerGas })
    : type === 'eip2930'
    ? await account.signTransaction({ ...base, type, gasPrice: maxFeePerGas, accessList: options.accessList ?? [] })
    : await account.signTransaction({ ...base, type, maxFeePerGas, maxPriorityFeePerGas: 100_000_000n, authorizationList: [] });
  const realHash = keccak256(raw);
  const hash = options.hashMismatch ? ('0x' + (realHash[2] === 'a' ? 'b' : 'a') + realHash.slice(3)) as Hex : realHash;
  const bindingAccount = options.bindingSigner === 'other' ? privateKeyToAccount(generatePrivateKey()) : account;
  const bindingSignature = await bindingAccount.signMessage({ message: bindingMessage(options.bindingInput ?? input, realHash) });
  const candidate: XLayerCandidate = { version: 1, protocol: PROTOCOL, rawTransaction: raw, bindingSignature, hash };
  return { payer: account.address.toLowerCase(), account, privateKey, raw, hash, nonce: base.nonce, candidate, header: encodeCandidate(candidate), input };
}

export type RpcSetup = (rpc: FakeXLayerRpc, candidate: Awaited<ReturnType<typeof makeXLayerCandidate>>) => unknown;

/** Adapter + fake chain with the candidate's payer funded. `sleep` is a no-op so polling is instantaneous. */
export async function xlayerScenario(
  changes: Partial<FundingRequirementInput> = {},
  candidateOptions: CandidateOptions = {},
  setup?: RpcSetup,
  env: Record<string, string> = {},
) {
  const input = xlayerInput(changes);
  const candidate = await makeXLayerCandidate(input, candidateOptions);
  const rpc = new FakeXLayerRpc(xlayerClock).fund(candidate.payer);
  rpc.setNonceBase(candidate.payer, candidate.nonce);
  await setup?.(rpc, candidate);
  const make = () => createXLayerFundingAdapter({ ...xlayerEnv, ...env }, { clock: xlayerClock, rpc, sleep: async () => {}, pollAttempts: 3, pollIntervalMs: 0 });
  return { adapter: make(), input, candidate, rpc, restart: make, c: candidate };
}
