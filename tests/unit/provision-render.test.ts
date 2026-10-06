import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs scripts/provision-hosted-mcp-render.mjs against a local fake Render API. Nothing here touches the real Render API.

const SCRIPT = join(process.cwd(), 'scripts', 'provision-hosted-mcp-render.mjs');
const API_KEY = 'rnd_FAKE_api_key_value_0123456789';
const MNEMONIC = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima';
const BRIDGE_TOKEN = 'bridge-token-secret-value-aaaa';
const GATEWAY_TOKEN = 'gateway-token-secret-value-bbbb';
const PASSCODE = 'owner-passcode-secret-cccc';
const DB_URL = 'postgres://user:dbpassword-secret@db.example/app';
const BF_ID = 'preprodBlockfrostSecretProjectId';
const ASSET = 'c0ffee00USDM';
const TREASURY = 'addr_test1qztreasury0000000000000000000000000000000000000000000000';
const WALLET = 'addr_test1qzxfrsznxqm4y2f40jv4xfdydpagzmva82c4asgzdvhsk6eqrvlay7vdxxca7rzlk5z29pe756yq58rutu6v4d02hmtqjy2drl';
const SECRET_VALUES = [API_KEY, MNEMONIC, BRIDGE_TOKEN, GATEWAY_TOKEN, PASSCODE, DB_URL, BF_ID];

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
  payerStatusOk: boolean;
  funded: boolean;
  setWebEnv(key: string, value: string | null): void;
  close(): Promise<void>;
}

const open: Fake[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const f of open.splice(0)) await f.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

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

async function startFake(opts: { payerPlan?: string; existingPayer?: boolean } = {}): Promise<Fake> {
  const requests: Recorded[] = [];
  const services = new Map<string, FakeService>();
  const deploys: string[] = [];
  const deployPolls = new Map<string, number>();
  let counter = 0;
  let origin = '';
  const fake: Fake = {
    origin: '',
    requests,
    services,
    deploys,
    payerStatusOk: true,
    funded: true,
    setWebEnv(key, value) {
      const web = services.get('srv-web')!;
      if (value === null) web.env.delete(key);
      else web.env.set(key, value);
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };

  const payerDetails = (name: string, plan: string): Json => ({
    runtime: 'docker',
    plan,
    region: 'singapore',
    url: `${origin}/payer`,
    healthCheckPath: '/health',
    envSpecificDetails: { dockerfilePath: './Dockerfile.payer', dockerContext: '.' },
    name,
  });
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
        if (!fake.payerStatusOk) return send(res, 503, { ok: false });
        return send(res, 200, { ok: true, source: { rail: 'cardano', network: 'cardano:preprod', publicAddress: WALLET, readiness: 'configured' } });
      }
      if (p === `/bf/addresses/${WALLET}`) {
        if (req.headers.project_id !== BF_ID) return send(res, 403, {});
        if (!fake.funded) return send(res, 200, { amount: [{ unit: 'lovelace', quantity: '1000000' }] });
        return send(res, 200, { amount: [{ unit: 'lovelace', quantity: '9000000' }, { unit: ASSET, quantity: '900000' }] });
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
        return send(res, 201, { id: `dep-${svc.id}`, status: 'created' });
      }
      if (sub === 'deploys' && key && method === 'GET') {
        const n = (deployPolls.get(key) ?? 0) + 1;
        deployPolls.set(key, n);
        return send(res, 200, { id: key, status: n < 2 ? 'build_in_progress' : 'live' });
      }
      return send(res, 404, { message: 'unsupported in fake' });
    })();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  fake.origin = origin;

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
      ['CARDANO_ASSET_UNIT', ASSET],
      ['CARDANO_TREASURY_ADDRESS', TREASURY],
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
      serviceDetails: payerDetails('t2o-cardano-payer', opts.payerPlan ?? 'free'),
      env: new Map([['PAYER_MAX_PER_PAYMENT_BASE_UNITS', '500000']]),
      secretFiles: new Map(),
    });
  }
  open.push(fake);
  return fake;
}

