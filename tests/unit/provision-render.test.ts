import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { loadPayerConfig } from '../../clients/payer/config.js';
import { deriveWalletAddress } from '../../clients/payer/hosted.js';
import { PayerLedger, readLedgerSnapshot, retireFileLedger, retiredMarkerPath, type LedgerEntry } from '../../clients/payer/ledger.js';
import { ledgerSourceSha256 } from '../../clients/payer/ledger-import.js';

// Runs scripts/provision-hosted-mcp-render.mjs (under tsx) against a local fake Render API and a throwaway "protected payer" tree.
// Nothing here touches the real Render API, the real wallet or the real ledger.

const SCRIPT = join(process.cwd(), 'scripts', 'provision-hosted-mcp-render.mjs');
const T = 120_000;
const API_KEY = 'rnd_FAKE_api_key_value_0123456789';
const MNEMONIC = `${'abandon '.repeat(23)}art`;
const DECOY_MNEMONIC = 'DECOY-RETIRED-WALLET-MNEMONIC-must-never-be-read';
const BRIDGE_TOKEN = 'bridge-token-secret-value-aaaaaaaa';
const GATEWAY_TOKEN = 'gateway-token-secret-value-bbbbbbbb';
const PASSCODE = 'owner-passcode-secret-cccccccccc';
const DB_URL = 'postgres://user:dbpassword-secret@db.example/app';
const BF_ID = 'preprodBlockfrostSecretProjectId';
const POLICY_ID = 'ab'.repeat(28);
const ASSET = `${POLICY_ID}.555344`; // canonical (dotted) form, as in the payer policy
const ASSET_CONCAT = `${POLICY_ID}555344`; // web service env and Blockfrost use the concatenated form
const TREASURY = 'addr_test1qztreasury0000000000000000000000000000000000000000000000';
const CAP = '102000';
const AMOUNTS = ['20000', '20000', '16830', '10000'] as const; // sums to 66830
const HEADERS = AMOUNTS.map((_, i) => `LEDGER-HEADER-SECRET-${i}`);
const SECRET_VALUES = [API_KEY, MNEMONIC, DECOY_MNEMONIC, BRIDGE_TOKEN, GATEWAY_TOKEN, PASSCODE, DB_URL, BF_ID, ...HEADERS];

type Json = Record<string, unknown>;
interface Recorded {
  method: string;
  path: string;
  body: Json | undefined;
}
interface FakeService {
  id: string;
  name: string;
  type: string;
  ownerId: string;
  repo: string;
  branch: string;
  autoDeployTrigger: string;
  serviceDetails: Json;
  env: Map<string, string>;
  secretFiles: Map<string, string>;
}
interface Fake {
  origin: string;
  requests: Recorded[];
  services: Map<string, FakeService>;
  deploys: string[];
  /** Mutable: what the fake payer returns as the `ledger` block of /status. */
  ledgerStatus: Json;
  balances: { lovelace: string; asset: string };
  setWebEnv(key: string, value: string | null): void;
  close(): Promise<void>;
}
interface Tree {
  root: string;
  envRoot: string;
  hosted: string;
  mnemonicPath: string;
  ledgerPath: string;
  entries: LedgerEntry[];
  sha: string;
  args: string[];
}

let ADDRESS = '';
let FINGERPRINT = '';
const open: Fake[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const f of open.splice(0)) await f.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const tmp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

beforeAll(() => {
  const scratch = tmp('prov-derive-');
  const mnemonicFile = join(scratch, 'payer.mnemonic');
  writeFileSync(mnemonicFile, MNEMONIC);
  const config = loadPayerConfig(
    {
      PAYER_GATEWAY_URL: 'https://gateway.invalid',
      PAYER_GATEWAY_TOKEN_FILE: 'x',
      PAYER_CARDANO_NETWORK: 'cardano:preprod',
      PAYER_CARDANO_MNEMONIC_FILE: mnemonicFile,
      BLOCKFROST_PROJECT_ID: 'x',
      PAYER_MAX_PER_PAYMENT_BASE_UNITS: CAP,
      PAYER_MAX_CUMULATIVE_BASE_UNITS: CAP,
      PAYER_MAX_DAILY_BASE_UNITS: CAP,
      PAYER_MAX_FEE_LOVELACE: '2000000',
      PAYER_MAX_ADA_OUTPUT_LOVELACE: '3000000',
      PAYER_ALLOWED_ASSET_UNIT: ASSET,
      PAYER_EXPECTED_PAY_TO: TREASURY,
    },
    { ledger: 'external' },
  );
  ADDRESS = deriveWalletAddress(config);
  FINGERPRINT = createHash('sha256').update(ADDRESS).digest('hex').slice(0, 16);
});

