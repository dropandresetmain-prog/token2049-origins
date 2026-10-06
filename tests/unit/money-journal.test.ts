import { describe, it, expect } from 'vitest';
import { parseDecimalToMinor, rescaleMinor, rescaleMinorCeil, money, addMoney, compareMoney, formatMinor, Money } from '../../src/contracts/money.js';
import { Db } from '../../src/infrastructure/db.js';
import { postEntry, trialBalance, JournalError, Accounts } from '../../src/core/journal.js';
import { redact } from '../../src/infrastructure/redact.js';

describe('money', () => {
  it('parses provider decimals exactly and refuses silent rounding', () => {
    expect(parseDecimalToMinor('569.4', 2)).toBe(56940n);
    expect(parseDecimalToMinor(0.1 + 0.2 === 0.30000000000000004 ? '0.30' : '0', 2)).toBe(30n);
    expect(parseDecimalToMinor(123.45, 2)).toBe(12345n);
    expect(() => parseDecimalToMinor('1.005', 2)).toThrow(/precision/);
    expect(() => parseDecimalToMinor('abc', 2)).toThrow();
  });
  it('rescales exactly; ceil only where explicitly asked', () => {
    expect(rescaleMinor(4999n, 2, 6)).toBe(49_990_000n);
    expect(() => rescaleMinor(1n, 6, 2)).toThrow();
    expect(rescaleMinorCeil(1n, 6, 2)).toBe(1n);
  });
  it('rejects unit mismatch and negative money', () => {
    expect(() => addMoney(money('USD', 1), money('SGD', 1))).toThrow();
    expect(() => compareMoney(money('USD', 1, 2), money('USD', 1, 3))).toThrow();
    expect(() => money('USD', -1)).toThrow();
    expect(formatMinor(money('USD', 5))).toBe('0.05 USD');
  });
  it('schema rejects floats and non-integer strings', () => {
    expect(Money.safeParse({ currency: 'USD', amountMinor: '12.5', scale: 2 }).success).toBe(false);
    expect(Money.safeParse({ currency: 'USD', amountMinor: 1250, scale: 2 }).success).toBe(false);
    expect(Money.safeParse({ currency: 'usd', amountMinor: '1250', scale: 2 }).success).toBe(false);
    expect(Money.safeParse({ currency: 'USD', amountMinor: '1250', scale: 2 }).success).toBe(true);
  });
});

describe('journal', () => {
  const now = '2026-10-06T12:00:00.000Z';
  const A = 'cardano:preprod/x.y';
  it('rejects unbalanced entries and mixed ledger modes', () => {
    const db = new Db(':memory:');
    expect(() =>
      postEntry(db, { eventKey: 'e1', purchaseId: null, kind: 'k', ledgerMode: 'observed', description: 'd', lines: [
        { account: Accounts.cryptoTreasury, asset: A, side: 'debit', amount: 10n },
        { account: Accounts.customerPrepayment, asset: A, side: 'credit', amount: 9n },
      ] }, now),
    ).toThrow(JournalError);
    expect(() =>
      postEntry(db, { eventKey: 'e2', purchaseId: null, kind: 'k', ledgerMode: 'observed', description: 'd', lines: [
        { account: Accounts.merchantPurchases, asset: 'fiat:USD/2', side: 'debit', amount: 10n },
        { account: Accounts.cardPayable, asset: 'fiat:USD/2', side: 'credit', amount: 10n },
      ] }, now),
    ).toThrow(/not allowed/);
  });
  it('is idempotent per event key and immutable', () => {
    const db = new Db(':memory:');
    const entry = { eventKey: 'e3', purchaseId: null, kind: 'k', ledgerMode: 'observed' as const, description: 'd', lines: [
      { account: Accounts.cryptoTreasury, asset: A, side: 'debit' as const, amount: 10n },
      { account: Accounts.customerPrepayment, asset: A, side: 'credit' as const, amount: 10n },
    ] };
    expect(postEntry(db, entry, now).duplicate).toBe(false);
    expect(postEntry(db, entry, now).duplicate).toBe(true);
    expect(() => postEntry(db, { ...entry, lines: entry.lines.map((l) => ({ ...l, amount: 11n })) }, now)).toThrow(/different lines/);
    expect(() => db.run('UPDATE journal_lines SET amount = ?', '1')).toThrow(/immutable/);
    expect(() => db.run('DELETE FROM journal_entries')).toThrow(/immutable/);
    expect([...trialBalance(db).values()].every((v) => v === 0n)).toBe(true);
  });
});

describe('redaction', () => {
  it('masks secrets and PII by key and by value pattern', () => {
    const out = redact({
      authorization: 'Bearer abc.def',
      apiKey: 'sand_1234567890abcdef',
      note: 'card 4242 4242 4242 4242 email a.b@example.com token tok_abcdefghijk',
      holder: { firstName: 'Ada' },
      passengers: [{ passport: 'X123' }],
      providerReference: 'ORDER-1',
      nested: { mnemonic: 'abandon abandon' },
    });
    const s = JSON.stringify(out);
    expect(s).not.toMatch(/abc\.def|sand_1234|4242 4242|a\.b@example|tok_abcdefghijk|Ada|X123|abandon/);
    expect(s).toContain('ORDER-1');
  });
});
