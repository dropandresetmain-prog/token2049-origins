import { createPublicClient, http, parseAbi, TransactionNotFoundError, TransactionReceiptNotFoundError, type Hex, type PublicClient } from 'viem';
import { CHAIN_ID, RPC_URLS, TOKEN, TOKEN_DECIMALS, TOKEN_SYMBOL } from './config.js';

export interface ChainLog { address: string; topics: string[]; data: string; logIndex: number }
export interface ChainTransaction { hash: string; from: string; to: string | null; input: string; nonce: number; chainId: number | null; blockNumber: bigint | null }
export interface ChainReceipt {
  hash: string; status: 'success' | 'reverted'; blockNumber: bigint; blockHash: string; from: string; to: string | null;
  gasUsed: bigint; effectiveGasPrice: bigint; logs: ChainLog[];
}
export interface XLayerRpcPort {
  assertNetwork(): Promise<void>;
  assertAsset(): Promise<void>;
  transaction(hash: string): Promise<ChainTransaction | null>;
  receipt(hash: string): Promise<ChainReceipt | null>;
  latestBlock(): Promise<bigint>;
  blockTimestampMs(blockNumber: bigint): Promise<number>;
  /** `block` selects the historical state; omitted means the pending view (mempool included). */
  transactionCount(address: string, block?: bigint): Promise<number>;
  tokenBalance(address: string): Promise<bigint>;
  nativeBalance(address: string): Promise<bigint>;
  /** Payer-side only: gas limit estimate for the exact transfer calldata. */
  estimateTransferGas(from: string, data: string): Promise<bigint>;
  /** Payer-side only: current EIP-1559 fee caps. */
  feeCaps(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  /** A timeout does not establish failure. Recovery checks this hash before any exact-byte resubmission. */
  sendRaw(raw: string): Promise<void>;
}
const ERC20_READ = parseAbi(['function decimals() view returns (uint8)', 'function symbol() view returns (string)', 'function balanceOf(address) view returns (uint256)']);
export function xlayerClient(rpcUrl: string = RPC_URLS[0]): PublicClient {
  if (!(RPC_URLS as readonly string[]).includes(rpcUrl)) throw new Error('unapproved X Layer RPC endpoint');
  return createPublicClient({ transport: http(rpcUrl, { timeout: 15000, retryCount: 0 }) });
}
async function retryRead<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await read(); } catch { /* Read-only transient RPC failures may be retried. */ }
    if (attempt < 2) await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
  }
  throw new Error('X Layer independent read unavailable');
}
export class XLayerRpc implements XLayerRpcPort {
  constructor(readonly client: PublicClient = xlayerClient()) {}
  async assertNetwork() {
    const id = await retryRead(() => this.client.getChainId());
    if (id !== CHAIN_ID) throw new Error('X Layer chain id mismatch');
  }
  async assertAsset() {
    const token = TOKEN as Hex;
    const code = await retryRead(() => this.client.getCode({ address: token }));
    const decimals = await retryRead(() => this.client.readContract({ address: token, abi: ERC20_READ, functionName: 'decimals' }));
    const symbol = await retryRead(() => this.client.readContract({ address: token, abi: ERC20_READ, functionName: 'symbol' }));
    if (!code || code === '0x' || decimals !== TOKEN_DECIMALS || symbol !== TOKEN_SYMBOL) throw new Error('X Layer USD₮0 metadata unavailable or mismatched');
  }
  async transaction(hash: string): Promise<ChainTransaction | null> {
    try {
      const t = await this.client.getTransaction({ hash: hash as Hex });
      return { hash: t.hash, from: t.from.toLowerCase(), to: t.to?.toLowerCase() ?? null, input: t.input, nonce: t.nonce,
        chainId: t.chainId ?? null, blockNumber: t.blockNumber };
    } catch (error) {
      if (error instanceof TransactionNotFoundError) return null;
      throw new Error('X Layer transaction read unavailable');
    }
  }
  async receipt(hash: string): Promise<ChainReceipt | null> {
    try {
      const r = await this.client.getTransactionReceipt({ hash: hash as Hex });
      return { hash: r.transactionHash, status: r.status, blockNumber: r.blockNumber, blockHash: r.blockHash, from: r.from.toLowerCase(),
        to: r.to?.toLowerCase() ?? null, gasUsed: r.gasUsed, effectiveGasPrice: r.effectiveGasPrice,
        logs: r.logs.map(l => ({ address: l.address.toLowerCase(), topics: [...l.topics], data: l.data, logIndex: l.logIndex })) };
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw new Error('X Layer receipt read unavailable');
    }
  }
  async latestBlock() { return retryRead(() => this.client.getBlockNumber()); }
  async blockTimestampMs(blockNumber: bigint) {
    const b = await retryRead(() => this.client.getBlock({ blockNumber }));
    return Number(b.timestamp) * 1000;
  }
  async transactionCount(address: string, block?: bigint) {
    if (block !== undefined) return retryRead(() => this.client.getTransactionCount({ address: address as Hex, blockNumber: block }));
    // Observed on X Layer Testnet (13 Oct 2026): the 'pending' view can LAG 'latest' (0 vs 1 after a mined transfer).
    // The next usable nonce is the larger of the two, so a mined payment can never have its nonce reused.
    const [pending, latest] = await Promise.all([
      retryRead(() => this.client.getTransactionCount({ address: address as Hex, blockTag: 'pending' })),
      retryRead(() => this.client.getTransactionCount({ address: address as Hex, blockTag: 'latest' })),
    ]);
    return Math.max(pending, latest);
  }
  async tokenBalance(address: string) {
    return retryRead(() => this.client.readContract({ address: TOKEN as Hex, abi: ERC20_READ, functionName: 'balanceOf', args: [address as Hex] }));
  }
  async nativeBalance(address: string) { return retryRead(() => this.client.getBalance({ address: address as Hex })); }
  async estimateTransferGas(from: string, data: string) {
    return retryRead(() => this.client.estimateGas({ account: from as Hex, to: TOKEN as Hex, data: data as Hex }));
  }
  async feeCaps() {
    const block = await retryRead(() => this.client.getBlock());
    if (block.baseFeePerGas === null || block.baseFeePerGas === undefined) throw new Error('X Layer base fee unavailable');
    const tip = await retryRead(() => this.client.estimateMaxPriorityFeePerGas());
    return { maxFeePerGas: block.baseFeePerGas * 2n + tip, maxPriorityFeePerGas: tip };
  }
  async sendRaw(raw: string) { await this.client.sendRawTransaction({ serializedTransaction: raw as Hex }); }
}