/** A throwaway protected payer: mnemonic, a real file ledger with 4 accepted entries dated yesterday, and the policy env file. */
function makeTree(opts: { cap?: string; omitPolicy?: boolean; hostedFiles?: boolean } = {}): Tree {
  const root = tmp('prov-secrets-root-');
  const dir = join(root, `cardano-payer-${FINGERPRINT}`);
  mkdirSync(dir, { recursive: true });
  const mnemonicPath = join(dir, 'payer.mnemonic');
  const ledgerPath = join(dir, 'ledger.json');
  writeFileSync(mnemonicPath, `${MNEMONIC}\n`);
  PayerLedger.initialize(ledgerPath);
  const ledger = new PayerLedger(ledgerPath);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  AMOUNTS.forEach((amount, i) =>
    ledger.upsert({
      purchaseId: `pur_ABCDEFGHIJKLM${String(i).padStart(3, '0')}`,
      network: 'cardano:preprod',
      asset: ASSET,
      amountBaseUnits: amount,
      payTo: TREASURY,
      status: 'accepted',
      header: HEADERS[i]!,
      transferReference: String(i + 1).repeat(64),
      createdAt: yesterday,
      updatedAt: yesterday,
    }),
  );
  const envRoot = tmp('prov-env-root-');
  if (!opts.omitPolicy) {
    const cap = opts.cap ?? CAP;
    writeFileSync(
      join(envRoot, '.env.payer'),
      [
        '# policy of the protected payer',
        `PAYER_LEDGER_FILE="${ledgerPath}"`,
        `PAYER_CARDANO_MNEMONIC_FILE=${mnemonicPath.replace(/\\/g, '/')}`,
        'PAYER_CARDANO_NETWORK=cardano:preprod',
        `PAYER_MAX_PER_PAYMENT_BASE_UNITS=${cap}`,
        `PAYER_MAX_CUMULATIVE_BASE_UNITS=${cap}`,
        `PAYER_MAX_DAILY_BASE_UNITS=${cap}`,
        'PAYER_MAX_FEE_LOVELACE=2000000',
        'PAYER_MAX_ADA_OUTPUT_LOVELACE=3000000',
        `PAYER_ALLOWED_ASSET_UNIT=${ASSET}`,
        `PAYER_EXPECTED_PAY_TO=${TREASURY}`,
        '',
      ].join('\n'),
    );
  }
  const hosted = tmp('prov-hosted-');
  if (opts.hostedFiles !== false) {
    writeFileSync(join(hosted, 'cardano-payer-bridge-token'), `${BRIDGE_TOKEN}\n`);
    writeFileSync(join(hosted, 'payer-gateway-token'), `  ${GATEWAY_TOKEN}\n\n`);
    writeFileSync(join(hosted, 'mcp-owner-passcode'), `${PASSCODE}\n`);
    writeFileSync(join(hosted, 'payer.mnemonic'), DECOY_MNEMONIC); // retired wallet: must never be read or uploaded
  }
  const entries = readLedgerSnapshot(ledgerPath);
  return {
    root,
    envRoot,
    hosted,
    mnemonicPath,
    ledgerPath,
    entries,
    sha: ledgerSourceSha256(entries),
    args: ['--secrets-dir', hosted, '--payer-secrets-root', root, '--payer-fingerprint', FINGERPRINT, '--payer-env-roots', envRoot],
  };
}

const readBody = (req: IncomingMessage) =>
  new Promise<Json | undefined>((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw ? (JSON.parse(raw) as Json) : undefined));
  });

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

