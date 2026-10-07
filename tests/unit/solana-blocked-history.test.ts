import { describe, it, expect, vi, afterEach } from 'vitest';
import { address, getBase64EncodedWireTransaction } from '@solana/kit';
import { decodeTransactionFromPayload } from '@x402/svm';
import { decodePaymentSignatureHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { importSolanaHistories, solanaSourceHash, type SolanaImportInput } from '../../clients/solana/ledger-import.js';
import { PgSolanaLedger } from '../../clients/solana/pg-ledger.js';
import { blockedHistoryEvidence, type HistoricalBlockPolicy } from '../../clients/solana/blocked-history.js';
import { paySolanaPurchase } from '../../clients/solana/pay.js';
import { createHostedSponsor } from '../../clients/solana/hosted-sponsor.js';
import { hostedSolanaReady, solanaHostedSummary } from '../../clients/solana/hosted.js';
import { loadSolanaPayerConfig } from '../../clients/solana/config.js';
import { NETWORK, TEST_MINT } from '../../src/funding/solana/wire.js';
import type { SolanaRpc } from '../../src/funding/solana/rpc.js';
import { createTestDb, newTestSchema } from '../support/database.js';
import { scenario } from '../support/solana.js';
afterEach(() => vi.unstubAllGlobals());

async function fixture() {
  const s = await scenario();
  const payload = decodePaymentSignatureHeader(s.header);
  const decoded = decodeTransactionFromPayload(payload.payload as { transaction: string });
  const transaction = getBase64EncodedWireTransaction({ ...decoded, signatures: { ...decoded.signatures, [address(s.transfer.sponsor)]: null } });
  payload.payload = { transaction };
  const header = encodePaymentSignatureHeader(payload);
  const row = { id: s.input.purchaseId, signature: null, amount: '1000', fee: '0', header, createdAt: '2026-10-06T14:00:00.000Z' };
  const input = (role: 'payer' | 'sponsor', owner: string, entries: unknown[]): SolanaImportInput => {
    const text = JSON.stringify({ version: 1, owner, network: NETWORK, mint: TEST_MINT, entries });
    return { role, owner, text, expectedSha256: solanaSourceHash(text) };
  };
  const inputs: [SolanaImportInput, SolanaImportInput] = [input('payer', s.transfer.payer, [row]), input('sponsor', s.transfer.sponsor, [])];
  const policy: HistoricalBlockPolicy = { version: 1, mode: 'historical_unresolved_permanently_blocked', payerSourceSha256: inputs[0].expectedSha256, sponsorSourceSha256: inputs[1].expectedSha256, purchaseIds: [row.id] };
  const cfg = loadSolanaPayerConfig({ ...s.env, SOLANA_SETTLEMENT_MODE: 'payer_broadcast', SOLANA_PAYER_RPC_URL: s.env.SOLANA_RPC_URL,
    SOLANA_PAYER_ADDRESS: s.transfer.payer, SOLANA_PAYER_TOKEN_ACCOUNT: s.transfer.source, SOLANA_PAYER_KEY_FILE: 'must-not-load',
    SOLANA_SPONSOR_KEY_FILE: 'must-not-load', SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS: '10000', SOLANA_PAYER_MAX_TOTAL_BASE_UNITS: '10000',
    SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR: '1000', SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS: '100000', SOLANA_GATEWAY_URL: 'http://127.0.0.1:8787', SOLANA_GATEWAY_TOKEN_FILE: 'must-not-read' }, { ledger: 'external' });
  return { s, row, payload, inputs, policy, cfg };
}

describe('permanently blocked historical Solana ambiguity', () => {
  it('imports without RPC, archives exact bytes, retains exposure and only verifies on rerun', async () => {
    const f = await fixture(), schema = newTestSchema(), db = await createTestDb(schema);
    const verify = vi.fn(async () => { throw new Error('RPC unavailable'); });
    await importSolanaHistories(db, f.inputs, verify, f.policy);
    const payer = await PgSolanaLedger.open(db, 'payer', f.s.transfer.payer);
    expect(await payer.read()).toEqual([{ ...f.row, historicalBlocked: true }]);
    expect(await payer.summary()).toMatchObject({ entries: 1, incomplete: 0, historicalBlocked: 1, committedBaseUnits: '1000' });
    expect((await db.get<{source_text:string}>('SELECT source_text FROM hosted_solana_source_archive WHERE role=$1', 'payer'))?.source_text).toBe(f.inputs[0].text);
    const before = await db.all('SELECT * FROM hosted_solana_import ORDER BY role');
    await importSolanaHistories(db, f.inputs, verify, f.policy);
    expect(await db.all('SELECT * FROM hosted_solana_import ORDER BY role')).toEqual(before);
    expect(verify).not.toHaveBeenCalled();
    const restarted = await PgSolanaLedger.open(await createTestDb(schema), 'payer', f.s.transfer.payer);
    await expect(restarted.assertAllowed(f.row.id)).rejects.toThrow(/permanently blocked/);
    await expect(payer.assertCaps(9001n, 0n, 10000n, 100000n)).rejects.toThrow(/cap exceeded/);
    await expect(payer.assertAllowed('pur_new1234567890')).resolves.toBeUndefined();
    await payer.upsert({ ...f.row, id: 'pur_new1234567890', header: null });
    expect(await payer.summary()).toMatchObject({ incomplete: 1, historicalBlocked: 1, committedBaseUnits: '2000' });
  });

  it('rejects historical IDs and candidate aliases in both roles before key, RPC, gateway, preparation or submission', async () => {
    const f = await fixture(), db = await createTestDb();
    await importSolanaHistories(db, f.inputs, async () => {}, f.policy);
    const payer = await PgSolanaLedger.open(db, 'payer', f.s.transfer.payer), sponsorLedger = await PgSolanaLedger.open(db, 'sponsor', f.s.transfer.sponsor);
    const evidence = blockedHistoryEvidence(f.policy, f.inputs, [[f.row], []])[0]!;
    for (const ledger of [payer, sponsorLedger]) for (const id of [f.row.id, evidence.messageSha256, evidence.candidateSha256, evidence.payerSignature]) await expect(ledger.assertAllowed(id)).rejects.toThrow(/permanently blocked/);
    const network = vi.fn(), prepare = vi.fn(), broadcast = vi.fn();
    vi.stubGlobal('fetch', network);
    await expect(paySolanaPurchase(f.cfg, f.row.id, { ledger: payer, prepare, broadcast })).rejects.toThrow(/permanently blocked/);
    expect(network).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled(); expect(broadcast).not.toHaveBeenCalled();
    const signTransaction = vi.fn();
    const sponsor = await createHostedSponsor(f.cfg, sponsorLedger, { signer: { signTransaction } as never });
    await expect(sponsor.prepare(f.payload)).rejects.toThrow(/permanently blocked/);
    expect(signTransaction).not.toHaveBeenCalled();
    await expect(payer.upsert({ ...f.row, signature: evidence.payerSignature })).rejects.toThrow(/permanently blocked/);
    await expect(db.run('UPDATE hosted_solana_ledger SET signature=$1 WHERE role=$2 AND id=$3', evidence.payerSignature, 'payer', f.row.id)).rejects.toThrow(/permanently blocked/);
    await expect(db.run('DELETE FROM hosted_solana_blocked_history')).rejects.toThrow(/permanent/);
    await expect(db.run('UPDATE hosted_solana_source_archive SET source_text=$1', 'changed')).rejects.toThrow(/permanent/);
  });

  it('rejects conflicting policies, omitted candidates and non-empty unmarked destinations', async () => {
    const f = await fixture(), db = await createTestDb();
    await expect(importSolanaHistories(db, f.inputs, async () => {}, { ...f.policy, payerSourceSha256: 'f'.repeat(64) })).rejects.toThrow(/source or ID conflict/);
    await expect(importSolanaHistories(db, f.inputs, async () => {}, { ...f.policy, purchaseIds: ['pur_different123456'] })).rejects.toThrow(/cover exactly/);
    await db.run('INSERT INTO hosted_solana_identity(role,owner,network,mint) VALUES($1,$2,$3,$4)', 'sponsor', f.s.transfer.sponsor, NETWORK, TEST_MINT);
    await expect(importSolanaHistories(db, f.inputs, async () => {}, f.policy)).rejects.toThrow(/pre-existing unmarked/);
    expect(await db.all('SELECT * FROM hosted_solana_import')).toEqual([]);
    const clean = await createTestDb();
    await importSolanaHistories(clean, f.inputs, async () => {}, f.policy);
    await expect(importSolanaHistories(clean, f.inputs, async () => {})).rejects.toThrow(/archive or policy conflict/);
  });

  it('allows new readiness with blocked history, while RPC and active ambiguity still fail closed', async () => {
    const f = await fixture(), db = await createTestDb();
    await importSolanaHistories(db, f.inputs, async () => {}, f.policy);
    const payer = await PgSolanaLedger.open(db, 'payer', f.s.transfer.payer), sponsor = await PgSolanaLedger.open(db, 'sponsor', f.s.transfer.sponsor);
    const rpc = { assertNetwork: vi.fn(async () => {}), assertMint: vi.fn(async () => {}), assertToken: vi.fn(async () => {}), call: vi.fn(async (method: string) => method === 'getBalance' ? { context: { slot: 123 }, value: 100000 } : { context: { slot: 123 }, value: { amount: '500', decimals: 6 } }) } as unknown as SolanaRpc;
    expect(await hostedSolanaReady(f.cfg, payer, sponsor, rpc)).toBe(true);
    expect(await solanaHostedSummary(f.cfg, payer, sponsor, rpc)).toMatchObject({ headroomBaseUnits: '500', balances: { verified: true, payerUsdcBaseUnits: '500', sponsorLamports: '100000' } });
    vi.mocked(rpc.assertNetwork).mockRejectedValueOnce(new Error('429'));
    expect(await hostedSolanaReady(f.cfg, payer, sponsor, rpc)).toBe(false);
    vi.mocked(rpc.assertNetwork).mockRejectedValueOnce(new Error('429'));
    expect(await solanaHostedSummary(f.cfg, payer, sponsor, rpc)).toMatchObject({ headroomBaseUnits: '0', balances: { verified: false } });
    await payer.upsert({ ...f.row, id: 'pur_new1234567890', header: null });
    expect(await hostedSolanaReady(f.cfg, payer, sponsor, rpc)).toBe(false);
  });
});
