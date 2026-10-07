import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { decodePaymentSignatureHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { paySolanaPurchase } from '../../clients/solana/pay.js';
import { loadSolanaPayerConfig } from '../../clients/solana/config.js';
import { PgSolanaLedger } from '../../clients/solana/pg-ledger.js';
import { importSolanaHistories, solanaSourceHash, type SolanaImportInput } from '../../clients/solana/ledger-import.js';
import { NETWORK, TEST_MINT } from '../../src/funding/solana/wire.js';
import { createTestDb, newTestSchema } from '../support/database.js';
import { scenario } from '../support/solana.js';

const dirs: string[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime('2026-10-06T14:00:00Z'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
async function fixture() {
  const s = await scenario(), schema = newTestSchema(), db = await createTestDb(schema);
  const input = (role: 'payer' | 'sponsor', owner: string): SolanaImportInput => {
    const text = JSON.stringify({ version: 1, owner, network: NETWORK, mint: TEST_MINT, entries: [] });
    return { role, owner, text, expectedSha256: solanaSourceHash(text) };
  };
  await importSolanaHistories(db, [input('payer', s.transfer.payer), input('sponsor', s.transfer.sponsor)], async () => {});
  const ledger = await PgSolanaLedger.open(db, 'payer', s.transfer.payer);
  const dir = mkdtempSync(join(tmpdir(), 'hosted-solana-payment-')); dirs.push(dir);
  const tokenFile = join(dir, 'gateway-token'); writeFileSync(tokenFile, 'test-only-gateway-token-0123456789');
  const cfg = loadSolanaPayerConfig({ ...s.env, SOLANA_SETTLEMENT_MODE: 'payer_broadcast', SOLANA_PAYER_RPC_URL: s.env.SOLANA_RPC_URL,
    SOLANA_PAYER_ADDRESS: s.transfer.payer, SOLANA_PAYER_TOKEN_ACCOUNT: s.transfer.source, SOLANA_PAYER_KEY_FILE: 'must-not-load',
    SOLANA_SPONSOR_KEY_FILE: 'must-not-load', SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS: '10000', SOLANA_PAYER_MAX_TOTAL_BASE_UNITS: '10000',
    SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR: '1000', SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS: '100000', SOLANA_GATEWAY_URL: 'http://127.0.0.1:8787', SOLANA_GATEWAY_TOKEN_FILE: tokenFile }, { ledger: 'external' });
  const payload = decodePaymentSignatureHeader(s.header);
  payload.accepted.extra = { ...payload.accepted.extra, preparation: { mode: 'payer_broadcast', requiresFullySignedTransaction: true } };
  const header = encodePaymentSignatureHeader(payload);
  const entry = { id: s.input.purchaseId, signature: s.transfer.signature, amount: '1000', fee: '0', header, createdAt: '2026-10-06T14:00:00Z' };
  const prepare = vi.fn(async () => ({ header, signature: s.transfer.signature! }));
  const broadcast = vi.fn(async () => {});
  return { s, cfg, ledger, schema, entry, header, prepare, broadcast };
}
describe('durable hosted Solana purchase handoff', () => {
  it('retains identical bytes across a lost gateway response and PostgreSQL restart without preparing again', async () => {
    const f = await fixture(); await f.ledger.upsert(f.entry);
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchImpl);
    await expect(paySolanaPurchase(f.cfg, f.entry.id, f)).rejects.toThrow('response lost');
    const restarted = await PgSolanaLedger.open(await createTestDb(f.schema), 'payer', f.s.transfer.payer);
    expect(await paySolanaPurchase(f.cfg, f.entry.id, { ledger: restarted, prepare: f.prepare, broadcast: f.broadcast })).toMatchObject({ status: 202, signature: f.entry.signature, header: f.header });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(await restarted.read()).toEqual([f.entry]);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(url).toBe(f.s.input.resourceUrl);
      expect(init.headers['payment-signature']).toBe(f.header);
      expect(init.redirect).toBe('error');
    }
  });
  it('refuses an unsigned reservation without signing, broadcasting or calling the gateway', async () => {
    const f = await fixture(); await f.ledger.upsert({ ...f.entry, signature: null, header: null });
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    await expect(paySolanaPurchase(f.cfg, f.entry.id, f)).rejects.toThrow(/manual recovery/);
    expect(network).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled(); expect(f.broadcast).not.toHaveBeenCalled();
    expect((await f.ledger.read())[0]?.amount).toBe('1000');
  });
  it('refuses a retained candidate bound to a different purchase before any external call', async () => {
    const f = await fixture(), payload = decodePaymentSignatureHeader(f.header);
    payload.resource = { url: 'http://127.0.0.1:8787/v1/purchases/pur_DIFFERENT0000/fund' };
    await f.ledger.upsert({ ...f.entry, header: encodePaymentSignatureHeader(payload) });
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    await expect(paySolanaPurchase(f.cfg, f.entry.id, f)).rejects.toThrow(/purchase binding/);
    expect(network).not.toHaveBeenCalled(); expect(f.broadcast).not.toHaveBeenCalled();
  });
  it('checks sponsored requirements against the original exact requirement before persisting or sending', async () => {
    const f = await fixture(); await f.ledger.upsert({ ...f.entry, signature: null });
    const altered = decodePaymentSignatureHeader(f.header); altered.accepted.amount = '1001';
    const prepare = vi.fn(async () => ({ header: encodePaymentSignatureHeader(altered), signature: f.entry.signature! }));
    const network = vi.fn(); vi.stubGlobal('fetch', network);
    await expect(paySolanaPurchase(f.cfg, f.entry.id, { ledger: f.ledger, prepare, broadcast: f.broadcast })).rejects.toThrow(/approved policy/);
    expect((await f.ledger.read())[0]?.header).toBe(f.header);
    expect(network).not.toHaveBeenCalled(); expect(f.broadcast).not.toHaveBeenCalled();
  });
});
