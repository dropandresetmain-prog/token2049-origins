import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { encodePaymentRequiredHeader } from '@x402/core/http';
import { USDM_PREPROD_ASSET } from '@x402/cardano';
import type { PaymentRequired } from '@x402/core/types';
import { money } from '../../src/contracts/money.js';
import { Payer } from '../../clients/payer/payer.js';
import { loadPayerConfig } from '../../clients/payer/config.js';
import { PgPayerLedger } from '../../clients/payer/pg-ledger.js';
import { PayerLedger, readLedgerSnapshot, retireFileLedger, retiredMarkerPath, type LedgerEntry } from '../../clients/payer/ledger.js';
import { importLegacyLedger, importMarker, ledgerSourceSha256, LedgerImportError } from '../../clients/payer/ledger-import.js';
import { blockfrostEntryVerifier } from '../../clients/payer/onchain-verify.js';
import { deriveWalletAddress, startHostedPayer } from '../../clients/payer/hosted.js';
import type { Db } from '../../src/infrastructure/db.js';
import { createTestDb, newTestSchema } from '../support/database.js';

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'ledger-import-')); roots.push(d); return d; };

const TO = 'addr_test1qztreasury0000000000000000000000000000000000000000000000';
const WALLET = 'addr_test1qzpayer0000000000000';
const NETWORK = 'cardano:preprod';
const HOST = 't2o-cardano-payer.onrender.test';
const TOKEN = 'imported-ledger-bridge-token-0123456789';
const TEST_MNEMONIC = `${'abandon '.repeat(23)}art`;
const tx = (n: number) => n.toString(16).padStart(64, '0');
const idOf = (n: number) => `pur_LEGACYPURCHASE${String(n).padStart(3, '0')}`;
const NOW = new Date('2026-10-07T12:00:00Z');

const legacy = (): LedgerEntry[] => [
  { purchaseId: idOf(1), network: NETWORK, asset: USDM_PREPROD_ASSET, amountBaseUnits: '1020', payTo: TO, status: 'accepted', header: 'signed-header-1', transferReference: tx(1), createdAt: '2026-10-06T14:07:00.000Z', updatedAt: '2026-10-06T14:07:33.000Z' },
  { purchaseId: idOf(2), network: NETWORK, asset: USDM_PREPROD_ASSET, amountBaseUnits: '17950', payTo: TO, status: 'accepted', header: 'signed-header-2', transferReference: tx(2), createdAt: '2026-10-06T18:14:00.000Z', updatedAt: '2026-10-06T18:14:31.000Z' },
  { purchaseId: idOf(3), network: NETWORK, asset: USDM_PREPROD_ASSET, amountBaseUnits: '24990', payTo: TO, status: 'accepted', header: 'signed-header-3', transferReference: tx(3), createdAt: '2026-10-06T18:37:00.000Z', updatedAt: '2026-10-06T18:37:13.000Z' },
  { purchaseId: idOf(4), network: NETWORK, asset: USDM_PREPROD_ASSET, amountBaseUnits: '22870', payTo: TO, status: 'accepted', header: 'signed-header-4', transferReference: tx(4), createdAt: '2026-10-06T19:34:00.000Z', updatedAt: '2026-10-06T19:34:56.000Z' },
];
const SUM = 1020n + 17950n + 24990n + 22870n; // 66,830, like the real history
const rows = (db: Db) => db.all<any>('SELECT * FROM hosted_payer_ledger ORDER BY purchase_id');

function writeLegacyFile(entries = legacy()): string {
  const dir = tmp(); const path = join(dir, 'ledger.json');
  PayerLedger.initialize(path);
  const l = new PayerLedger(path);
  for (const e of entries) l.upsert(e);
  return path;
}

