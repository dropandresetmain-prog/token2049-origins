import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { SuiClientTypes } from '@mysten/sui/client';
import { normalizeStructTag } from '@mysten/sui/utils';
import { Transaction } from '@mysten/sui/transactions';
import { NETWORK, RPC_URL, TESTNET_GENESIS, USDC_TYPE, SUI_TYPE } from './config.js';

const include = { bcs: true, effects: true, balanceChanges: true } as const;
export type ChainTransaction = SuiClientTypes.Transaction<typeof include>;
export interface SuiRpcPort {
  assertNetwork(): Promise<void>;
  assertAsset(): Promise<void>;
  assertPaymentObjects(bytes: Uint8Array): Promise<void>;
  transaction(digest: string): Promise<ChainTransaction | null>;
  execute(bytes: Uint8Array, signature: string): Promise<void>;
}
export function suiClient() { return new SuiGrpcClient({ network: 'testnet', baseUrl: RPC_URL, format: 'binary' }); }
async function retryRead<T>(read: () => Promise<T>, valid: (result: T) => boolean = () => true): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { const result = await read(); if (valid(result)) return result; } catch { /* Read-only transient fullnode failures may be retried. */ }
    if (attempt < 2) await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
  }
  throw new Error('Sui independent readiness read unavailable');
}
export class SuiRpc implements SuiRpcPort {
  constructor(readonly client = suiClient()) {}
  async assertNetwork() {
    const { chainIdentifier } = await retryRead(() => this.client.getChainIdentifier({ signal: AbortSignal.timeout(8000) }));
    if (chainIdentifier !== TESTNET_GENESIS) throw new Error(`${NETWORK} genesis mismatch`);
  }
  async assertAsset() {
    const { coinMetadata } = await retryRead(() => this.client.getCoinMetadata({ coinType: USDC_TYPE, signal: AbortSignal.timeout(8000) }), r => r.coinMetadata !== null);
    if (!coinMetadata || coinMetadata.decimals !== 6 || coinMetadata.symbol !== 'USDC') throw new Error('Circle Testnet USDC metadata unavailable or mismatched');
  }
  async transaction(digest: string): Promise<ChainTransaction | null> {
    try {
      const result = await this.client.getTransaction({ digest, include, signal: AbortSignal.timeout(15000) });
      return result.Transaction ?? result.FailedTransaction;
    } catch (error) {
      if ((error as { code?: string }).code === 'NOT_FOUND') return null;
      throw new Error('Sui transaction read unavailable');
    }
  }
  async assertPaymentObjects(bytes: Uint8Array) {
    const d = Transaction.from(bytes).getData();
    const refs = [...d.inputs.flatMap(i => i.Object?.ImmOrOwnedObject ? [{ ...i.Object.ImmOrOwnedObject, asset: USDC_TYPE }] : []),
      ...d.gasData.payment!.map(g => ({ ...g, asset: SUI_TYPE }))];
    const objects = refs.length ? (await this.client.getObjects({ objectIds: refs.map(r => r.objectId), signal: AbortSignal.timeout(15000) })).objects : [];
    if (objects.length !== refs.length) throw new Error('Sui coin objects unavailable');
    objects.forEach((o, i) => {
      const ref = refs[i]!;
      if (o instanceof Error || o.objectId !== ref.objectId || o.version !== ref.version || o.digest !== ref.digest ||
          o.owner.$kind !== 'AddressOwner' || o.owner.AddressOwner !== d.sender ||
          normalizeStructTag(o.type) !== normalizeStructTag(`0x2::coin::Coin<${ref.asset}>`)) throw new Error('Sui coin ownership, type or version mismatch');
    });
    if (!d.gasData.payment!.length) {
      const { balance } = await this.client.getBalance({ owner: d.sender!, coinType: SUI_TYPE, signal: AbortSignal.timeout(15000) });
      if (BigInt(balance.addressBalance) < BigInt(d.gasData.budget!)) throw new Error('Sui gas address balance insufficient');
    }
    const withdrawal = d.inputs.find(i => i.FundsWithdrawal)?.FundsWithdrawal;
    if (withdrawal) {
      const { balance } = await this.client.getBalance({ owner: d.sender!, coinType: USDC_TYPE, signal: AbortSignal.timeout(15000) });
      if (BigInt(balance.addressBalance) < BigInt(withdrawal.reservation.MaxAmountU64!)) throw new Error('USDC address balance insufficient');
    }
  }
  async execute(bytes: Uint8Array, signature: string) {
    // A timeout does not establish failure. Recovery checks this digest before any exact-byte resubmission.
    await this.client.executeTransaction({ transaction: bytes, signatures: [signature], signal: AbortSignal.timeout(25000) });
  }
}
