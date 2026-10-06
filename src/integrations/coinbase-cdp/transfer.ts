import { existsSync } from 'node:fs';
import { CdpClient } from '@coinbase/cdp-sdk';
import { CDP_CHAIN_ID, CDP_EXPLORER, CDP_MAX_TOTAL_WEI, CDP_NETWORK, CDP_TRANSFER_WEI, validateTransfer } from './contracts.js';
import type { CdpActionHistory, CdpPublicIdentity, CdpSettings } from './contracts.js';
import { readHistory, withHistoryLock, writeHistoryAtomic } from './history.js';

interface RpcTransaction {
  from: string;
  to: string | null;
  value: string;
  chainId: string | null;
}

interface RpcReceipt {
  status: string;
  transactionHash: string;
}

export interface CdpRpc {
  transaction(hash: string): Promise<RpcTransaction | null>;
  receipt(hash: string): Promise<RpcReceipt | null>;
}

export class PublicBaseSepoliaRpc implements CdpRpc {
  private sequence = 0;

  constructor(private readonly url = 'https://sepolia.base.org') {}

  private async call<T>(method: string, params: unknown[]): Promise<T | null> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.sequence, method, params }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error('Base Sepolia readback is unavailable');
    const body = await response.json() as { result?: T | null };
    return body.result ?? null;
  }

  transaction(hash: string): Promise<RpcTransaction | null> {
    return this.call('eth_getTransactionByHash', [hash]);
  }

  receipt(hash: string): Promise<RpcReceipt | null> {
    return this.call('eth_getTransactionReceipt', [hash]);
  }
}

function update(history: CdpActionHistory, patch: Partial<CdpActionHistory>): CdpActionHistory {
  return { ...history, ...patch, updatedAt: new Date().toISOString() };
}

async function verifyOnChain(rpc: CdpRpc, history: CdpActionHistory): Promise<boolean> {
  if (!history.txHash) return false;
  const [transaction, receipt] = await Promise.all([rpc.transaction(history.txHash), rpc.receipt(history.txHash)]);
  if (!transaction || !receipt) return false;
  const matches = transaction.from.toLowerCase() === history.treasuryAddress.toLowerCase()
    && transaction.to?.toLowerCase() === history.recipientAddress.toLowerCase()
    && BigInt(transaction.value) === CDP_TRANSFER_WEI
    && transaction.chainId !== null
    && BigInt(transaction.chainId) === BigInt(CDP_CHAIN_ID)
    && receipt.transactionHash.toLowerCase() === history.txHash.toLowerCase();
  if (!matches) throw new Error('Base Sepolia transaction does not match the reserved Capsule action; operator reconciliation required');
  if (receipt.status !== '0x1') throw new Error('Base Sepolia transfer reverted; reservation remains held for operator review');
  return true;
}

export async function executeTestTransfer(
  client: CdpClient,
  settings: CdpSettings,
  identity: CdpPublicIdentity,
  rpc: CdpRpc = new PublicBaseSepoliaRpc(settings.rpcUrl),
): Promise<CdpActionHistory> {
  validateTransfer(CDP_TRANSFER_WEI, CDP_NETWORK, identity.treasuryAddress, identity.recipientAddress);
  if (!existsSync(settings.historyFile)) throw new Error('CDP action history is missing; provision once before transfers');
  return withHistoryLock(settings.historyFile, async () => {
    let history = readHistory(settings.historyFile, identity);
    if (history.status === 'confirmed') throw new Error('the one-time CDP test transfer has already completed');
    if (history.status === 'submitted' && history.txHash) {
      if (await verifyOnChain(rpc, history)) {
        history = update(history, { status: 'confirmed' });
        writeHistoryAtomic(settings.historyFile, history);
      }
      return history;
    }
    if (history.status === 'pending' || history.status === 'unknown') {
      throw new Error('CDP transfer outcome is unknown without a transaction hash; reservation remains held for read-only operator reconciliation');
    } else {
      if (history.status !== 'idle' || history.attempted) throw new Error('CDP transfer reservation is inconsistent; operator reconciliation required');
      if (CDP_TRANSFER_WEI > CDP_MAX_TOTAL_WEI) throw new Error('CDP cumulative test transfer limit reached');
      history = update(history, { attempted: true, status: 'pending', txHash: null });
      writeHistoryAtomic(settings.historyFile, history);
    }

    let transactionHash: `0x${string}`;
    try {
      const account = await client.evm.getAccount({ address: identity.treasuryAddress });
      const scoped = await account.useNetwork(CDP_NETWORK);
      const result = await scoped.sendTransaction({
        transaction: { to: identity.recipientAddress, value: CDP_TRANSFER_WEI },
        idempotencyKey: history.idempotencyKey,
      });
      transactionHash = result.transactionHash;
    } catch {
      history = update(history, { status: 'unknown' });
      writeHistoryAtomic(settings.historyFile, history);
      throw new Error('CDP transfer result is unknown; reservation is held. Re-run only this same explicit test action to recover its idempotent result.');
    }

    history = update(history, { status: 'submitted', txHash: transactionHash });
    writeHistoryAtomic(settings.historyFile, history);
    if (await verifyOnChain(rpc, history)) {
      history = update(history, { status: 'confirmed' });
      writeHistoryAtomic(settings.historyFile, history);
    }
    return history;
  });
}

export function transactionExplorerUrl(hash: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error('transaction hash is invalid');
  return `${CDP_EXPLORER}/tx/${hash}`;
}
