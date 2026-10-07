import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSigner } from '@solana/kit';
import * as signerModule from '../../clients/solana/signer.js';
import { startHostedSolana, type HostedSolanaHandle } from '../../clients/solana/hosted.js';
import { NETWORK, TEST_MINT } from '../../src/funding/solana/wire.js';
import type { SolanaRpc } from '../../src/funding/solana/rpc.js';
import { createTestDb } from '../support/database.js';

const BRIDGE_TOKEN = 'hosted-solana-bridge-test-token-0123456789';
const GATEWAY_TOKEN = 'hosted-solana-gateway-test-token-0123456789';
const HOST = 'solana-payer.example.com';
const tempDirs: string[] = [];
let active: HostedSolanaHandle | undefined;

afterEach(async () => {
  await active?.close();
  active = undefined;
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'solana-hosted-service-')); tempDirs.push(dir); return dir; };
const sourceSnapshot = (owner: string) => JSON.stringify({ version: 1, owner, network: NETWORK, mint: TEST_MINT, entries: [] });
const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function localRequest(url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) {
  const target = new URL(url);
  return new Promise<{ status: number; text: () => string; json: () => any }>((resolve, reject) => {
    const request = httpRequest({
      hostname: target.hostname,
      port: Number(target.port),
      path: `${target.pathname}${target.search}`,
      method: init.method ?? 'GET',
      headers: init.headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ status: response.statusCode ?? 0, text: () => text, json: () => JSON.parse(text) });
      });
    });
    request.on('error', reject);
    if (init.body !== undefined) request.write(init.body);
    request.end();
  });
}

function testRpc() {
  const calls: string[] = [];
  const rpc = {
    assertNetwork: vi.fn(async () => undefined),
    assertMint: vi.fn(async () => undefined),
    assertToken: vi.fn(async () => undefined),
    call: vi.fn(async (method: string) => {
      calls.push(method);
      if (method === 'getSignaturesForAddress') return [];
      if (method === 'getTokenAccountBalance') return { value: { amount: '50000' } };
      if (method === 'getBalance') return { value: 1_000_000 };
      throw new Error(`unexpected fake RPC method: ${method}`);
    }),
  };
  return { rpc: rpc as unknown as SolanaRpc, calls };
}

