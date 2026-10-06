import type { Db } from '../infrastructure/db.js';
import { newId } from '../infrastructure/ids.js';

/**
 * Chart of accounts. Assets are identified exactly:
 *   crypto: `<network>/<assetId>` in base units
 *   fiat:   `fiat:<CUR>/<scale>` in minor units
 *
 * Observed ledger (externally verified facts):
 *   assets:crypto_treasury            DR when testnet funding is independently verified
 *   liabilities:customer_prepayment   CR when funding is applied to a purchase (deliver or refund)
 *   liabilities:customer_unapplied    CR when funding arrives that cannot be applied (duplicate/overpay/late)
 *   income:purchase_principal_applied CR when a purchase completes and the prepayment is earned
 *   income:service_fee                CR fee portion on completion
 *
 * Simulated ledger (explicitly synthetic fiat/card capacity; never OCBC cash):
 *   simulated:merchant_purchases      DR when a provider reports the merchant payment
 *   simulated:card_payable            CR same event — card liability, NOT a bank debit
 */
export const Accounts = {
  cryptoTreasury: 'assets:crypto_treasury',
  customerPrepayment: 'liabilities:customer_prepayment',
  customerUnapplied: 'liabilities:customer_unapplied',
  principalApplied: 'income:purchase_principal_applied',
  serviceFee: 'income:service_fee',
  merchantPurchases: 'simulated:merchant_purchases',
  cardPayable: 'simulated:card_payable',
} as const;

export const SIMULATED_ACCOUNTS = new Set<string>([Accounts.merchantPurchases, Accounts.cardPayable]);

export function cryptoAsset(network: string, assetId: string): string {
  return `${network}/${assetId}`;
}
export function fiatAsset(currency: string, scale: number): string {
  return `fiat:${currency}/${scale}`;
}

export interface JournalLine {
  account: string;
  asset: string;
  side: 'debit' | 'credit';
  amount: bigint;
}

export interface JournalEntryInput {
  eventKey: string;
  purchaseId: string | null;
  kind: string;
  ledgerMode: 'observed' | 'simulated';
  description: string;
  externalReference?: string | null;
  lines: JournalLine[];
}

export class JournalError extends Error {}

function assertBalanced(input: JournalEntryInput): void {
  if (input.lines.length < 2) throw new JournalError('entry needs at least two lines');
  const sums = new Map<string, bigint>();
  for (const l of input.lines) {
    if (l.amount <= 0n) throw new JournalError('line amounts must be positive');
    const simulatedAccount = SIMULATED_ACCOUNTS.has(l.account);
    if (simulatedAccount !== (input.ledgerMode === 'simulated')) {
      throw new JournalError(`account ${l.account} not allowed in ${input.ledgerMode} entry`);
    }
    const d = l.side === 'debit' ? l.amount : -l.amount;
    sums.set(l.asset, (sums.get(l.asset) ?? 0n) + d);
  }
  for (const [asset, s] of sums) {
    if (s !== 0n) throw new JournalError(`entry unbalanced for ${asset}: ${s}`);
  }
}

/**
 * Post an immutable balanced entry. Idempotent by eventKey: a repeat with identical lines is a no-op;
 * a repeat with different lines is an error (never silently "fixed").
 * Must be called inside a Db.tx for atomicity with the state change it records.
 */
export function postEntry(db: Db, input: JournalEntryInput, nowIso: string): { entryId: string; duplicate: boolean } {
  assertBalanced(input);
  const existing = db.get<{ id: string }>('SELECT id FROM journal_entries WHERE event_key = ?', input.eventKey);
  if (existing) {
    const lines = db.all<{ account: string; asset: string; side: string; amount: string }>(
      'SELECT account, asset, side, amount FROM journal_lines WHERE entry_id = ? ORDER BY id',
      existing.id,
    );
    const same =
      lines.length === input.lines.length &&
      lines.every(
        (l, i) =>
          l.account === input.lines[i]!.account &&
          l.asset === input.lines[i]!.asset &&
          l.side === input.lines[i]!.side &&
          l.amount === input.lines[i]!.amount.toString(),
      );
    if (!same) throw new JournalError(`event ${input.eventKey} already posted with different lines`);
    return { entryId: existing.id, duplicate: true };
  }
  const entryId = newId('jen');
  db.run(
    `INSERT INTO journal_entries(id, event_key, purchase_id, kind, ledger_mode, description, external_reference, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    entryId,
    input.eventKey,
    input.purchaseId,
    input.kind,
    input.ledgerMode,
    input.description,
    input.externalReference ?? null,
    nowIso,
  );
  for (const l of input.lines) {
    db.run(
      'INSERT INTO journal_lines(entry_id, account, asset, side, amount) VALUES (?,?,?,?,?)',
      entryId,
      l.account,
      l.asset,
      l.side,
      l.amount.toString(),
    );
  }
  return { entryId, duplicate: false };
}

/** Debit-positive balance of an account in one asset. */
export function accountBalance(db: Db, account: string, asset: string): bigint {
  const rows = db.all<{ side: string; amount: string }>(
    'SELECT side, amount FROM journal_lines WHERE account = ? AND asset = ?',
    account,
    asset,
  );
  return rows.reduce((s, r) => s + (r.side === 'debit' ? BigInt(r.amount) : -BigInt(r.amount)), 0n);
}

/** Trial balance per asset across the whole journal: every asset must net to zero. */
export function trialBalance(db: Db): Map<string, bigint> {
  const rows = db.all<{ asset: string; side: string; amount: string }>('SELECT asset, side, amount FROM journal_lines');
  const m = new Map<string, bigint>();
  for (const r of rows) m.set(r.asset, (m.get(r.asset) ?? 0n) + (r.side === 'debit' ? BigInt(r.amount) : -BigInt(r.amount)));
  return m;
}

export function entriesForPurchase(db: Db, purchaseId: string) {
  const entries = db.all<{ id: string; event_key: string; kind: string; ledger_mode: string; created_at: string }>(
    'SELECT id, event_key, kind, ledger_mode, created_at FROM journal_entries WHERE purchase_id = ? ORDER BY created_at, id',
    purchaseId,
  );
  return entries.map((e) => ({
    ...e,
    lines: db.all<{ account: string; asset: string; side: string; amount: string }>(
      'SELECT account, asset, side, amount FROM journal_lines WHERE entry_id = ? ORDER BY id',
      e.id,
    ),
  }));
}