async function startFake(tree: Tree, opts: { payerPlan?: string; existingPayer?: boolean; webAsset?: string; webTreasury?: string } = {}): Promise<Fake> {
  const requests: Recorded[] = [];
  const services = new Map<string, FakeService>();
  const deploys: string[] = [];
  const deployLists = new Map<string, Array<{ id: string; status: string; createdAt: string; polls: number }>>();
  const deployPolls = new Map<string, number>();
  let counter = 0;
  let origin = '';
  const fake: Fake = {
    origin: '',
    requests,
    services,
    deploys,
    ledgerStatus: {},
    balances: { lovelace: '9000000', asset: '900000' },
    setWebEnv(key, value) {
      const web = services.get('srv-web')!;
      if (value === null) web.env.delete(key);
      else web.env.set(key, value);
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };

  const view = (s: FakeService): Json => ({
    id: s.id,
    name: s.name,
    type: s.type,
    ownerId: s.ownerId,
    repo: s.repo,
    branch: s.branch,
    autoDeployTrigger: s.autoDeployTrigger,
    serviceDetails: s.serviceDetails,
  });

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake');
      const p = url.pathname;
      const method = req.method ?? 'GET';

      // Fake targets (web, payer, Blockfrost) - not part of the Render API, not recorded.
      if (p === '/web/health' || p === '/payer/health') return send(res, 200, { ok: true });
      if (p === '/web/console/') return send(res, 200, { ok: true });
      if (p === '/web/mcp' && method === 'POST') {
        return send(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer resource_metadata="https://x/.well-known/oauth-protected-resource"' });
      }
      if (p === '/payer/status') {
        if (req.headers.authorization !== `Bearer ${BRIDGE_TOKEN}`) return send(res, 401, { ok: false });
        return send(res, 200, {
          ok: true,
          source: { rail: 'cardano', network: 'cardano:preprod', publicAddress: ADDRESS, readiness: 'configured' },
          ledger: fake.ledgerStatus,
        });
      }
      if (p === `/bf/addresses/${ADDRESS}`) {
        if (req.headers.project_id !== BF_ID) return send(res, 403, {});
        return send(res, 200, { amount: [{ unit: 'lovelace', quantity: fake.balances.lovelace }, { unit: ASSET_CONCAT, quantity: fake.balances.asset }] });
      }

      // Render API
      if (!p.startsWith('/v1/')) return send(res, 404, { message: 'nope' });
      const body = await readBody(req);
      requests.push({ method, path: p + url.search, body });
      if (req.headers.authorization !== `Bearer ${API_KEY}`) return send(res, 401, { message: 'unauthorized' });
      const route = p.slice(3);

      if (method === 'GET' && route === '/owners') return send(res, 200, [{ owner: { id: 'own-1', name: 'ws', type: 'user' }, cursor: 'c1' }]);
      if (method === 'GET' && route === '/services') {
        const name = url.searchParams.get('name');
        const rows = [...services.values()].filter((s) => (!name || s.name === name) && s.ownerId === (url.searchParams.get('ownerId') ?? s.ownerId));
        return send(res, 200, rows.map((s) => ({ service: view(s), cursor: `cur-${s.id}` })));
      }
      if (method === 'POST' && route === '/services') {
        const b = body as Json;
        counter += 1;
        const details = b.serviceDetails as Json;
        const s: FakeService = {
          id: `srv-new-${counter}`,
          name: b.name as string,
          type: b.type as string,
          ownerId: b.ownerId as string,
          repo: b.repo as string,
          branch: b.branch as string,
          autoDeployTrigger: b.autoDeployTrigger as string,
          serviceDetails: { ...details, url: `${origin}/payer` },
          env: new Map(),
          secretFiles: new Map(),
        };
        services.set(s.id, s);
        return send(res, 201, { service: view(s), deployId: 'dep-initial' });
      }
      const m = /^\/services\/([^/]+)(?:\/(env-vars|secret-files|deploys)(?:\/([^/]+))?)?$/.exec(route);
      const svc = m ? services.get(m[1]!) : undefined;
      if (!m || !svc) return send(res, 404, { message: 'service not found' });
      const [, , sub, key] = m;
      if (!sub && method === 'GET') return send(res, 200, view(svc));
      if (!sub && method === 'PATCH') {
        const b = body as Json;
        if (b.branch) svc.branch = b.branch as string;
        if (b.autoDeployTrigger) svc.autoDeployTrigger = b.autoDeployTrigger as string;
        const esd = ((b.serviceDetails as Json | undefined)?.envSpecificDetails ?? undefined) as Json | undefined;
        if (esd?.dockerfilePath) {
          svc.serviceDetails = { ...svc.serviceDetails, envSpecificDetails: { ...(svc.serviceDetails.envSpecificDetails as Json), dockerfilePath: esd.dockerfilePath } };
        }
        return send(res, 200, view(svc));
      }
      if (sub === 'env-vars' && !key && method === 'GET') {
        return send(res, 200, [...svc.env].map(([k, v]) => ({ envVar: { key: k, value: v }, cursor: `e-${k}` })));
      }
      if (sub === 'env-vars' && key && method === 'PUT') {
        svc.env.set(decodeURIComponent(key), (body as Json).value as string);
        return send(res, 200, { key, value: (body as Json).value });
      }
      if (sub === 'secret-files' && key && method === 'PUT') {
        svc.secretFiles.set(decodeURIComponent(key), (body as Json).content as string);
        return send(res, 201, { name: key });
      }
      if (sub === 'deploys' && !key && method === 'POST') {
        deploys.push(svc.id);
        const list = deployLists.get(svc.id) ?? [];
        list.unshift({ id: `dep-${svc.id}-${list.length}`, status: 'build_in_progress', createdAt: new Date().toISOString(), polls: 0 });
        deployLists.set(svc.id, list);
        return send(res, 202, {});
      }
      if (sub === 'deploys' && !key && method === 'GET') {
        // A new service's own first deploy (before env vars exist) failed long before ours: it must not decide the outcome.
        const list = deployLists.get(svc.id) ?? [];
        const rows = [...list, { id: `dep-${svc.id}-creation`, status: 'update_failed', createdAt: '2020-01-01T00:00:00.000Z', polls: 99 }];
        if (list[0]) { list[0].polls++; list[0].status = list[0].polls < 2 ? 'build_in_progress' : 'live'; }
        return send(res, 200, rows.map((d) => ({ deploy: { id: d.id, status: d.status, createdAt: d.createdAt }, cursor: d.id })));
      }
      return send(res, 404, { message: 'unsupported in fake' });
    })();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.origin = origin;
  fake.ledgerStatus = {
    address: ADDRESS,
    committedBaseUnits: '66830',
    entries: { total: 4, signing: 0, signed: 0, accepted: 4 },
    imported: { entries: 4, committedBaseUnits: '66830', sourceSha256: tree.sha, importedAt: '2026-10-07T00:00:00.000Z' },
    caps: { perPayment: CAP, cumulative: CAP, daily: CAP },
  };

  const web: FakeService = {
    id: 'srv-web',
    name: 'token2049-origins',
    type: 'web_service',
    ownerId: 'own-1',
    repo: 'https://github.com/example/token2049-origins',
    branch: 'build/demo-polish-latency',
    autoDeployTrigger: 'off',
    serviceDetails: { runtime: 'docker', plan: 'free', region: 'singapore', url: `${origin}/web` },
    env: new Map([
      ['DATABASE_URL', DB_URL],
      ['BLOCKFROST_PROJECT_ID', BF_ID],
      ['BLOCKFROST_BASE_URL', `${origin}/bf`],
      ['CARDANO_ASSET_UNIT', opts.webAsset ?? ASSET_CONCAT],
      ['CARDANO_TREASURY_ADDRESS', opts.webTreasury ?? TREASURY],
      ['UNRELATED_FLAG', 'keep-me'],
      ['ANOTHER_UNRELATED', 'also-keep'],
    ]),
    secretFiles: new Map(),
  };
  services.set(web.id, web);
  if (opts.existingPayer || opts.payerPlan) {
    services.set('srv-payer', {
      id: 'srv-payer',
      name: 't2o-cardano-payer',
      type: 'web_service',
      ownerId: 'own-1',
      repo: web.repo,
      branch: 'develop',
      autoDeployTrigger: 'commit',
      serviceDetails: {
        runtime: 'docker',
        plan: opts.payerPlan ?? 'free',
        region: 'singapore',
        url: `${origin}/payer`,
        envSpecificDetails: { dockerfilePath: './Dockerfile.payer', dockerContext: '.' },
      },
      env: new Map([['PAYER_MAX_PER_PAYMENT_BASE_UNITS', '1']]),
      secretFiles: new Map(),
    });
  }
  open.push(fake);
  return fake;
}