/** Payer over a gateway fake; caps mirror the real protected policy (102000 each). */
function payerFixture(db: Promise<Db> | Db, over: Record<string, string> = {}) {
  const config = loadPayerConfig({
    PAYER_GATEWAY_URL: 'https://token2049-origins.example.test', PAYER_GATEWAY_TOKEN_FILE: 'unused', PAYER_CARDANO_NETWORK: NETWORK, PAYER_CARDANO_MNEMONIC_FILE: 'unused',
    BLOCKFROST_PROJECT_ID: 'test-only', PAYER_MAX_PER_PAYMENT_BASE_UNITS: '102000', PAYER_MAX_CUMULATIVE_BASE_UNITS: '102000', PAYER_MAX_DAILY_BASE_UNITS: '102000',
    PAYER_MAX_FEE_LOVELACE: '50000000', PAYER_MAX_ADA_OUTPUT_LOVELACE: '200000000', PAYER_ALLOWED_ASSET_UNIT: USDM_PREPROD_ASSET, PAYER_EXPECTED_PAY_TO: TO, PAYER_WALLET_ADDRESS: WALLET, ...over,
  }, { ledger: 'external' });
  const amount = String(over.AMOUNT ?? '30000');
  const settlement = { policy: { mode: 'scaled_testnet' as const, numerator: 1 as const, denominator: 1000 as const }, commercialPrincipal: money('USD', BigInt(amount) / 10n), commercialServiceFee: money('USD', 0n), commercialTotal: money('USD', BigInt(amount) / 10n), principalBaseUnits: amount, feeBaseUnits: '0', totalBaseUnits: amount };
  const entryFor = (id: string) => ({ scheme: 'exact', network: config.network, asset: config.allowedAsset, amount, payTo: TO, maxTimeoutSeconds: 600,
    extra: { settlement, chainDecimals: 6, assetTransferMethod: 'default', areFeesSponsored: false, confirmationPolicy: { l1Confirmations: 1 }, purchaseId: id, quoteId: 'quo_ABCDEFGHIJKLMNOP', quoteDigest: 'sha256:' + 'd'.repeat(64), expiresAt: '2026-10-07T12:10:00Z' } });
  const purchaseFor = (id: string, state = 'awaiting_funding') => ({ purchaseId: id, quoteId: 'quo_ABCDEFGHIJKLMNOP', state, paymentState: 'not_received',
    fundingInstructions: { expiresAt: '2026-10-07T12:10:00Z', options: [{ rail: 'cardano', amount: { network: config.network, assetId: config.allowedAsset, amountBaseUnits: amount, decimals: 6 }, payTo: TO, settlement }] }, funding: [] });
  const sent: string[] = [];
  const lose = { next: false };
  const signer = vi.fn(() => ({ getAddress: () => WALLET, buildAndSignPaymentTransaction: async () => ({ transaction: 'test-only', nonce: `${'b'.repeat(64)}#0` }) }));
  const fetchImpl: typeof fetch = async (url, init) => {
    const id = /purchases\/(pur_[A-Za-z0-9]+)/.exec(String(url))![1]!;
    if (init?.method === 'GET') return new Response(JSON.stringify({ purchase: purchaseFor(id) }), { status: 200 });
    const signature = new Headers(init?.headers).get('payment-signature');
    const challenge: PaymentRequired = { x402Version: 2, resource: { url: `${config.gatewayUrl}/v1/purchases/${id}/fund` }, accepts: [entryFor(id)] };
    if (!signature) return new Response('{}', { status: 402, headers: { 'payment-required': encodePaymentRequiredHeader(challenge) } });
    sent.push(signature);
    if (lose.next) { lose.next = false; throw new Error('connection lost'); }
    return new Response(JSON.stringify({ purchase: { ...purchaseFor(id), state: 'funded_queued', funding: [{ transferReference: 'a'.repeat(64) }] } }), { status: 202 });
  };
  const deps = { config, fetchImpl, createSigner: signer, readGatewayToken: () => 'gw-token-xxxxxxxx', now: () => NOW, sleep: async () => {}, maxAttempts: 1 };
  return { config, sent, signer, lose, deps, boot: async (d?: Db) => { const dbx = d ?? await db; const ledger = await PgPayerLedger.open(dbx, { network: NETWORK, address: WALLET }); return { db: dbx, ledger, payer: new Payer({ ...deps, ledger }) }; } };
}
const POLICY = { network: NETWORK, asset: USDM_PREPROD_ASSET, maxPerPayment: 102000n, maxCumulative: 102000n, maxDaily: 102000n };

