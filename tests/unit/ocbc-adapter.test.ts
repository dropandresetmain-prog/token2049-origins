import { describe, expect, it } from 'vitest';
import { createOcbcAdapter } from '../../src/banking/ocbc/adapter.js';
import { OCBC_APIS, parseOcbcConfig } from '../../src/banking/ocbc/client.js';
import { maskReference } from '../../src/banking/ocbc/mask.js';
import { parseAccountListing, parseAccountTransactions, parseCardList, parseCardTransactions } from '../../src/banking/ocbc/normalize.js';
import { ManualClock } from '../../src/infrastructure/clock.js';

const credentials = {
  OCBC_API_CLIENT_ID: 'test-client-id',
  OCBC_API_CLIENT_SECRET: 'do-not-return-this-secret',
} as NodeJS.ProcessEnv;

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('OCBC normalization', () => {
  it('masks raw and short references while retaining only the last four safe characters', () => {
    expect(maskReference('1234567890123456')).toBe('****3456');
    expect(maskReference('AB-12345678')).toBe('****5678');
    expect(maskReference('123456')).toBe('****');
    expect(maskReference('******12')).toBe('****');
  });

  it('normalizes account/card rows without returning raw identifiers or guessing currency', () => {
    const accounts = parseAccountListing({
      success: true,
      results: [{ accountId: 'raw-account-12345678', accountMaskedNumber: '123456789012', balance: { currencyCode: 'SGD', ledgerBalance: '12.30', availableBalance: 10, balanceAsOfDate: '2026-10-05' } }],
    });
    expect(accounts?.items[0]).toMatchObject({
      maskedReference: '****9012',
      currency: 'SGD',
      ledger: { currency: 'SGD', amountMinor: '1230', scale: 2 },
      available: { currency: 'SGD', amountMinor: '1000', scale: 2 },
      providerTimestamp: '2026-10-05T00:00:00.000Z',
    });
    // Raw IDs exist only inside this adapter-only normalized row for follow-up reads.
    expect(accounts?.items[0]?.rawId).toBe('raw-account-12345678');

    const cards = parseCardList({
      Success: true,
      Result: { cardId: 'card-identifier-1234', maskedCardNo: '1234567890121234', amountDue: '4.50', availableBalance: '90.00', unbilledAmount: '2.00' },
    });
    expect(cards?.items[0]).toMatchObject({ maskedReference: '****1234', currency: 'XXX', currencyStated: false });
    expect(cards?.items[0]?.amountDue?.amountMinor).toBe('450');
    expect(cards?.items[0]?.rawId).toBe('card-identifier-1234');
  });

  it('uses provider direction and omits ambiguous or inexact transactions', () => {
    const accounts = parseAccountTransactions({
      success: true,
      results: [
        { amount: '1.23', currencyCode: 'SGD', transactionDate: '06-10-2026', debitCreditIndicator: 'D', description: 'CARD 4111 1111 1111 1111' },
        { amount: '7.00', currencyCode: 'SGD', transactionDate: '2026-10-06', debitCreditIndicator: '', description: 'unknown direction' },
        { amount: '1.005', currencyCode: 'SGD', transactionDate: '2026-10-06', debitCreditIndicator: 'C' },
      ],
    });
    expect(accounts?.items).toHaveLength(1);
    expect(accounts?.items[0]).toMatchObject({ direction: 'debit', amount: { amountMinor: '123' } });
    expect(accounts?.items[0]?.description).toBe('CARD [REDACTED_NUMBER]');
    expect(accounts?.skipped).toBe(2);

    const cards = parseCardTransactions({
      success: true,
      results: { creditCardTransactions: [{ creditCardTransactionDetail: [{ transactionAmount: '2.50', currencyCode: 'XXX', transactionDate: '20261006', transactionDescription: 'Cafe' }] }] },
    });
    expect(cards?.items[0]).toMatchObject({ direction: null, currency: 'XXX', amount: { amountMinor: '250' } });
  });
});