function makeSecrets(omit?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'prov-secrets-'));
  dirs.push(dir);
  const files: Record<string, string> = {
    'payer.mnemonic': `${MNEMONIC}\r\n`,
    'cardano-payer-bridge-token': `${BRIDGE_TOKEN}\n`,
    'payer-gateway-token': `  ${GATEWAY_TOKEN}\n\n`,
    'mcp-owner-passcode': `${PASSCODE}\n`,
  };
  for (const [name, content] of Object.entries(files)) if (name !== omit) writeFileSync(join(dir, name), content);
  return dir;
}

interface Run {
  code: number;
  out: string;
  err: string;
}
function run(fake: Fake, secretsDir: string, args: string[], env: Record<string, string> = {}): Promise<Run> {
  const smoke = JSON.stringify([process.execPath, '-e', 'process.exit(process.env.HOSTED_MCP_PASSCODE ? 0 : 3)']);
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [SCRIPT, '--secrets-dir', secretsDir, ...args],
      {
        env: {
          ...process.env,
          RENDER_API_KEY: API_KEY,
          RENDER_API_BASE: `${fake.origin}/v1`,
          PROVISION_SMOKE_CMD: smoke,
          PROVISION_POLL_MS: '20',
          PROVISION_VERIFY_TIMEOUT_MS: '600',
          ...env,
        },
        timeout: 60_000,
      },
      (error, stdout, stderr) => {
        const code = error ? (typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code) : 1) : 0;
        resolve({ code, out: stdout, err: stderr });
      },
    );
  });
}

const writes = (f: Fake) => f.requests.filter((r) => r.method !== 'GET');
const payerOf = (f: Fake) => [...f.services.values()].find((s) => s.name === 't2o-cardano-payer');
const lastLines = (out: string) => out.trim().split('\n').slice(-3);

