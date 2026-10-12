import { describe, expect, it, vi } from 'vitest';
import { createPublicClient, custom, TransactionNotFoundError, TransactionReceiptNotFoundError, type PublicClient } from 'viem';
import { CHAIN_ID, RPC_URLS, TOKEN, TOKEN_SYMBOL } from '../../src/funding/xlayer/config.js';
import { XLayerRpc, xlayerClient } from '../../src/funding/xlayer/rpc.js';
import { TRANSFER_TOPIC } from '../../src/funding/xlayer/wire.js';

const HASH = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const ADDR = '0x' + 'AbCdEf'.repeat(6) + 'AbCd';
const stub = (methods: Record<string, unknown>) => new XLayerRpc(methods as unknown as PublicClient);

describe('X Layer RPC client allowlist', () => {
  it.each(RPC_URLS)('accepts the official Testnet endpoint %s', url => {
    expect(() => xlayerClient(url)).not.toThrow();
  });
  it('defaults to an official endpoint', () => {
    expect(() => xlayerClient()).not.toThrow();
    expect(() => new XLayerRpc()).not.toThrow();
  });
  it.each([
    'https://rpc.xlayer.tech', 'https://rpc.example.com', 'http://testrpc.xlayer.tech/terigon', 'https://testrpc.xlayer.tech/terigon/',
    'https://testrpc.xlayer.tech/terigon?x=1', 'https://user:pw@testrpc.xlayer.tech/terigon', 'http://127.0.0.1:8545', '',
  ])('rejects the unapproved endpoint %j', url => {
    expect(() => xlayerClient(url)).toThrow(/unapproved X Layer RPC endpoint/);
  });
});

describe('X Layer RPC network and asset identity', () => {
  it('accepts chain id 1952 and rejects any other chain', async () => {
    await expect(stub({ getChainId: async () => CHAIN_ID }).assertNetwork()).resolves.toBeUndefined();
    await expect(stub({ getChainId: async () => 196 }).assertNetwork()).rejects.toThrow(/chain id mismatch/);
    await expect(stub({ getChainId: async () => 1 }).assertNetwork()).rejects.toThrow(/chain id mismatch/);
  });

  it('retries a transient read failure but reports persistent failure as unavailable, not as a mismatch', async () => {
    const flaky = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(CHAIN_ID);
    await expect(stub({ getChainId: flaky }).assertNetwork()).resolves.toBeUndefined();
    expect(flaky).toHaveBeenCalledTimes(3);

    const dead = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(stub({ getChainId: dead }).assertNetwork()).rejects.toThrow(/independent read unavailable/);
    expect(dead).toHaveBeenCalledTimes(3);
  });

  const asset = (over: { code?: string | undefined; decimals?: number; symbol?: string } = {}) => {
    const readContract = vi.fn(async ({ functionName }: { functionName: string; address?: string }) => {
      if (functionName === 'decimals') return over.decimals ?? 6;
      if (functionName === 'symbol') return over.symbol ?? TOKEN_SYMBOL;
      throw new Error('unexpected ' + functionName);
    });
    const getCode = vi.fn(async () => ('code' in over ? over.code : '0x6080'));
    return { rpc: stub({ getCode, readContract }), getCode, readContract };
  };

  it('accepts the pinned USD₮0 contract with code, 6 decimals and its on-chain symbol', async () => {
    const a = asset();
    await expect(a.rpc.assertAsset()).resolves.toBeUndefined();
    expect(a.getCode).toHaveBeenCalledWith({ address: TOKEN });
    expect(a.readContract.mock.calls.every(([call]) => call.address === TOKEN)).toBe(true);
    expect(TOKEN_SYMBOL).toBe('USD₮0');
  });

  it.each([
    ['5 decimals', { decimals: 5 }], ['18 decimals', { decimals: 18 }],
    ['ASCII-T symbol lookalike', { symbol: 'USDT0' }], ['plain USDT', { symbol: 'USDT' }], ['empty symbol', { symbol: '' }],
    ['no contract code (0x)', { code: '0x' }], ['no contract code (undefined)', { code: undefined }],
  ])('rejects an asset with %s', async (_name, over) => {
    await expect(asset(over).rpc.assertAsset()).rejects.toThrow(/metadata unavailable or mismatched/);
  });
});

