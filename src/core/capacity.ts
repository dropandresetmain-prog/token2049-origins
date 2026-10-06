import type { Db } from '../infrastructure/db.js';
import { Accounts, accountBalance, fiatAsset } from './journal.js';

/**
 * Explicitly simulated fiat/card purchasing capacity. NOT an OCBC balance.
 * available = limit - (active + held_unresolved reservations) - outstanding simulated card payable.
 * A consumed reservation moves into card payable or provider test-balance usage, without double counting.
 */
export interface CapacitySnapshot {
  currency: string;
  scale: number;
  limitMinor: bigint;
  reservedMinor: bigint;
  cardPayableMinor: bigint;
  providerTestBalanceUsedMinor: bigint;
  availableMinor: bigint;
  ledgerMode: 'simulated';
}

export function seedCapacityPool(db: Db, currency: string, scale: number, limitMinor: bigint, nowIso: string): void {
  db.run(
    `INSERT INTO capacity_pools(currency, scale, limit_minor, ledger_mode, description, created_at)
     VALUES (?,?,?,'simulated',?,?)
     ON CONFLICT(currency) DO UPDATE SET limit_minor = excluded.limit_minor, scale = excluded.scale`,
    currency,
    scale,
    limitMinor.toString(),
    'Synthetic sandbox card capacity for demo purchases; not a bank balance.',
    nowIso,
  );
}

export function capacitySnapshot(db: Db, currency: string): CapacitySnapshot | null {
  const pool = db.get<{ currency: string; scale: number; limit_minor: string }>(
    'SELECT currency, scale, limit_minor FROM capacity_pools WHERE currency = ?',
    currency,
  );
  if (!pool) return null;
  const reserved = db
    .all<{ amount_minor: string }>(
      "SELECT amount_minor FROM reservations WHERE currency = ? AND status IN ('active','held_unresolved')",
      currency,
    )
    .reduce((s, r) => s + BigInt(r.amount_minor), 0n);
  // card payable is a credit-balance liability: negate debit-positive balance
  const payable = -accountBalance(db, Accounts.cardPayable, fiatAsset(currency, pool.scale));
  const testBalanceUsed = -accountBalance(db, Accounts.providerTestBalanceUsed, fiatAsset(currency, pool.scale));
  const limit = BigInt(pool.limit_minor);
  return {
    currency,
    scale: pool.scale,
    limitMinor: limit,
    reservedMinor: reserved,
    cardPayableMinor: payable,
    providerTestBalanceUsedMinor: testBalanceUsed,
    availableMinor: limit - reserved - payable - testBalanceUsed,
    ledgerMode: 'simulated',
  };
}
