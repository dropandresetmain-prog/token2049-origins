import type { SolanaLedgerEntry } from './ledger.js';
import type { SolanaRpc } from '../../src/funding/solana/rpc.js';

/** Both ledgers reserve before signing and retain the exact candidate after an ambiguous outcome. */
export interface SolanaLedgerPort {
  read(): SolanaLedgerEntry[] | Promise<SolanaLedgerEntry[]>;
  upsert(entry: SolanaLedgerEntry): void | Promise<void>;
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  assertCaps(amount: bigint, fee: bigint, maxAmount: bigint, maxFee: bigint): void | Promise<void>;
  reconcile(rpc: SolanaRpc): Promise<void>;
}