interface Run {
  code: number;
  out: string;
  err: string;
}
function run(fake: Fake, tree: Tree, args: string[] = [], env: Record<string, string | undefined> = {}): Promise<Run> {
  const smoke = JSON.stringify([process.execPath, '-e', 'process.exit(process.env.HOSTED_MCP_PASSCODE ? 0 : 3)']);
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ['--import', 'tsx', SCRIPT, ...tree.args, ...args],
      {
        env: {
          ...process.env,
          RENDER_API_KEY: API_KEY,
          RENDER_API_BASE: `${fake.origin}/v1`,
          PROVISION_SMOKE_CMD: smoke,
          PROVISION_POLL_MS: '20',
          PROVISION_VERIFY_TIMEOUT_MS: '600',
          ...env,
        } as NodeJS.ProcessEnv,
        timeout: 100_000,
        cwd: process.cwd(),
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : 1) : 0;
        resolve({ code, out: stdout, err: stderr });
      },
    );
  });
}

const writes = (reqs: Recorded[]) => reqs.filter((r) => r.method !== 'GET');
const payerOf = (f: Fake) => [...f.services.values()].find((s) => s.name === 't2o-cardano-payer');
const lastLines = (out: string, n = 3) => out.trim().split('\n').slice(-n);
const noSecrets = (r: Run) => {
  for (const s of SECRET_VALUES) {
    expect(r.out).not.toContain(s);
    expect(r.err).not.toContain(s);
  }
};