describe('legacy ledger import into PostgreSQL', () => {
  it('imports every entry verbatim, binds the identity, and records a marker', async () => {
    const db = await createTestDb();
    const entries = readLedgerSnapshot(writeLegacyFile());
    const result = await importLegacyLedger(db, { entries, network: NETWORK, address: WALLET, nowIso: NOW.toISOString() });
    expect(result).toMatchObject({ status: 'imported', entryCount: 4, committedBaseUnits: SUM.toString(), sourceSha256: ledgerSourceSha256(entries) });
    const stored = await rows(db);
    expect(stored).toHaveLength(4);
    for (const src of entries) {
      expect(stored.find((r) => r.purchase_id === src.purchaseId)).toMatchObject({
        payer_address: WALLET, network: src.network, asset: src.asset, amount_base_units: src.amountBaseUnits, pay_to: src.payTo, status: src.status,
        header: src.header, transfer_reference: src.transferReference, created_at: src.createdAt, updated_at: src.updatedAt,
      });
    }
    expect(await db.all('SELECT public_address FROM hosted_payer_identity')).toEqual([{ public_address: WALLET }]);
    expect(await importMarker(db)).toMatchObject({ payerAddress: WALLET, network: NETWORK, entryCount: 4, committedBaseUnits: SUM.toString(), sourceSha256: ledgerSourceSha256(entries) });
  });

  it('preserves cumulative and daily history: the cap is enforced from imported spend, not from zero', async () => {
    const db = await createTestDb();
    await importLegacyLedger(db, { entries: legacy(), network: NETWORK, address: WALLET });
    const f = payerFixture(db);
    const { ledger, payer } = await f.boot();
    expect(await ledger.committed(NETWORK, USDM_PREPROD_ASSET)).toBe(SUM);
    // Imported spend is dated yesterday, so today's daily total is 0 but the cumulative total is the full 66,830.
    expect(await ledger.daily(NETWORK, USDM_PREPROD_ASSET, NOW)).toBe(0n);
    const summary = await ledger.summary(POLICY, NOW);
    expect(summary).toMatchObject({ committedBaseUnits: '66830', headroomBaseUnits: '35170', entries: { total: 4, accepted: 4 }, imported: { entries: 4, committedBaseUnits: '66830' } });
    expect(JSON.stringify(summary)).not.toContain('signed-header');
    // 30,000 fits (66,830 + 30,000 = 96,830 <= 102,000); a second 30,000 does not (126,830 > 102,000) even after a restart.
    await payer.pay(idOf(10));
    const restarted = await f.boot();
    await expect(restarted.payer.pay(idOf(11))).rejects.toThrow('cumulative_cap');
    expect(await restarted.ledger.committed(NETWORK, USDM_PREPROD_ASSET)).toBe(SUM + 30000n);
  });

  it('refuses a payment above the remaining headroom without signing', async () => {
    const db = await createTestDb();
    await importLegacyLedger(db, { entries: legacy(), network: NETWORK, address: WALLET });
    const f = payerFixture(db, { AMOUNT: '36000' }); // headroom is 35,170
    const { payer } = await f.boot();
    await expect(payer.pay(idOf(20))).rejects.toThrow('cumulative_cap');
    expect(f.signer).not.toHaveBeenCalled();
  });

  it('keeps an imported signed header and resends exactly that transaction, never signing again', async () => {
    // 1. The OLD file-ledger payer signs, persists the header, and loses the response (so the entry stays `signed`).
    const file = writeLegacyFile();
    const old = payerFixture(createTestDb(), { AMOUNT: '1020' });
    old.lose.next = true;
    const filePayer = new Payer({ ...old.deps, ledger: new PayerLedger(file) });
    await expect(filePayer.pay(idOf(30))).rejects.toThrow();
    const entries = readLedgerSnapshot(file);
    const pending = entries.find((e) => e.purchaseId === idOf(30))!;
    expect(pending.status).toBe('signed');
    expect(old.signer).toHaveBeenCalledTimes(1);
    // 2. The history moves to PostgreSQL; the hosted payer finishes the SAME payment from the stored header.
    const db = await createTestDb();
    await importLegacyLedger(db, { entries, network: NETWORK, address: WALLET });
    const hosted = payerFixture(db, { AMOUNT: '1020' });
    const { payer, ledger } = await hosted.boot();
    await payer.pay(idOf(30));
    expect(hosted.signer).not.toHaveBeenCalled();
    expect(hosted.sent).toEqual([pending.header]);
    expect((await ledger.find(idOf(30)))).toMatchObject({ status: 'accepted', header: pending.header });
    expect(await ledger.committed(NETWORK, USDM_PREPROD_ASSET)).toBe(SUM + 1020n);
  });

  it('is idempotent: a rerun verifies and changes nothing, even after new payments', async () => {
    const db = await createTestDb();
    const entries = legacy();
    await importLegacyLedger(db, { entries, network: NETWORK, address: WALLET, nowIso: '2026-10-07T01:00:00.000Z' });
    const before = JSON.stringify(await rows(db));
    const again = await importLegacyLedger(db, { entries: [...entries].reverse(), network: NETWORK, address: WALLET });
    expect(again.status).toBe('already_imported');
    expect(JSON.stringify(await rows(db))).toBe(before);
    expect(await db.all('SELECT * FROM hosted_payer_import')).toHaveLength(1);
    // A later payment is new history and must not disturb the idempotency check.
    const f = payerFixture(db); const { payer } = await f.boot();
    await payer.pay(idOf(40));
    expect((await importLegacyLedger(db, { entries, network: NETWORK, address: WALLET })).status).toBe('already_imported');
    expect(await rows(db)).toHaveLength(5);
  });

  it('never re-verifies on-chain on a rerun, and verifies every entry on the first import', async () => {
    const db = await createTestDb();
    const seen: string[] = [];
    const verifyEntry = async (e: LedgerEntry) => { seen.push(e.purchaseId); };
    await importLegacyLedger(db, { entries: legacy(), network: NETWORK, address: WALLET, verifyEntry });
    expect(seen).toEqual(legacy().map((e) => e.purchaseId));
    await importLegacyLedger(db, { entries: legacy(), network: NETWORK, address: WALLET, verifyEntry });
    expect(seen).toHaveLength(4);
  });

  it('refuses a non-empty destination that did not come from this source, leaving it untouched', async () => {
    const db = await createTestDb();
    const f = payerFixture(db); const { payer } = await f.boot();
    await payer.pay(idOf(50)); // the destination already has real history
    const before = JSON.stringify(await rows(db));
    await expect(importLegacyLedger(db, { entries: legacy(), network: NETWORK, address: WALLET })).rejects.toThrow(/already has history/);
    expect(JSON.stringify(await rows(db))).toBe(before);
    expect(await db.all('SELECT * FROM hosted_payer_import')).toEqual([]);
  });

  it('refuses a different history after an import, a pinned-hash mismatch, and a different wallet', async () => {
    const db = await createTestDb();
    await importLegacyLedger(db, { entries: legacy(), network: NETWORK, address: WALLET });
    const changed = legacy(); changed[0] = { ...changed[0]!, amountBaseUnits: '1021' };
    await expect(importLegacyLedger(db, { entries: changed, network: NETWORK, address: WALLET })).rejects.toThrow(/different history was already imported/);
    await expect(importLegacyLedger(db, { entries: legacy(), network: NETWORK, address: 'addr_test1qzsomeoneelse000000000' })).rejects.toThrow(/different history was already imported/);
    await expect(importLegacyLedger(db, { entries: legacy(), network: NETWORK, address: WALLET, expectedSha256: 'f'.repeat(64) })).rejects.toThrow(/pinned snapshot hash/);
    const fresh = await createTestDb();
    await expect(importLegacyLedger(fresh, { entries: legacy(), network: NETWORK, address: WALLET, expectedSha256: '0'.repeat(64) })).rejects.toThrow(LedgerImportError);
    expect(await rows(fresh)).toEqual([]);
  });

  it('refuses a database already bound to another wallet identity', async () => {
    const db = await createTestDb();
    await PgPayerLedger.open(db, { network: NETWORK, address: 'addr_test1qzhistoricwallet0000000' });
    await expect(importLegacyLedger(db, { entries: legacy(), network: NETWORK, address: WALLET })).rejects.toThrow(/different wallet identity/);
    expect(await rows(db)).toEqual([]);
    expect(await db.all('SELECT * FROM hosted_payer_import')).toEqual([]);
  });

  it('is atomic: a failed on-chain check or a failure part-way through leaves nothing behind', async () => {
    const db = await createTestDb();
    await expect(importLegacyLedger(db, { entries: legacy(), network: NETWORK, address: WALLET, verifyEntry: async (e) => { if (e.purchaseId === idOf(3)) throw new Error('not this wallet'); } })).rejects.toThrow('not this wallet');
    expect(await rows(db)).toEqual([]);
    expect(await db.all('SELECT * FROM hosted_payer_identity')).toEqual([]);
    // Last entry violates a table constraint after three inserts succeeded: the whole transaction rolls back.
    const poisoned = legacy(); poisoned.push({ ...legacy()[0]!, purchaseId: idOf(99), amountBaseUnits: '0' });
    await expect(importLegacyLedger(db, { entries: poisoned, network: NETWORK, address: WALLET })).rejects.toThrow();
    expect(await rows(db)).toEqual([]);
    expect(await db.all('SELECT * FROM hosted_payer_identity')).toEqual([]);
    expect(await db.all('SELECT * FROM hosted_payer_import')).toEqual([]);
    // And a clean import still works afterwards.
    expect((await importLegacyLedger(db, { entries: legacy(), network: NETWORK, address: WALLET })).status).toBe('imported');
  });

  it('refuses duplicate purchases and keeps the marker permanent', async () => {
    const db = await createTestDb();
    await expect(importLegacyLedger(db, { entries: [...legacy(), legacy()[0]!], network: NETWORK, address: WALLET })).rejects.toThrow(/duplicate/);
    await importLegacyLedger(db, { entries: legacy(), network: NETWORK, address: WALLET });
    await expect(db.run("UPDATE hosted_payer_import SET entry_count = 0")).rejects.toThrow(/permanent/);
    await expect(db.run('DELETE FROM hosted_payer_import')).rejects.toThrow(/permanent/);
  });

  it('serializes two concurrent first imports: exactly one wins, the other verifies', async () => {
    const schema = newTestSchema();
    const a = await createTestDb(schema), b = await createTestDb(schema);
    const results = await Promise.allSettled([
      importLegacyLedger(a, { entries: legacy(), network: NETWORK, address: WALLET }),
      importLegacyLedger(b, { entries: legacy(), network: NETWORK, address: WALLET }),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(await rows(a)).toHaveLength(4);
    expect(await a.all('SELECT * FROM hosted_payer_import')).toHaveLength(1);
    // The loser either completed as already_imported or asked for a restart; a retry is then a verified no-op.
    expect((await importLegacyLedger(b, { entries: legacy(), network: NETWORK, address: WALLET })).status).toBe('already_imported');
  });
});

describe('on-chain ownership verification', () => {
  const entry = legacy()[0]!;
  const respond = (inputs: string[], outputs: string[], status = 200) => vi.fn(async () => new Response(JSON.stringify({ inputs: inputs.map((address) => ({ address })), outputs: outputs.map((address) => ({ address })) }), { status }));
  const verifier = (f: typeof fetch) => blockfrostEntryVerifier({ baseUrl: 'https://cardano-preprod.blockfrost.io/api/v0/', projectId: 'pid-never-printed', address: WALLET, fetchImpl: f });

  it('accepts a transaction spent from the wallet and paying the recorded payee', async () => {
    const f = respond([WALLET], [TO, WALLET]);
    await verifier(f as unknown as typeof fetch)(entry);
    expect(String((f.mock.calls[0] as unknown[])[0])).toBe(`https://cardano-preprod.blockfrost.io/api/v0/txs/${tx(1)}/utxos`);
    expect(((f.mock.calls[0] as unknown[])[1] as RequestInit).redirect).toBe('error');
  });

  it.each([
    ['spent by another wallet', respond(['addr_test1qzother'], [TO]), /not spent from the configured wallet/],
    ['paid someone else', respond([WALLET], ['addr_test1qzother']), /did not pay its recorded payee/],
    ['unknown transaction', respond([], [], 404), /HTTP 404/],
    ['provider error', respond([], [], 500), /HTTP 500/],
  ])('refuses a transaction that is %s', async (_n, f, message) => {
    await expect(verifier(f as unknown as typeof fetch)(entry)).rejects.toThrow(message);
  });

  it('refuses entries with no transfer reference and an unreachable provider', async () => {
    await expect(verifier(respond([WALLET], [TO]) as unknown as typeof fetch)({ ...entry, transferReference: null })).rejects.toThrow(/no verifiable transaction reference/);
    await expect(verifier((async () => { throw new Error('boom'); }) as unknown as typeof fetch)(entry)).rejects.toThrow(/unreachable/);
  });
});

describe('retiring the legacy file signer', () => {
  it('disables every local signer on that ledger once migrated, and never overwrites a marker', async () => {
    const path = writeLegacyFile();
    const entries = readLedgerSnapshot(path);
    const ledger = new PayerLedger(path);
    expect(() => ledger.assertReady()).not.toThrow();
    const info = { reason: 'migrated to PostgreSQL', sourceSha256: ledgerSourceSha256(entries), entryCount: entries.length, payerAddress: WALLET };
    const marker = retireFileLedger(path, info);
    expect(existsSync(retiredMarkerPath(path))).toBe(true);
    expect(() => ledger.assertReady()).toThrow(/retired; this local signer is disabled/);
    await expect(ledger.exclusive(async () => 'signed')).rejects.toThrow(/retired/);
    expect(() => new PayerLedger(path).find(idOf(1))).toThrow(/retired/);
    // The old payer (any process, file ledger) cannot pay.
    const f = payerFixture(createTestDb());
    const old = new Payer({ ...f.deps, config: { ...f.deps.config, ledgerFile: path }, ledger: new PayerLedger(path) });
    await expect(old.pay(idOf(60))).rejects.toThrow(/retired/);
    expect(f.signer).not.toHaveBeenCalled();
    // Idempotent for the same history, refused for a different one; the history itself stays readable and unchanged.
    expect(retireFileLedger(path, info).retiredAt).toBe(marker.retiredAt);
    expect(() => retireFileLedger(path, { ...info, sourceSha256: 'e'.repeat(64) })).toThrow(/different history/);
    expect(readLedgerSnapshot(path)).toEqual(entries);
    expect(readFileSync(retiredMarkerPath(path), 'utf8')).not.toMatch(/header|mnemonic|signed-header/);
  });
});

describe('hosted start-up with the canonical ledger', () => {
  async function startEnv(entries = legacy(), over: Record<string, string> = {}) {
    const dir = tmp();
    const mnemonic = join(dir, 'payer.mnemonic'); const bridge = join(dir, 'bridge-token');
    writeFileSync(mnemonic, TEST_MNEMONIC); writeFileSync(bridge, TOKEN);
    const base = payerFixture(createTestDb(), { PAYER_CARDANO_MNEMONIC_FILE: mnemonic });
    const address = deriveWalletAddress(base.config);
    const legacyFile = writeLegacyFile(entries.map((e) => ({ ...e })));
    const env = {
      PAYER_GATEWAY_URL: 'https://token2049-origins.onrender.com', PAYER_GATEWAY_TOKEN_FILE: 'unused', PAYER_CARDANO_NETWORK: NETWORK, PAYER_CARDANO_MNEMONIC_FILE: mnemonic,
      BLOCKFROST_PROJECT_ID: 'test-only', PAYER_MAX_PER_PAYMENT_BASE_UNITS: '102000', PAYER_MAX_CUMULATIVE_BASE_UNITS: '102000', PAYER_MAX_DAILY_BASE_UNITS: '102000',
      PAYER_MAX_FEE_LOVELACE: '50000000', PAYER_MAX_ADA_OUTPUT_LOVELACE: '200000000', PAYER_ALLOWED_ASSET_UNIT: USDM_PREPROD_ASSET, PAYER_EXPECTED_PAY_TO: TO,
      PAYER_WALLET_ADDRESS: address, PAYER_BRIDGE_TOKEN_FILE: bridge, PAYER_BRIDGE_ALLOWED_HOSTS: HOST,
      PAYER_LEGACY_LEDGER_FILE: legacyFile, PAYER_LEGACY_LEDGER_SHA256: ledgerSourceSha256(readLedgerSnapshot(legacyFile)), ...over,
    } as NodeJS.ProcessEnv;
    const chain = (inputAddress: string) => vi.fn(async () => new Response(JSON.stringify({ inputs: [{ address: inputAddress }], outputs: [{ address: TO }] }), { status: 200 })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    return { env, address, legacyFile, chain };
  }
  const status = (port: number) => new Promise<any>((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port, path: '/status', method: 'GET', headers: { host: HOST, 'x-forwarded-proto': 'https', authorization: `Bearer ${TOKEN}` } }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(d) })); });
    r.on('error', reject); r.end();
  });

  it('imports once after proving ownership on-chain, reports the imported history, and a restart only verifies', async () => {
    const { env, address, chain } = await startEnv();
    const db = await createTestDb();
    const f1 = chain(address);
    const h1 = await startHostedPayer(env, { db, port: 0, fetchImpl: f1 });
    servers.push(h1.server);
    expect(f1).toHaveBeenCalledTimes(4);
    const s = await status((h1.server.address() as AddressInfo).port);
    expect(s.status).toBe(200);
    expect(s.body.source.publicAddress).toBe(address);
    expect(s.body.ledger).toMatchObject({ address, committedBaseUnits: '66830', headroomBaseUnits: '35170', entries: { total: 4, accepted: 4 }, imported: { entries: 4, committedBaseUnits: '66830' }, caps: { perPayment: '102000', cumulative: '102000', daily: '102000' } });
    expect(JSON.stringify(s.body)).not.toMatch(/signed-header|mnemonic|test-only/);
    await new Promise<void>((r) => h1.server.close(() => r()));
    const f2 = chain(address);
    const h2 = await startHostedPayer(env, { db, port: 0, fetchImpl: f2 });
    servers.push(h2.server);
    expect(f2).not.toHaveBeenCalled();
    expect(await rows(db)).toHaveLength(4);
  });

  it('refuses to start, and leaves the database untouched, when the history is not provably this wallet\'s', async () => {
    const { env, chain } = await startEnv();
    const db = await createTestDb();
    await expect(startHostedPayer(env, { db, port: 0, fetchImpl: chain('addr_test1qzsomeoneelse000000000') })).rejects.toThrow(/not spent from the configured wallet/);
    expect(await rows(db)).toEqual([]);
    expect(await db.all('SELECT * FROM hosted_payer_identity')).toEqual([]);
  });

  it('refuses a snapshot that differs from the pinned hash, a missing pin, or a ledger that changed after the import', async () => {
    const { env, address, chain, legacyFile } = await startEnv();
    const db = await createTestDb();
    await expect(startHostedPayer({ ...env, PAYER_LEGACY_LEDGER_SHA256: 'f'.repeat(64) }, { db, port: 0, fetchImpl: chain(address) })).rejects.toThrow(/pinned snapshot hash/);
    await expect(startHostedPayer({ ...env, PAYER_LEGACY_LEDGER_SHA256: '' }, { db, port: 0, fetchImpl: chain(address) })).rejects.toThrow('PAYER_LEGACY_LEDGER_SHA256');
    expect(await rows(db)).toEqual([]);
    const h = await startHostedPayer(env, { db, port: 0, fetchImpl: chain(address) });
    servers.push(h.server);
    await new Promise<void>((r) => h.server.close(() => r()));
    // Tampering with the stored history (bypassing triggers is impossible), or presenting a different source, stops start-up.
    const tampered = readLedgerSnapshot(legacyFile); tampered.push({ ...tampered[0]!, purchaseId: idOf(77) });
    const other = tmp(); const otherFile = join(other, 'ledger.json'); PayerLedger.initialize(otherFile); const ol = new PayerLedger(otherFile); for (const e of tampered) ol.upsert(e);
    await expect(startHostedPayer({ ...env, PAYER_LEGACY_LEDGER_FILE: otherFile, PAYER_LEGACY_LEDGER_SHA256: ledgerSourceSha256(tampered) }, { db, port: 0, fetchImpl: chain(address) })).rejects.toThrow(/different history was already imported/);
  });
});