describe('hosted Solana public service', () => {
  it('serves bounded public routes from imported PostgreSQL history and fails closed on an unresolved reservation', async () => {
    const dir = temp();
    const payerTokenFile = join(dir, 'bridge-token');
    const gatewayTokenFile = join(dir, 'gateway-token');
    writeFileSync(payerTokenFile, BRIDGE_TOKEN);
    writeFileSync(gatewayTokenFile, GATEWAY_TOKEN);

    const [payerSigner, sponsorSigner, payeeSigner, payerSourceSigner, treasuryTokenSigner] = await Promise.all(
      Array.from({ length: 5 }, () => generateKeyPairSigner()),
    );
    const signCalls: string[] = [];
    const tracked = (signer: typeof payerSigner) => ({
      ...signer,
      signMessages: async (...args: Parameters<typeof signer.signMessages>) => {
        signCalls.push(signer.address);
        return signer.signMessages(...args);
      },
    });
    const signers = new Map([
      [payerSigner.address, tracked(payerSigner)],
      [sponsorSigner.address, tracked(sponsorSigner)],
    ]);
    const loadSigner = vi.spyOn(signerModule, 'loadSigner').mockImplementation(async (_path, expectedAddress) => {
      const signer = signers.get(expectedAddress);
      if (!signer) throw new Error('unexpected signer identity requested');
      return signer as Awaited<ReturnType<typeof signerModule.loadSigner>>;
    });

    const payerHistory = sourceSnapshot(payerSigner.address);
    const sponsorHistory = sourceSnapshot(sponsorSigner.address);
    const payerHistoryFile = join(dir, 'payer-history');
    const sponsorHistoryFile = join(dir, 'sponsor-history');
    writeFileSync(payerHistoryFile, payerHistory);
    writeFileSync(sponsorHistoryFile, sponsorHistory);
    const db = await createTestDb();
    const { rpc, calls: rpcCalls } = testRpc();
    const env: NodeJS.ProcessEnv = {
      SOLANA_SETTLEMENT_MODE: 'payer_broadcast',
      SOLANA_NETWORK: 'devnet',
      SOLANA_RPC_URL: 'https://api.devnet.solana.com',
      SOLANA_USDC_MINT: TEST_MINT,
      SOLANA_ASSET_DECIMALS: '6',
      SOLANA_TREASURY_ADDRESS: payeeSigner.address,
      SOLANA_TREASURY_TOKEN_ACCOUNT: treasuryTokenSigner.address,
      SOLANA_FEE_PAYER_ADDRESS: sponsorSigner.address,
      SOLANA_FACILITATOR_URL: 'http://127.0.0.1:8790',
      SOLANA_MAX_PAYMENT_BASE_UNITS: '10000',
      SOLANA_PAYER_RPC_URL: 'https://api.devnet.solana.com',
      SOLANA_PAYER_ADDRESS: payerSigner.address,
      SOLANA_PAYER_TOKEN_ACCOUNT: payerSourceSigner.address,
      SOLANA_PAYER_KEY_FILE: 'in-memory-payer-key-placeholder',
      SOLANA_LEDGER_DIRECTORY: undefined,
      SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS: '10000',
      SOLANA_PAYER_MAX_TOTAL_BASE_UNITS: '50000',
      SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR: '1000',
      SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS: '50000',
      SOLANA_SPONSOR_KEY_FILE: 'in-memory-sponsor-key-placeholder',
      SOLANA_GATEWAY_URL: 'https://capsule.example',
      SOLANA_GATEWAY_TOKEN_FILE: gatewayTokenFile,
      SOLANA_PAYER_BRIDGE_TOKEN_FILE: payerTokenFile,
      SOLANA_PAYER_BRIDGE_ALLOWED_HOSTS: HOST,
      SOLANA_LEGACY_SIGNERS_RETIRED: 'true',
      SOLANA_LEGACY_PAYER_LEDGER_FILE: payerHistoryFile,
      SOLANA_LEGACY_SPONSOR_LEDGER_FILE: sponsorHistoryFile,
      SOLANA_LEGACY_PAYER_LEDGER_SHA256: sha256(payerHistory),
      SOLANA_LEGACY_SPONSOR_LEDGER_SHA256: sha256(sponsorHistory),
      PORT: '10000',
    };

    const originalFetch = globalThis.fetch;
    const blockedNetworkAttempts: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.startsWith('http://127.0.0.1:')) {
        blockedNetworkAttempts.push(url);
        throw new Error('test blocked non-local network access');
      }
      return originalFetch(input, init);
    });

    const start = () => startHostedSolana(env, { db, port: 0, rpc });
    active = await start();
    const port = (active.server.address() as { port: number }).port;
    const base = `http://127.0.0.1:${port}`;
    const headers = { host: HOST, 'x-forwarded-proto': 'https' };

    const health = await localRequest(`${base}/health`, { headers });
    expect(health.status).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    const authHeaders = { ...headers, authorization: `Bearer ${BRIDGE_TOKEN}` };
    const statusResponse = await localRequest(`${base}/status`, { headers: authHeaders });
    expect(statusResponse.status, statusResponse.text()).toBe(200);
    const status = statusResponse.json() as any;
    expect(status).toMatchObject({
      ok: true,
      source: { rail: 'solana', network: NETWORK, publicAddress: payerSigner.address, readiness: 'configured' },
      ledger: {
        payer: { role: 'payer', owner: payerSigner.address, entries: 0, committedBaseUnits: '0', imported: { entries: 0, committedBaseUnits: '0', committedFeeLamports: '0' } },
        sponsor: { role: 'sponsor', owner: sponsorSigner.address, entries: 0, committedBaseUnits: '0', committedFeeLamports: '0', imported: { entries: 0, committedBaseUnits: '0', committedFeeLamports: '0' } },
        caps: { perPayment: '10000', cumulative: '50000', sponsorFee: '50000' },
        headroomBaseUnits: '10000',
      },
    });
    expect(JSON.stringify(status)).not.toContain(BRIDGE_TOKEN);
    expect(JSON.stringify(status)).not.toContain(GATEWAY_TOKEN);
    expect(JSON.stringify(status)).not.toContain('in-memory-payer-key-placeholder');
    expect(JSON.stringify(status)).not.toContain('in-memory-sponsor-key-placeholder');
    expect(JSON.stringify(status)).not.toContain('signed-header-secret-marker');

    expect((await localRequest(`${base}/status`, { headers: { ...authHeaders, host: 'wrong.example' } })).status).toBe(401);
    expect((await localRequest(`${base}/status`, { headers: { ...authHeaders, origin: 'https://evil.example' } })).status).toBe(401);
    expect((await localRequest(`${base}/status`, { headers })).status).toBe(401);
    expect((await localRequest(`${base}/prepare`, { headers })).status).toBe(404);
    expect((await localRequest(`${base}/admin`, { headers })).status).toBe(404);
    const extraBody = await localRequest(`${base}/pay`, {
      method: 'POST', headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ purchaseId: 'pur_1234567890', extra: 'private-extra-body-marker' }),
    });
    expect(extraBody.status).toBe(400);
    expect(extraBody.text()).not.toContain('private-extra-body-marker');
    expect(signCalls).toEqual([]);

    const stableSource = status.source;
    const stableImport = status.ledger.payer.imported;
    const stableSponsorImport = status.ledger.sponsor.imported;
    const historyScansBeforeRestart = rpcCalls.filter((method) => method === 'getSignaturesForAddress').length;
    await active.close();
    active = await start();
    const restartedPort = (active.server.address() as { port: number }).port;
    const restartedResponse = await localRequest(`http://127.0.0.1:${restartedPort}/status`, { headers: authHeaders });
    expect(restartedResponse.status).toBe(200);
    const restarted = restartedResponse.json() as any;
    expect(restarted.source).toEqual(stableSource);
    expect(restarted.ledger.payer.imported).toEqual(stableImport);
    expect(restarted.ledger.sponsor.imported).toEqual(stableSponsorImport);
    expect(restarted.ledger.headroomBaseUnits).toBe('10000');
    expect(rpcCalls.filter((method) => method === 'getSignaturesForAddress')).toHaveLength(historyScansBeforeRestart);

    await db.run(
      'INSERT INTO hosted_solana_ledger(role,id,signature,amount,fee,header,created_at) VALUES($1,$2,NULL,$3,$4,NULL,$5)',
      'payer', 'reservation:unresolved', '2500', '0', new Date().toISOString(),
    );
    const unavailableResponse = await localRequest(`http://127.0.0.1:${restartedPort}/status`, { headers: authHeaders });
    expect(unavailableResponse.status).toBe(200);
    const unavailable = unavailableResponse.json() as any;
    expect(unavailable.source.readiness).toBe('unavailable');
    expect(unavailable.ledger.payer.incomplete).toBe(1);
    expect(unavailable.ledger.payer.committedBaseUnits).toBe('2500');

    const payResponse = await localRequest(`http://127.0.0.1:${restartedPort}/pay`, {
      method: 'POST', headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ purchaseId: 'pur_1234567890' }),
    });
    expect(payResponse.status).toBe(500);
    expect(signCalls).toEqual([]);
    expect(blockedNetworkAttempts).toEqual([]);
  });
});