describe('OCBC read-only client and adapter', () => {
  it('reads the verified account-history resource and preserves provider failures', async () => {
    const calls: URL[] = [];
    let historyFails = false;
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname === '/token') return response({ access_token: 'temporary-app-token', expires_in: 3600 });
      if (url.pathname === '/transactional/corporateAccountListing/1.0') {
        return response({ Success: true, Results: [{ accountId: 'test-account-id', accountMaskedNumber: '123456789012', balance: { currencyCode: 'SGD', ledgerBalance: '12.30' } }] });
      }
      if (url.pathname === '/transactional/creditcardlisting/1.0/retrieveCreditCardList') return response({ Success: true, Results: [] });
      // A literal verified path catches endpoint regressions that a mock based on OCBC_APIS would hide.
      if (url.pathname === '/transactional/accounttransactionhistory/1.0/') {
        expect(init.method).toBe('GET');
        expect(url.searchParams.get('accountId')).toBe('test-account-id');
        return response(historyFails
          ? { Success: false, Results: { Status: 'ERROR', ErrorMsg: 'synthetic provider failure' } }
          : { Success: true, Results: { responseList: [{ amount: '1.23', currencyCode: 'SGD', debitCreditIndicator: 'D', transactionDate: '30-04-2018', description: 'Test debit' }] } });
      }
      return response({ Success: false }, 404);
    };
    const observations = await createOcbcAdapter(credentials, { fetchImpl, maxTransactionCalls: 1 }).observe();
    const transactions = observations.filter((o) => o.kind === 'account_transaction');
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ maskedReference: '****9012', currency: 'SGD', amount: { amountMinor: '123' }, description: 'DEBIT Test debit', source: 'ocbc:sandbox:accounttransactionhistory/1.0' });
    expect(JSON.stringify(observations)).not.toContain('test-account-id');
    expect(calls.some((u) => u.pathname === '/transactional/corpTransHistory/1.0')).toBe(false);

    historyFails = true;
    const failed = await createOcbcAdapter(credentials, { fetchImpl, maxTransactionCalls: 1 }).observe();
    expect(failed.filter((o) => o.kind === 'account_transaction')).toHaveLength(0);
    expect(failed[0]?.caveats.join(' ')).toContain('unusable payload');
  });

  it('uses only the fixed official host and GET bank-resource methods', async () => {
    const calls: Array<{ url: string; method: string; headers: Headers }> = [];
    const fetchImpl: typeof fetch = async (input, init = {}) => {
      const url = String(input);
      const headers = new Headers(init.headers);
      const method = init.method ?? 'GET';
      calls.push({ url, method, headers });
      if (url === 'https://api.ocbc.com/token') return response({ access_token: 'temporary-app-token', expires_in: 3600 });
      if (url.startsWith('https://api.ocbc.com' + OCBC_APIS.accountListing.path)) {
        return response({ success: true, results: [{ accountId: 'raw-account-12345678', accountMaskedNumber: '123456789012', balance: { currencyCode: 'SGD', ledgerBalance: '12.30', availableBalance: '10.00', balanceAsOfDate: '2026-10-05' } }] });
      }
      if (url.startsWith('https://api.ocbc.com' + OCBC_APIS.creditCardList.path)) return response({ success: true, result: [] });
      return response({ error: 'unexpected test URL' }, 404);
    };
    const adapter = createOcbcAdapter(credentials, { fetchImpl, clock: new ManualClock(), includeTransactions: false });

    const ready = await adapter.readiness();
    const observations = await adapter.observe();
    expect(ready.status).toBe('EXTERNAL_CHECK_PASSED');
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      kind: 'account_balance',
      maskedReference: '****9012',
      currency: 'SGD',
      amount: { amountMinor: '1230' },
      environment: 'sandbox',
      source: 'ocbc:sandbox:corporateAccountListing/1.0',
      observedAt: '2026-10-06T12:00:00.000Z',
    });
    expect(observations[0]?.caveats.join(' ')).toContain('historical test data');
    expect(JSON.stringify({ ready, observations })).not.toContain('do-not-return-this-secret');
    expect(JSON.stringify(observations)).not.toContain('raw-account-12345678');
    expect(calls.every((c) => new URL(c.url).origin === 'https://api.ocbc.com')).toBe(true);
    expect(calls.filter((c) => !c.url.endsWith('/token')).every((c) => c.method === 'GET')).toBe(true);
    expect(calls.find((c) => c.url.endsWith('/token'))?.method).toBe('POST');
    expect(calls.some((c) => c.headers.get('authorization')?.startsWith('Basic '))).toBe(true);
  });

  it('rejects an unallowlisted origin without making a network request or echoing credentials', async () => {
    const invalid = { ...credentials, OCBC_API_BASE_URL: 'https://attacker.example' } as NodeJS.ProcessEnv;
    let calls = 0;
    const adapter = createOcbcAdapter(invalid, { fetchImpl: async () => { calls++; return response({}); } });
    const ready = await adapter.readiness();
    expect(parseOcbcConfig(invalid)).toMatchObject({ ok: false, reason: 'invalid', invalid: ['OCBC_API_BASE_URL'] });
    expect(ready.status).toBe('CONFIGURED_UNVERIFIED');
    expect(JSON.stringify(ready)).not.toContain('do-not-return-this-secret');
    expect(calls).toBe(0);
  });

  it('reports missing credentials without contacting OCBC', async () => {
    let calls = 0;
    const adapter = createOcbcAdapter({}, { fetchImpl: async () => { calls++; return response({}); } });
    expect((await adapter.readiness()).status).toBe('MISSING_CONFIG');
    expect(calls).toBe(0);
  });
});