describe('X Layer RPC transaction and receipt reads', () => {
  const viemTx = { hash: HASH, from: ADDR, to: TOKEN.toUpperCase().replace('0X', '0x'), input: '0xa9059cbb', nonce: 7, chainId: 1952, blockNumber: 1234n };

  it('normalizes a transaction (lowercase addresses, nullable chain id and block)', async () => {
    const getTransaction = vi.fn().mockResolvedValueOnce(viemTx).mockResolvedValueOnce({ ...viemTx, chainId: undefined, blockNumber: null, to: null });
    const rpc = stub({ getTransaction });
    expect(await rpc.transaction(HASH)).toEqual({ hash: HASH, from: ADDR.toLowerCase(), to: TOKEN, input: '0xa9059cbb', nonce: 7, chainId: 1952, blockNumber: 1234n });
    expect(await rpc.transaction(HASH)).toMatchObject({ chainId: null, blockNumber: null, to: null });
    expect(getTransaction).toHaveBeenCalledWith({ hash: HASH });
  });

  it('maps only viem not-found errors to null and everything else to unavailable', async () => {
    const getTransaction = vi.fn()
      .mockRejectedValueOnce(new TransactionNotFoundError({ hash: HASH }))
      .mockRejectedValueOnce(new TransactionReceiptNotFoundError({ hash: HASH }))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce({ code: 'NOT_FOUND', name: 'TransactionNotFoundError' });
    const rpc = stub({ getTransaction });
    expect(await rpc.transaction(HASH)).toBeNull();
    await expect(rpc.transaction(HASH)).rejects.toThrow(/transaction read unavailable/);
    await expect(rpc.transaction(HASH)).rejects.toThrow(/transaction read unavailable/);
    await expect(rpc.transaction(HASH)).rejects.toThrow(/transaction read unavailable/);
    expect(getTransaction).toHaveBeenCalledTimes(4); // an absence/timeout is reported, never retried into a guess
  });

  it('normalizes a receipt with lowercase addresses and copied logs', async () => {
    const topics = [TRANSFER_TOPIC, '0x' + '0'.repeat(24) + 'ab'.repeat(20)];
    const getTransactionReceipt = vi.fn().mockResolvedValue({
      transactionHash: HASH, status: 'success', blockNumber: 1234n, blockHash: '0x' + '12'.repeat(32), from: ADDR, to: TOKEN,
      gasUsed: 51000n, effectiveGasPrice: 1000000000n,
      logs: [{ address: TOKEN.toUpperCase().replace('0X', '0x'), topics, data: '0x' + '0'.repeat(63) + '1', logIndex: 2 }],
    });
    const receipt = await stub({ getTransactionReceipt }).receipt(HASH);
    expect(receipt).toMatchObject({ hash: HASH, status: 'success', blockNumber: 1234n, from: ADDR.toLowerCase(), to: TOKEN, gasUsed: 51000n, effectiveGasPrice: 1000000000n });
    expect(receipt!.logs).toEqual([{ address: TOKEN, topics, data: '0x' + '0'.repeat(63) + '1', logIndex: 2 }]);
    expect(receipt!.logs[0]!.topics).not.toBe(topics);
  });

  it('maps a missing receipt to null but a receipt read failure to unavailable', async () => {
    const getTransactionReceipt = vi.fn()
      .mockRejectedValueOnce(new TransactionReceiptNotFoundError({ hash: HASH }))
      .mockRejectedValueOnce(new TransactionNotFoundError({ hash: HASH }))
      .mockRejectedValueOnce(new Error('503'));
    const rpc = stub({ getTransactionReceipt });
    expect(await rpc.receipt(HASH)).toBeNull();
    await expect(rpc.receipt(HASH)).rejects.toThrow(/receipt read unavailable/);
    await expect(rpc.receipt(HASH)).rejects.toThrow(/receipt read unavailable/);
  });

  it('behaves identically against a real viem client over a JSON-RPC transport', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return '0x7a0';
      if (method === 'eth_getTransactionByHash' || method === 'eth_getTransactionReceipt') return null;
      throw new Error('unexpected ' + method);
    });
    const rpc = new XLayerRpc(createPublicClient({ transport: custom({ request }) }));
    await expect(rpc.assertNetwork()).resolves.toBeUndefined();
    expect(await rpc.transaction(HASH)).toBeNull();
    expect(await rpc.receipt(HASH)).toBeNull();

    const failing = new XLayerRpc(createPublicClient({ transport: custom({ request: async () => { throw new Error('socket hang up'); } }) }));
    await expect(failing.transaction(HASH)).rejects.toThrow(/transaction read unavailable/);
    await expect(failing.receipt(HASH)).rejects.toThrow(/receipt read unavailable/);
  });
});