describe('provision-hosted-mcp-render', () => {
  it('creates a free payer, sets env per key, uploads trimmed secrets, deploys web then payer, and is idempotent', async () => {
    const fake = await startFake();
    const secrets = makeSecrets();
    const first = await run(fake, secrets, []);
    expect(first.err).toBe('');
    expect(first.code).toBe(0);
    expect(lastLines(first.out)).toEqual(['Hosted MCP: PASS', 'Payer: READY', `MCP URL: ${fake.origin}/web/mcp`]);

    // payer creation
    const creates = fake.requests.filter((r) => r.method === 'POST' && r.path === '/v1/services');
    expect(creates).toHaveLength(1);
    const body = creates[0]!.body as Json;
    const details = body.serviceDetails as Json;
    expect(body).toMatchObject({ type: 'web_service', name: 't2o-cardano-payer', ownerId: 'own-1', branch: 'main', autoDeployTrigger: 'off' });
    expect(body.repo).toBe('https://github.com/example/token2049-origins');
    expect(details).toMatchObject({ runtime: 'docker', plan: 'free', region: 'singapore', healthCheckPath: '/health' });
    expect(details.envSpecificDetails).toMatchObject({ dockerfilePath: './Dockerfile.payer', dockerContext: '.' });
    expect(JSON.stringify(body)).not.toMatch(/disk/i);
    expect(JSON.stringify(body)).not.toMatch(/private_service/);

    // payer env vars: exactly the listed keys
    const payer = payerOf(fake)!;
    expect([...payer.env.keys()].sort()).toEqual(
      [
        'DATABASE_URL', 'PAYER_BRIDGE_ALLOWED_HOSTS', 'PAYER_BRIDGE_TOKEN_FILE', 'PAYER_GATEWAY_URL', 'PAYER_GATEWAY_TOKEN_FILE',
        'PAYER_CARDANO_NETWORK', 'PAYER_CARDANO_MNEMONIC_FILE', 'PAYER_WALLET_ADDRESS', 'BLOCKFROST_PROJECT_ID', 'BLOCKFROST_BASE_URL',
        'PAYER_ALLOWED_ASSET_UNIT', 'PAYER_EXPECTED_PAY_TO', 'PAYER_MAX_PER_PAYMENT_BASE_UNITS', 'PAYER_MAX_CUMULATIVE_BASE_UNITS',
        'PAYER_MAX_DAILY_BASE_UNITS', 'PAYER_MAX_FEE_LOVELACE', 'PAYER_MAX_ADA_OUTPUT_LOVELACE',
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
      PAYER_WALLET_ADDRESS: WALLET,
      BLOCKFROST_PROJECT_ID: BF_ID,
      BLOCKFROST_BASE_URL: `${fake.origin}/bf`,
      PAYER_ALLOWED_ASSET_UNIT: ASSET,
      PAYER_EXPECTED_PAY_TO: TREASURY,
      PAYER_MAX_PER_PAYMENT_BASE_UNITS: '500000',
      PAYER_MAX_CUMULATIVE_BASE_UNITS: '1500000',
      PAYER_MAX_DAILY_BASE_UNITS: '1000000',
      PAYER_MAX_FEE_LOVELACE: '2000000',
      PAYER_MAX_ADA_OUTPUT_LOVELACE: '3000000',
    });

    // web: exact keys, unrelated vars untouched, hash correct, branch patched
    const web = fake.services.get('srv-web')!;
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
    });
    expect(web.branch).toBe('main');
    expect(web.autoDeployTrigger).toBe('off');

    // per-key PUT only; every env write targets a single key; nothing outside the expected sets
    const envWrites = writes(fake).filter((r) => r.path.includes('/env-vars'));
    expect(envWrites.length).toBeGreaterThan(0);
    for (const w of envWrites) {
      expect(w.method).toBe('PUT');
      expect(w.path).toMatch(/^\/v1\/services\/[^/]+\/env-vars\/[A-Z0-9_]+$/);
      expect(Object.keys(w.body ?? {})).toEqual(['value']);
    }
    const webKeysWritten = envWrites.filter((w) => w.path.startsWith('/v1/services/srv-web/')).map((w) => w.path.split('/').pop());
    expect(webKeysWritten.sort()).toEqual(
      ['MCP_HOSTED_ENABLED', 'MCP_OAUTH_OWNER_PASSCODE_FILE', 'MCP_PAYER_GATEWAY_TOKEN_SHA256', 'MCP_PUBLIC_URL', 'PUBLIC_BASE_URL', 'CARDANO_PAYER_BRIDGE_URL', 'CARDANO_PAYER_BRIDGE_TOKEN_FILE'].sort(),
    );
    expect(writes(fake).every((r) => !(r.method === 'PUT' && /\/env-vars$/.test(r.path)))).toBe(true);

    // secret files, trimmed
    expect(Object.fromEntries(payer.secretFiles)).toEqual({
      'payer-cardano-mnemonic': MNEMONIC,
      'cardano-payer-bridge-token': BRIDGE_TOKEN,
      'payer-gateway-token': GATEWAY_TOKEN,
    });
    expect(Object.fromEntries(web.secretFiles)).toEqual({
      'mcp-owner-passcode': PASSCODE,
      'cardano-payer-bridge-token': BRIDGE_TOKEN,
    });

    // deploys: web then payer
    expect(fake.deploys).toEqual(['srv-web', payer.id]);

    // no secrets in output
    for (const s of SECRET_VALUES) {
      expect(first.out).not.toContain(s);
      expect(first.err).not.toContain(s);
    }

    // idempotent second run
    const before = fake.requests.length;
    const second = await run(fake, secrets, ['--no-deploy']);
    expect(second.code).toBe(0);
    expect(fake.requests.filter((r) => r.method === 'POST' && r.path === '/v1/services')).toHaveLength(1);
    const secondWrites = writes({ ...fake, requests: fake.requests.slice(before) } as Fake);
    expect(secondWrites.filter((r) => r.path.includes('/env-vars'))).toHaveLength(0);
    expect(secondWrites.filter((r) => r.method === 'POST')).toHaveLength(0);
    expect(secondWrites.filter((r) => r.method === 'PATCH')).toHaveLength(0);
    expect(fake.deploys).toHaveLength(2);
  });

  it('patches an existing free payer only where it differs', async () => {
    const fake = await startFake({ existingPayer: true });
    const res = await run(fake, makeSecrets(), ['--no-deploy']);
    expect(res.code).toBe(0);
    expect(fake.requests.some((r) => r.method === 'POST' && r.path === '/v1/services')).toBe(false);
    const patches = fake.requests.filter((r) => r.method === 'PATCH' && r.path === '/v1/services/srv-payer');
    expect(patches).toHaveLength(1);
    expect(patches[0]!.body).toMatchObject({ branch: 'main', autoDeployTrigger: 'off' });
    expect(payerOf(fake)!.branch).toBe('main');
    expect(res.out).toContain('Hosted MCP: PASS');
  });

  it('reports NOT FUNDED (still exit 0) when the wallet is empty, and NOT READY when /status fails', async () => {
    const unfunded = await startFake();
    unfunded.funded = false;
    const a = await run(unfunded, makeSecrets(), ['--no-deploy']);
    expect(a.code).toBe(0);
    expect(lastLines(a.out)).toEqual(['Hosted MCP: PASS', `Payer: NOT FUNDED (send tADA + tUSDM to ${WALLET})`, `MCP URL: ${unfunded.origin}/web/mcp`]);

    const broken = await startFake();
    broken.payerStatusOk = false;
    const b = await run(broken, makeSecrets(), ['--no-deploy']);
    expect(b.code).toBe(0);
    expect(b.out).toContain('Payer: NOT READY');
  });

  it('fails with Hosted MCP: FAIL when the smoke command fails', async () => {
    const fake = await startFake();
    const res = await run(fake, makeSecrets(), ['--no-deploy'], { PROVISION_SMOKE_CMD: JSON.stringify([process.execPath, '-e', 'process.exit(5)']) });
    expect(res.code).toBe(1);
    expect(res.out).toContain('Hosted MCP: FAIL');
    expect(res.out).not.toContain('Hosted MCP: PASS');
  });

  it('fails before any API call when a local secret file is missing', async () => {
    const fake = await startFake();
    const res = await run(fake, makeSecrets('payer-gateway-token'), []);
    expect(res.code).not.toBe(0);
    expect(res.err).toContain('payer-gateway-token');
    expect(fake.requests).toHaveLength(0);
  });

  it('stops and names the missing required env var on the web service', async () => {
    const fake = await startFake();
    fake.setWebEnv('CARDANO_TREASURY_ADDRESS', null);
    const res = await run(fake, makeSecrets(), []);
    expect(res.code).not.toBe(0);
    expect(res.err).toContain('CARDANO_TREASURY_ADDRESS');
    expect(writes(fake)).toHaveLength(0);
  });

  it('aborts when the existing payer is not on the free plan', async () => {
    const fake = await startFake({ payerPlan: 'starter' });
    const res = await run(fake, makeSecrets(), []);
    expect(res.code).not.toBe(0);
    expect(res.err).toMatch(/not free/);
    expect(writes(fake)).toHaveLength(0);
  });

  it('--dry-run performs only GETs and prints the plan without secrets', async () => {
    const fake = await startFake();
    const res = await run(fake, makeSecrets(), ['--dry-run']);
    expect(res.code).toBe(0);
    expect(fake.requests.length).toBeGreaterThan(0);
    expect(fake.requests.every((r) => r.method === 'GET')).toBe(true);
    expect(payerOf(fake)).toBeUndefined();
    expect(res.out).toContain('would create');
    for (const s of SECRET_VALUES) {
      expect(res.out).not.toContain(s);
      expect(res.err).not.toContain(s);
    }
  });

  it('rejects a malformed wallet address and an unknown flag', async () => {
    const fake = await startFake();
    const a = await run(fake, makeSecrets(), ['--wallet-address', 'addr1mainnet']);
    expect(a.code).not.toBe(0);
    const b = await run(fake, makeSecrets(), ['--bogus']);
    expect(b.code).not.toBe(0);
    expect(fake.requests).toHaveLength(0);
  });
});