describe('provision-hosted-mcp-render (existing canonical payer)', () => {
  it('reuses the protected wallet: retires the file ledger first, configures from policy, deploys, verifies, and is idempotent', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    const first = await run(fake, tree);
    expect(first.err).toBe('');
    expect(first.code).toBe(0);
    expect(lastLines(first.out)).toEqual(['Hosted MCP: PASS', 'Payer: READY', `MCP URL: ${fake.origin}/web/mcp`]);
    // final report block
    expect(first.out).toContain(`Existing wallet address: ${ADDRESS}   (fingerprint ${FINGERPRINT})`);
    expect(first.out).toContain('On-chain balance: 9000000 lovelace, 900000 tUSDM base units');
    expect(first.out).toContain('Imported historical entries: 4   (accepted 4, signed 0, signing 0)');
    expect(first.out).toContain('Committed tUSDM base units (history): 66830');
    expect(first.out).toMatch(/Policy caps \(per payment \/ daily \/ cumulative\): 102000 \/ 102000 \/ 102000 {3}\[from .*\.env\.payer\]/);
    expect(first.out).toContain('Safe remaining headroom: 35170 base units');
    expect(first.out).toContain('Legacy file signer: DISABLED');
    expect(first.out).toContain('Public MCP smoke: PASS');
    noSecrets(first);

    // retire marker exists, matches this history, and the old file signer is dead
    const marker = JSON.parse(readFileSync(retiredMarkerPath(tree.ledgerPath), 'utf8')) as Json;
    expect(marker).toMatchObject({ sourceSha256: tree.sha, entryCount: 4, payerAddress: ADDRESS });
    expect(() => new PayerLedger(tree.ledgerPath).assertReady()).toThrow(/retired/);

    // payer service: free docker web service, no disk
    const creates = fake.requests.filter((r) => r.method === 'POST' && r.path === '/v1/services');
    expect(creates).toHaveLength(1);
    const body = creates[0]!.body as Json;
    expect(body).toMatchObject({ type: 'web_service', name: 't2o-cardano-payer', ownerId: 'own-1', branch: 'main', autoDeployTrigger: 'off' });
    expect(body.serviceDetails).toMatchObject({ runtime: 'docker', plan: 'free', region: 'singapore', healthCheckPath: '/health' });
    expect(JSON.stringify(body)).not.toMatch(/disk|private_service/i);

    // payer env: exactly the expected keys, from the policy (caps 102000, not the old constants)
    const payer = payerOf(fake)!;
    expect([...payer.env.keys()].sort()).toEqual(
      [
        'DATABASE_URL', 'PAYER_BRIDGE_ALLOWED_HOSTS', 'PAYER_BRIDGE_TOKEN_FILE', 'PAYER_GATEWAY_URL', 'PAYER_GATEWAY_TOKEN_FILE',
        'PAYER_CARDANO_NETWORK', 'PAYER_CARDANO_MNEMONIC_FILE', 'PAYER_WALLET_ADDRESS', 'BLOCKFROST_PROJECT_ID', 'BLOCKFROST_BASE_URL',
        'PAYER_ALLOWED_ASSET_UNIT', 'PAYER_EXPECTED_PAY_TO', 'PAYER_MAX_PER_PAYMENT_BASE_UNITS', 'PAYER_MAX_CUMULATIVE_BASE_UNITS',
        'PAYER_MAX_DAILY_BASE_UNITS', 'PAYER_MAX_FEE_LOVELACE', 'PAYER_MAX_ADA_OUTPUT_LOVELACE', 'PAYER_LEGACY_LEDGER_FILE',
        'PAYER_LEGACY_LEDGER_SHA256',
      ].sort(),
    );
    expect(Object.fromEntries(payer.env)).toMatchObject({
      DATABASE_URL: DB_URL,
      PAYER_BRIDGE_ALLOWED_HOSTS: new URL(fake.origin).host,
      PAYER_BRIDGE_TOKEN_FILE: '/etc/secrets/cardano-payer-bridge-token',
      PAYER_GATEWAY_URL: `${fake.origin}/web`,
      PAYER_GATEWAY_TOKEN_FILE: '/etc/secrets/payer-gateway-token',
      PAYER_CARDANO_NETWORK: 'cardano:preprod',
      PAYER_CARDANO_MNEMONIC_FILE: '/etc/secrets/payer-cardano-mnemonic',
      PAYER_WALLET_ADDRESS: ADDRESS,
      BLOCKFROST_PROJECT_ID: BF_ID,
      PAYER_ALLOWED_ASSET_UNIT: ASSET,
      PAYER_EXPECTED_PAY_TO: TREASURY,
      PAYER_MAX_PER_PAYMENT_BASE_UNITS: CAP,
      PAYER_MAX_CUMULATIVE_BASE_UNITS: CAP,
      PAYER_MAX_DAILY_BASE_UNITS: CAP,
      PAYER_MAX_FEE_LOVELACE: '2000000',
      PAYER_MAX_ADA_OUTPUT_LOVELACE: '3000000',
      PAYER_LEGACY_LEDGER_FILE: '/etc/secrets/legacy-ledger',
      PAYER_LEGACY_LEDGER_SHA256: tree.sha,
    });

    // secret files: protected mnemonic and the exact legacy ledger; hosted tokens trimmed
    expect(Object.fromEntries(payer.secretFiles)).toEqual({
      'payer-cardano-mnemonic': readFileSync(tree.mnemonicPath, 'utf8'),
      'legacy-ledger': readFileSync(tree.ledgerPath, 'utf8'),
      'cardano-payer-bridge-token': BRIDGE_TOKEN,
      'payer-gateway-token': GATEWAY_TOKEN,
    });
    const web = fake.services.get('srv-web')!;
    expect(Object.fromEntries(web.secretFiles)).toEqual({ 'mcp-owner-passcode': PASSCODE, 'cardano-payer-bridge-token': BRIDGE_TOKEN });
    // the retired hosted-demo wallet is never read or uploaded
    expect(JSON.stringify(fake.requests)).not.toContain(DECOY_MNEMONIC);

    // web env: exact keys, unrelated vars untouched, hash correct, branch patched
    expect(web.env.get('UNRELATED_FLAG')).toBe('keep-me');
    expect(web.env.get('ANOTHER_UNRELATED')).toBe('also-keep');
    expect(web.env.get('DATABASE_URL')).toBe(DB_URL);
    expect(Object.fromEntries(web.env)).toMatchObject({
      PUBLIC_BASE_URL: `${fake.origin}/web`,
      MCP_PUBLIC_URL: `${fake.origin}/web`,
      MCP_HOSTED_ENABLED: 'true',
      MCP_OAUTH_OWNER_PASSCODE_FILE: '/etc/secrets/mcp-owner-passcode',
      CARDANO_PAYER_BRIDGE_URL: `${fake.origin}/payer`,
      CARDANO_PAYER_BRIDGE_TOKEN_FILE: '/etc/secrets/cardano-payer-bridge-token',
      MCP_PAYER_GATEWAY_TOKEN_SHA256: createHash('sha256').update(GATEWAY_TOKEN).digest('hex'),
      SHOPIFY_BROWSER_LOW_MEMORY: 'true',
      CARDANO_ASSET_UNIT: ASSET_CONCAT, // not rewritten
      CARDANO_TREASURY_ADDRESS: TREASURY,
    });
    expect(web.branch).toBe('main');

    // per-key PUT only
    const envWrites = writes(fake.requests).filter((r) => r.path.includes('/env-vars'));
    for (const w of envWrites) {
      expect(w.method).toBe('PUT');
      expect(w.path).toMatch(/^\/v1\/services\/[^/]+\/env-vars\/[A-Z0-9_]+$/);
      expect(Object.keys(w.body ?? {})).toEqual(['value']);
    }
    const webKeys = envWrites.filter((w) => w.path.startsWith('/v1/services/srv-web/')).map((w) => w.path.split('/').pop());
    expect(webKeys.sort()).toEqual(
      ['CARDANO_PAYER_BRIDGE_TOKEN_FILE', 'CARDANO_PAYER_BRIDGE_URL', 'MCP_HOSTED_ENABLED', 'MCP_OAUTH_OWNER_PASSCODE_FILE', 'MCP_PAYER_GATEWAY_TOKEN_SHA256', 'MCP_PUBLIC_URL', 'PUBLIC_BASE_URL', 'SHOPIFY_BROWSER_LOW_MEMORY'].sort(),
    );

    // deploys: web then payer
    expect(fake.deploys).toEqual(['srv-web', payer.id]);

    // idempotent second run: same marker, no new service, no env/secret/deploy churn beyond secret file re-uploads
    const markerBefore = readFileSync(retiredMarkerPath(tree.ledgerPath), 'utf8');
    const before = fake.requests.length;
    const second = await run(fake, tree, ['--no-deploy']);
    expect(second.code).toBe(0);
    expect(second.out).toContain('already retired for this history');
    expect(readFileSync(retiredMarkerPath(tree.ledgerPath), 'utf8')).toBe(markerBefore);
    expect(fake.requests.filter((r) => r.method === 'POST' && r.path === '/v1/services')).toHaveLength(1);
    const again = writes(fake.requests.slice(before));
    expect(again.filter((r) => r.path.includes('/env-vars'))).toHaveLength(0);
    expect(again.filter((r) => r.method === 'POST' || r.method === 'PATCH')).toHaveLength(0);
    expect(fake.deploys).toHaveLength(2);
    noSecrets(second);
  }, T);

  it('patches an existing free payer only where it differs', async () => {
    const tree = makeTree();
    const fake = await startFake(tree, { existingPayer: true });
    const res = await run(fake, tree, ['--no-deploy']);
    expect(res.code).toBe(0);
    expect(fake.requests.some((r) => r.method === 'POST' && r.path === '/v1/services')).toBe(false);
    const patches = fake.requests.filter((r) => r.method === 'PATCH' && r.path === '/v1/services/srv-payer');
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toEqual({ branch: 'main', autoDeployTrigger: 'off' });
    expect(payerOf(fake)!.env.get('PAYER_MAX_PER_PAYMENT_BASE_UNITS')).toBe(CAP);
  }, T);

  it('generates missing hosted-demo tokens (not wallet keys) and reuses them on a rerun', async () => {
    const tree = makeTree({ hostedFiles: false });
    const fake = await startFake(tree);
    fake.setWebEnv('UNRELATED_FLAG', 'x');
    // the fake payer checks the bridge token, so teach it the generated one after the first write
    const bridgeFile = join(tree.hosted, 'cardano-payer-bridge-token');
    const res = await run(fake, tree, ['--no-deploy']);
    expect(existsSync(bridgeFile)).toBe(true);
    const generated = readFileSync(bridgeFile, 'utf8').trim();
    expect(generated.length).toBeGreaterThanOrEqual(24);
    expect(res.out).toContain('cardano-payer-bridge-token: generated');
    expect(res.out).not.toContain(generated);
    expect(payerOf(fake)!.secretFiles.get('cardano-payer-bridge-token')).toBe(generated);
    expect(fake.services.get('srv-web')!.secretFiles.get('cardano-payer-bridge-token')).toBe(generated);
    expect(existsSync(join(tree.hosted, 'payer.mnemonic'))).toBe(false); // nothing is created for the retired wallet
    await run(fake, tree, ['--no-deploy']);
    expect(readFileSync(bridgeFile, 'utf8').trim()).toBe(generated);
  }, T);

  it('reports NOT FUNDED (exit 0) when the existing wallet lacks tUSDM, and NOT READY (cap exhausted) at zero headroom', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    fake.balances = { lovelace: '9000000', asset: '100' };
    const a = await run(fake, tree, ['--no-deploy']);
    expect(a.code).toBe(0);
    expect(a.out).toMatch(/Payer: NOT FUNDED \(existing wallet lacks enough tUSDM/);
    expect(a.out).toContain('Hosted MCP: PASS');
    expect(lastLines(a.out).at(-1)).toBe(`MCP URL: ${fake.origin}/web/mcp`);

    const tree2 = makeTree({ cap: '66830' });
    const fake2 = await startFake(tree2);
    fake2.ledgerStatus = { ...fake2.ledgerStatus, caps: { perPayment: '66830', cumulative: '66830', daily: '66830' } };
    const b = await run(fake2, tree2, ['--no-deploy']);
    expect(b.code).toBe(0);
    expect(b.out).toContain('Safe remaining headroom: 0 base units');
    expect(b.out).toContain('Payer: NOT READY (cap exhausted)');
  }, T);

  it('reports NOT READY with a non-zero exit when /status does not prove the imported ledger', async () => {
    const wrongHash = makeTree();
    const f1 = await startFake(wrongHash);
    f1.ledgerStatus = { ...f1.ledgerStatus, imported: { entries: 4, committedBaseUnits: '66830', sourceSha256: 'f'.repeat(64), importedAt: 'x' } };
    const a = await run(f1, wrongHash, ['--no-deploy']);
    expect(a.code).toBe(1);
    expect(a.out).toMatch(/Payer: NOT READY \(imported ledger hash does not match/);

    const wrongCaps = makeTree();
    const f2 = await startFake(wrongCaps);
    f2.ledgerStatus = { ...f2.ledgerStatus, caps: { perPayment: '500000', cumulative: CAP, daily: CAP } };
    const b = await run(f2, wrongCaps, ['--no-deploy']);
    expect(b.code).toBe(1);
    expect(b.out).toContain('Payer: NOT READY (payer caps differ from the policy)');

    const lowCommitted = makeTree();
    const f3 = await startFake(lowCommitted);
    f3.ledgerStatus = { ...f3.ledgerStatus, committedBaseUnits: '1' };
    const c = await run(f3, lowCommitted, ['--no-deploy']);
    expect(c.code).toBe(1);
    expect(c.out).toContain('Payer: NOT READY (hosted committed spend is below');
  }, T);

  it('fails with Hosted MCP: FAIL (exit 1) when the smoke command fails', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    const res = await run(fake, tree, ['--no-deploy'], { PROVISION_SMOKE_CMD: JSON.stringify([process.execPath, '-e', 'process.exit(5)']) });
    expect(res.code).toBe(1);
    expect(res.out).toContain('Hosted MCP: FAIL');
    expect(res.out).not.toContain('Hosted MCP: PASS');
    expect(res.out).toContain('Public MCP smoke: FAIL');
  }, T);

  it('fails closed on a fingerprint mismatch: no Render call, no marker', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    const other = join(tree.root, `cardano-payer-${'0'.repeat(16)}`);
    mkdirSync(other);
    writeFileSync(join(other, 'payer.mnemonic'), `${MNEMONIC}\n`); // wrong fingerprint for this mnemonic
    writeFileSync(join(other, 'ledger.json'), readFileSync(tree.ledgerPath));
    const res = await run(fake, tree, ['--payer-fingerprint', '0'.repeat(16), '--policy-file', join(tree.envRoot, '.env.payer')]);
    expect(res.code).not.toBe(0);
    expect(res.err).toMatch(/fingerprint/);
    expect(fake.requests).toHaveLength(0);
    expect(existsSync(retiredMarkerPath(tree.ledgerPath))).toBe(false);
    noSecrets(res);
  }, T);

  it('fails closed when the protected payer files or the policy are missing', async () => {
    const tree = makeTree({ omitPolicy: true });
    const fake = await startFake(tree);
    const noPolicy = await run(fake, tree);
    expect(noPolicy.code).not.toBe(0);
    expect(noPolicy.err).toMatch(/No current payer policy/);
    expect(fake.requests).toHaveLength(0);

    const noFiles = await run(fake, tree, ['--payer-secrets-root', join(tree.root, 'nope')]);
    expect(noFiles.code).not.toBe(0);
    expect(noFiles.err).toMatch(/not found/);
    expect(fake.requests).toHaveLength(0);
  }, T);

  it('fails when the policy is incomplete (it never invents or raises a cap)', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    const file = join(tree.envRoot, '.env.payer');
    writeFileSync(file, readFileSync(file, 'utf8').replace(/PAYER_MAX_DAILY_BASE_UNITS=.*\n/, ''));
    const res = await run(fake, tree);
    expect(res.code).not.toBe(0);
    expect(res.err).toContain('PAYER_MAX_DAILY_BASE_UNITS');
    expect(fake.requests).toHaveLength(0);
  }, T);

  it('uses the newest matching policy file and reports older disagreeing candidates', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    const old = join(tree.envRoot, '.env.old');
    writeFileSync(old, readFileSync(join(tree.envRoot, '.env.payer'), 'utf8').replace(new RegExp(`=${CAP}\\b`, 'g'), '=999999'));
    const past = new Date(Date.now() - 3_600_000);
    (await import('node:fs')).utimesSync(old, past, past);
    const res = await run(fake, tree, ['--dry-run']);
    expect(res.code).toBe(0);
    expect(res.out).toMatch(/other policy candidate .*\.env\.old \(older\) differs on/);
    expect(res.out).toMatch(/\[from .*\.env\.payer\]/);
  }, T);

  it('prefers an owner-authorised policy file kept in the protected payer directory (newest wins) and uses its caps', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    const raised = String(Number(CAP) * 50);
    const authorised = join(dirname(tree.ledgerPath), '.env.hosted-policy');
    writeFileSync(authorised, readFileSync(join(tree.envRoot, '.env.payer'), 'utf8').replace(new RegExp(`PAYER_MAX_(PER_PAYMENT|CUMULATIVE|DAILY)_BASE_UNITS=${CAP}(?!\\d)`, 'g'), (_m, k) => `PAYER_MAX_${k}_BASE_UNITS=${raised}`));
    const res = await run(fake, tree, ['--dry-run']);
    expect(res.code).toBe(0);
    expect(res.out).toContain(`per payment ${raised}, cumulative ${raised}, daily ${raised}`);
    expect(res.out).toMatch(/\[from .*\.env\.hosted-policy\]/);
  }, T);

  it.each([
    ['treasury', { webTreasury: 'addr_test1qzdifferenttreasury00000000000000000000000000000000000000' }, /CARDANO_TREASURY_ADDRESS/],
    ['asset', { webAsset: `${'cd'.repeat(28)}555344` }, /CARDANO_ASSET_UNIT/],
  ])('refuses a %s that differs between the web service and the payer policy: no writes, no marker', async (_n, webOpts, pattern) => {
    const tree = makeTree();
    const fake = await startFake(tree, webOpts);
    const res = await run(fake, tree);
    expect(res.code).not.toBe(0);
    expect(res.err).toMatch(pattern);
    expect(writes(fake.requests)).toHaveLength(0);
    expect(existsSync(retiredMarkerPath(tree.ledgerPath))).toBe(false);
  }, T);

  it('refuses while the legacy ledger is locked (a payment may be in flight)', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    writeFileSync(`${tree.ledgerPath}.lock`, '');
    const res = await run(fake, tree);
    expect(res.code).not.toBe(0);
    expect(res.err).toMatch(/locked/);
    expect(fake.requests).toHaveLength(0);
    expect(existsSync(retiredMarkerPath(tree.ledgerPath))).toBe(false);
  }, T);

  it('refuses a ledger already retired for a different history', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    retireFileLedger(tree.ledgerPath, { reason: 'other', sourceSha256: 'a'.repeat(64), entryCount: 9, payerAddress: ADDRESS });
    const res = await run(fake, tree);
    expect(res.code).not.toBe(0);
    expect(res.err).toMatch(/different history/);
    expect(fake.requests).toHaveLength(0);
  }, T);

  it('stops before retiring when the web service lacks a required env var or the payer is not on the free plan', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    fake.setWebEnv('DATABASE_URL', null);
    const a = await run(fake, tree);
    expect(a.code).not.toBe(0);
    expect(a.err).toContain('DATABASE_URL');
    expect(writes(fake.requests)).toHaveLength(0);
    expect(existsSync(retiredMarkerPath(tree.ledgerPath))).toBe(false);

    const tree2 = makeTree();
    const paid = await startFake(tree2, { payerPlan: 'starter' });
    const b = await run(paid, tree2);
    expect(b.code).not.toBe(0);
    expect(b.err).toMatch(/not free/);
    expect(writes(paid.requests)).toHaveLength(0);
    expect(existsSync(retiredMarkerPath(tree2.ledgerPath))).toBe(false);
  }, T);

  it('--dry-run performs only GETs, creates no marker and writes no secrets', async () => {
    const tree = makeTree({ hostedFiles: false });
    const fake = await startFake(tree);
    const res = await run(fake, tree, ['--dry-run']);
    expect(res.code).toBe(0);
    expect(fake.requests.length).toBeGreaterThan(0);
    expect(fake.requests.every((r) => r.method === 'GET')).toBe(true);
    expect(payerOf(fake)).toBeUndefined();
    expect(existsSync(retiredMarkerPath(tree.ledgerPath))).toBe(false);
    expect(existsSync(join(tree.hosted, 'payer-gateway-token'))).toBe(false);
    expect(res.out).toContain('would create');
    expect(res.out).toContain('Safe remaining headroom: 35170 base units');
    expect(res.out).toContain('Legacy file signer: pending retirement (dry run)');
    expect(res.out).toContain('Dry run complete');
    noSecrets(res);
  }, T);

  it('rejects an unknown flag and a malformed fingerprint before doing anything', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    expect((await run(fake, tree, ['--bogus'])).code).not.toBe(0);
    expect((await run(fake, tree, ['--payer-fingerprint', 'XYZ'])).code).not.toBe(0);
    expect(fake.requests).toHaveLength(0);
  }, T);
});