describe('X Layer RPC chain state reads', () => {
  it('converts block timestamps to milliseconds and reads the head', async () => {
    const getBlock = vi.fn(async () => ({ timestamp: 1_790_000_000n }));
    const rpc = stub({ getBlock, getBlockNumber: async () => 4242n });
    expect(await rpc.blockTimestampMs(99n)).toBe(1_790_000_000_000);
    expect(getBlock).toHaveBeenCalledWith({ blockNumber: 99n });
    expect(await rpc.latestBlock()).toBe(4242n);
  });

  it('reads the pending nonce view by default and the historical view for a block', async () => {
    const getTransactionCount = vi.fn(async () => 5);
    const rpc = stub({ getTransactionCount });
    expect(await rpc.transactionCount(ADDR)).toBe(5);
    expect(getTransactionCount).toHaveBeenLastCalledWith({ address: ADDR, blockTag: 'pending' });
    expect(await rpc.transactionCount(ADDR, 77n)).toBe(5);
    expect(getTransactionCount).toHaveBeenLastCalledWith({ address: ADDR, blockNumber: 77n });
    expect(await rpc.transactionCount(ADDR, 0n)).toBe(5); // block 0 is a historical read, not "pending"
    expect(getTransactionCount).toHaveBeenLastCalledWith({ address: ADDR, blockNumber: 0n });
  });

  it('reads token and native balances and the gas estimate against the pinned token', async () => {
    const readContract = vi.fn(async () => 123n);
    const getBalance = vi.fn(async () => 456n);
    const estimateGas = vi.fn(async () => 51_000n);
    const rpc = stub({ readContract, getBalance, estimateGas });
    expect(await rpc.tokenBalance(ADDR)).toBe(123n);
    expect(readContract).toHaveBeenCalledWith(expect.objectContaining({ address: TOKEN, functionName: 'balanceOf', args: [ADDR] }));
    expect(await rpc.nativeBalance(ADDR)).toBe(456n);
    expect(await rpc.estimateTransferGas(ADDR, '0xa9059cbb')).toBe(51_000n);
    expect(estimateGas).toHaveBeenCalledWith({ account: ADDR, to: TOKEN, data: '0xa9059cbb' });
  });

  it('derives EIP-1559 caps as 2x base fee plus tip, and refuses a chain without a base fee', async () => {
    const tip = vi.fn(async () => 7n);
    const rpc = stub({ getBlock: async () => ({ baseFeePerGas: 100n }), estimateMaxPriorityFeePerGas: tip });
    expect(await rpc.feeCaps()).toEqual({ maxFeePerGas: 207n, maxPriorityFeePerGas: 7n });
    await expect(stub({ getBlock: async () => ({ baseFeePerGas: null }), estimateMaxPriorityFeePerGas: tip }).feeCaps()).rejects.toThrow(/base fee unavailable/);
    await expect(stub({ getBlock: async () => ({}), estimateMaxPriorityFeePerGas: tip }).feeCaps()).rejects.toThrow(/base fee unavailable/);
  });

  it('broadcasts the serialized bytes unchanged and never swallows a broadcast failure', async () => {
    const sendRawTransaction = vi.fn().mockResolvedValueOnce(HASH).mockRejectedValueOnce(new Error('already known'));
    const rpc = stub({ sendRawTransaction });
    await expect(rpc.sendRaw('0x02abcd')).resolves.toBeUndefined();
    expect(sendRawTransaction).toHaveBeenCalledWith({ serializedTransaction: '0x02abcd' });
    await expect(rpc.sendRaw('0x02abcd')).rejects.toThrow(/already known/);
    expect(sendRawTransaction).toHaveBeenCalledTimes(2); // writes are never retried
  });
});