describe('provision-hosted-mcp-render Render credential discovery', () => {
  const cliConfig = (key: string, expiresAt: number) =>
    ['version: 1', 'workspace: tea-test', 'api:', `    key: ${key}`, `    expires_at: ${expiresAt}`, '    host: https://api.render.com/v1/', '    refreshtoken: rnd_refresh_SECRET', ''].join('\n');
  const future = () => Math.floor(Date.now() / 1000) + 3600;

  it('RENDER_API_KEY wins over the CLI config', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    const cfg = join(tmp('prov-cli-'), 'cli.yaml');
    writeFileSync(cfg, cliConfig('rnd_WRONG_cli_key_value', future()));
    const res = await run(fake, tree, ['--dry-run'], { RENDER_CLI_CONFIG: cfg });
    expect(res.code).toBe(0);
  }, T);

  it('uses the Render CLI stored credential when RENDER_API_KEY is unset', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    const cfg = join(tmp('prov-cli-'), 'cli.yaml');
    writeFileSync(cfg, cliConfig(API_KEY, future()));
    const res = await run(fake, tree, ['--dry-run'], { RENDER_API_KEY: undefined, RENDER_CLI_CONFIG: cfg });
    expect(res.code).toBe(0);
    noSecrets(res);
  }, T);

  it('asks the Render CLI to refresh an expired credential, then continues', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    const cfg = join(tmp('prov-cli-'), 'cli.yaml');
    writeFileSync(cfg, cliConfig('rnd_EXPIRED_key_value_xxxx', Math.floor(Date.now() / 1000) - 10));
    const refresher = `require('fs').writeFileSync(process.env.RENDER_CLI_CONFIG, ${JSON.stringify(cliConfig(API_KEY, future()))})`;
    const res = await run(fake, tree, ['--dry-run'], {
      RENDER_API_KEY: undefined,
      RENDER_CLI_CONFIG: cfg,
      RENDER_CLI_CMD: JSON.stringify([process.execPath, '-e', refresher]),
    });
    expect(res.code).toBe(0);
    expect(res.out).toContain('asking the Render CLI to refresh');
    noSecrets(res);
  }, T);

  it('fails clearly (without printing it) when the credential is still expired after the refresh', async () => {
    const tree = makeTree();
    const fake = await startFake(tree);
    const cfg = join(tmp('prov-cli-'), 'cli.yaml');
    writeFileSync(cfg, cliConfig('rnd_EXPIRED_key_value_xxxx', Math.floor(Date.now() / 1000) - 10));
    const res = await run(fake, tree, ['--dry-run'], {
      RENDER_API_KEY: undefined,
      RENDER_CLI_CONFIG: cfg,
      RENDER_CLI_CMD: JSON.stringify([process.execPath, '-e', '0']),
    });
    expect(res.code).not.toBe(0);
    expect(res.err).toMatch(/still expired/);
    expect(res.out + res.err).not.toContain('rnd_EXPIRED_key_value_xxxx');
    expect(res.out + res.err).not.toContain('rnd_refresh_SECRET');
    expect(fake.requests).toHaveLength(0);
  }, T);
});
