#!/usr/bin/env node
/**
 * Idempotent provisioner for the hosted MCP demo on Render. Run it under tsx (it imports the repo's TypeScript):
 *
 *   npm run provision:hosted-mcp -- [--dry-run] [--no-deploy] ...
 *
 * It REUSES the existing canonical Cardano payer wallet (no new wallet, no new Render key):
 *  - Render credential: env RENDER_API_KEY, else the Render CLI's stored credential (~/.render/cli.yaml), refreshed through the CLI;
 *  - finds the protected payer by fingerprint (mnemonic + legacy file ledger), finds its CURRENT policy (caps, asset, payee) in the
 *    operator's env files, proves the mnemonic derives the expected address, and snapshots the legacy ledger;
 *  - retires the legacy file ledger first (so no other process can sign with the old history), then provisions a FREE docker web
 *    service for the payer, sets env vars one key at a time, uploads secret files, deploys, verifies the imported ledger and the
 *    public MCP, checks wallet balances and runs the no-spend smoke.
 *
 * Nothing secret is printed: only names, statuses and numbers. The Render credential is never written anywhere.
 * Test-only seams: RENDER_API_BASE, RENDER_CLI_CONFIG, RENDER_CLI_CMD (JSON array), PROVISION_SMOKE_CMD (JSON array),
 * PROVISION_POLL_MS, PROVISION_VERIFY_TIMEOUT_MS.
 */
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_PAYER_FINGERPRINT = 'a2e66045653afe62';
const DEFAULT_PAYER_SECRETS_ROOT = 'C:/Dev/token2049-setup/secrets';
const DEFAULT_SECRETS_DIR = 'C:/Dev/token2049-setup/secrets/hosted-demo';
const DEFAULT_BLOCKFROST = 'https://cardano-preprod.blockfrost.io/api/v0';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TERMINAL_BAD = new Set(['build_failed', 'update_failed', 'canceled', 'deactivated', 'pre_deploy_failed']);
const MIN_LOVELACE = 3_000_000n;
const POLICY_KEYS = [
  'PAYER_MAX_PER_PAYMENT_BASE_UNITS',
  'PAYER_MAX_CUMULATIVE_BASE_UNITS',
  'PAYER_MAX_DAILY_BASE_UNITS',
  'PAYER_MAX_FEE_LOVELACE',
  'PAYER_MAX_ADA_OUTPUT_LOVELACE',
  'PAYER_ALLOWED_ASSET_UNIT',
  'PAYER_EXPECTED_PAY_TO',
  'PAYER_CARDANO_NETWORK',
];

/** Strings that must never appear in output. Filled as secrets are loaded. */
const secrets = new Set();
const track = (value) => {
  if (typeof value === 'string' && value.length >= 4) secrets.add(value);
  return value;
};
const safe = (text) => {
  let out = String(text);
  for (const s of secrets) out = out.split(s).join('[redacted]');
  return out;
};
const log = (message) => console.log(safe(message));
const fail = (message) => {
  throw new Error(message);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

// ---------------------------------------------------------------------------------------------------------------------
// arguments

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    deploy: true,
    secretsDir: process.env.HOSTED_SECRETS_DIR || DEFAULT_SECRETS_DIR,
    webName: 'token2049-origins',
    payerName: 't2o-cardano-payer',
    ownerId: process.env.RENDER_OWNER_ID || '',
    fingerprint: DEFAULT_PAYER_FINGERPRINT,
    payerSecretsRoot: DEFAULT_PAYER_SECRETS_ROOT,
    envRoots: '',
    policyFile: '',
  };
  const takesValue = {
    '--secrets-dir': 'secretsDir',
    '--web-name': 'webName',
    '--payer-name': 'payerName',
    '--owner-id': 'ownerId',
    '--payer-fingerprint': 'fingerprint',
    '--payer-secrets-root': 'payerSecretsRoot',
    '--payer-env-roots': 'envRoots',
    '--policy-file': 'policyFile',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--no-deploy') opts.deploy = false;
    else if (arg in takesValue) {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) fail(`${arg} needs a value`);
      opts[takesValue[arg]] = value;
      i += 1;
    } else fail(`Unknown argument: ${arg}`);
  }
  if (!/^[0-9a-f]{16}$/.test(opts.fingerprint)) fail('--payer-fingerprint must be 16 lowercase hex characters');
  return opts;
}

// ---------------------------------------------------------------------------------------------------------------------
// Render credential

const unquote = (v) => v.replace(/^(['"])(.*)\1$/, '$2');

/** Minimal reader for the `api:` block of the Render CLI config (fields `key` and `expires_at`). */
function readCliCredential(configPath) {
  let text;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch {
    fail(`Cannot read the Render CLI config at ${configPath}`);
  }
  let inApi = false;
  let key = '';
  let expiresAt = NaN;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inApi = /^api:\s*(#.*)?$/.test(line);
      continue;
    }
    if (!inApi) continue;
    const m = /^\s+(key|expires_at):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    if (m[1] === 'key') key = unquote(m[2]);
    else expiresAt = Number(unquote(m[2]));
  }
  return { key: track(key), expiresAt };
}

const stale = (cred) => Number.isFinite(cred.expiresAt) && cred.expiresAt - Date.now() / 1000 < 120;

function resolveRenderKey() {
  if (process.env.RENDER_API_KEY) return track(process.env.RENDER_API_KEY);
  const configPath = process.env.RENDER_CLI_CONFIG || path.join(os.homedir(), '.render', 'cli.yaml');
  if (!existsSync(configPath)) fail('No Render credential: set RENDER_API_KEY or log in with the Render CLI (render login)');
  let cred = readCliCredential(configPath);
  if (!cred.key) fail('The Render CLI config has no api key; run render login');
  if (stale(cred)) {
    log('Render CLI credential is expired or about to expire; asking the Render CLI to refresh it');
    let cmd = ['render'];
    if (process.env.RENDER_CLI_CMD) {
      try {
        cmd = JSON.parse(process.env.RENDER_CLI_CMD);
      } catch {
        fail('RENDER_CLI_CMD must be a JSON array');
      }
    }
    const [bin, ...pre] = cmd.map(String);
    const r = spawnSync(bin, [...pre, 'whoami', '--output', 'json', '--confirm'], {
      stdio: 'ignore',
      timeout: 90_000,
      env: { ...process.env, ...(process.env.RENDER_CLI_CONFIG ? { RENDER_CLI_CONFIG_PATH: configPath } : {}) },
    });
    if (r.error) fail('Could not run the Render CLI to refresh the credential; run render login');
    cred = readCliCredential(configPath);
    if (!cred.key || stale(cred)) fail('The Render CLI credential is still expired after a refresh; run render login');
  }
  return cred.key;
}

// ---------------------------------------------------------------------------------------------------------------------
// Render API

let apiBase = 'https://api.render.com/v1';
let apiKey = '';
let readOnly = false;

/** Tiny Render API wrapper. Errors carry method, path, status and Render's message only - never headers or bodies. */
async function api(method, apiPath, body) {
  if (readOnly && method !== 'GET') fail(`Refusing ${method} ${apiPath} in --dry-run`);
  let res;
  try {
    res = await fetch(`${apiBase}${apiPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    fail(`${method} ${apiPath} failed to connect: ${err instanceof Error ? err.message : 'network error'}`);
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!res.ok) {
    const detail = (data && typeof data.message === 'string' ? data.message : text).replace(/\s+/g, ' ').slice(0, 200);
    fail(`${method} ${apiPath} -> HTTP ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return { status: res.status, data };
}

/** Follows Render's cursor pagination (each row carries its own cursor). */
async function listAll(apiPath, params, unwrapKey) {
  const out = [];
  let cursor;
  for (let page = 0; page < 100; page += 1) {
    const q = new URLSearchParams(params);
    q.set('limit', '100');
    if (cursor) q.set('cursor', cursor);
    const { data } = await api('GET', `${apiPath}?${q}`);
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) out.push(unwrapKey ? row[unwrapKey] : row);
    cursor = rows.length ? rows[rows.length - 1].cursor : undefined;
    if (rows.length < 100 || !cursor) break;
  }
  return out;
}

async function findServices(name, ownerId) {
  const params = { name };
  if (ownerId) params.ownerId = ownerId;
  const services = await listAll('/services', params, 'service');
  return services.filter((s) => s && s.name === name);
}

async function getEnvVars(serviceId) {
  const rows = await listAll(`/services/${serviceId}/env-vars`, {}, 'envVar');
  return new Map(rows.filter((r) => r && typeof r.key === 'string').map((r) => [r.key, r.value ?? '']));
}

async function putEnvVars(label, serviceId, existing, desired, dryRun) {
  for (const [key, value] of desired) {
    if (existing.get(key) === value) {
      log(`  ${label} env ${key}: unchanged`);
      continue;
    }
    if (dryRun) {
      log(`  ${label} env ${key}: would ${existing.has(key) ? 'update' : 'set'}`);
      continue;
    }
    await api('PUT', `/services/${serviceId}/env-vars/${encodeURIComponent(key)}`, { value });
    log(`  ${label} env ${key}: ${existing.has(key) ? 'updated' : 'set'}`);
  }
}

async function putSecretFiles(label, serviceId, files, dryRun) {
  for (const [name, content] of files) {
    if (dryRun) {
      log(`  ${label} secret file ${name}: would upload`);
      continue;
    }
    await api('PUT', `/services/${serviceId}/secret-files/${encodeURIComponent(name)}`, { content });
    log(`  ${label} secret file ${name}: uploaded`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// protected payer, policy, ledger

function locateProtectedPayer(opts) {
  const dir = path.resolve(opts.payerSecretsRoot, `cardano-payer-${opts.fingerprint}`);
  const mnemonicPath = path.join(dir, 'payer.mnemonic');
  const ledgerPath = path.join(dir, 'ledger.json');
  if (!existsSync(mnemonicPath)) fail(`Protected payer ${opts.fingerprint}: payer.mnemonic not found; refusing to continue`);
  if (!existsSync(ledgerPath)) fail(`Protected payer ${opts.fingerprint}: ledger.json not found; refusing to continue`);
  return { dir, mnemonicPath, ledgerPath };
}

/** Comparable form of a path as written in an env file (quotes, slash style and Windows case do not matter). */
function normPath(value) {
  let p = unquote(String(value).trim()).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
  if (/^[a-z]:\//i.test(p)) p = p.toLowerCase();
  return p;
}

function parseEnvFile(file) {
  const out = {};
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m || m[1] === undefined) continue;
    let v = m[2] ?? '';
    if (!/^['"]/.test(v)) v = v.replace(/\s+#.*$/, '');
    out[m[1]] = unquote(v.trim());
  }
  return out;
}

function defaultEnvRoots() {
  const bases = new Set([REPO_ROOT]);
  const r = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) bases.add(path.dirname(path.resolve(REPO_ROOT, r.stdout.trim())));
  const roots = [];
  for (const base of bases) {
    roots.push(base);
    const runtime = path.join(base, '.runtime');
    if (existsSync(runtime)) {
      for (const name of readdirSync(runtime)) {
        const sub = path.join(runtime, name);
        if (statSync(sub).isDirectory()) roots.push(sub);
      }
    }
  }
  return roots;
}

function policyFrom(file, env) {
  const missing = POLICY_KEYS.filter((k) => !env[k]);
  if (missing.length) fail(`Policy file ${file} is missing: ${missing.join(', ')}`);
  return Object.fromEntries([...POLICY_KEYS, 'BLOCKFROST_BASE_URL'].map((k) => [k, env[k] ?? '']));
}

/** The CURRENT policy of the protected payer: the newest env file that points at exactly this ledger and mnemonic. */
function discoverPolicy(opts, payer) {
  if (opts.policyFile) {
    const file = path.resolve(opts.policyFile);
    if (!existsSync(file)) fail(`--policy-file not found: ${file}`);
    log('Policy file pinned with --policy-file (ledger/mnemonic paths in it are not cross-checked)');
    return { file, values: policyFrom(file, parseEnvFile(file)) };
  }
  const roots = opts.envRoots ? opts.envRoots.split(',').map((r) => r.trim()).filter(Boolean) : defaultEnvRoots();
  const wantLedger = normPath(payer.ledgerPath);
  const wantMnemonic = normPath(payer.mnemonicPath);
  const candidates = [];
  for (const root of roots) {
    if (!existsSync(root) || !statSync(root).isDirectory()) continue;
    for (const name of readdirSync(root)) {
      if (!name.toLowerCase().startsWith('.env')) continue;
      const file = path.join(root, name);
      if (!statSync(file).isFile()) continue;
      let env;
      try {
        env = parseEnvFile(file);
      } catch {
        continue;
      }
      if (env.PAYER_LEDGER_FILE && env.PAYER_CARDANO_MNEMONIC_FILE && normPath(env.PAYER_LEDGER_FILE) === wantLedger && normPath(env.PAYER_CARDANO_MNEMONIC_FILE) === wantMnemonic) {
        candidates.push({ file, env, mtime: statSync(file).mtimeMs });
      }
    }
  }
  if (!candidates.length) fail('No current payer policy found: no env file references this payer ledger and mnemonic (use --policy-file or --payer-env-roots)');
  candidates.sort((a, b) => b.mtime - a.mtime);
  const [best, ...others] = candidates;
  const values = policyFrom(best.file, best.env);
  for (const o of others) {
    const differs = POLICY_KEYS.filter((k) => (o.env[k] ?? '') !== values[k]);
    log(`Note: other policy candidate ${o.file} (older) ${differs.length ? `differs on ${differs.join(', ')}` : 'agrees'}`);
  }
  return { file: best.file, values };
}

/** `policyId` + `.` + assetNameHex. Accepts the concatenated form too. */
function canonicalAsset(unit) {
  const u = String(unit).trim().toLowerCase();
  if (u === 'lovelace' || u.includes('.')) return u;
  return /^[0-9a-f]{56}/.test(u) ? `${u.slice(0, 56)}.${u.slice(56)}` : u;
}

async function loadPayerModules() {
  const [config, hosted, ledger, imp] = await Promise.all([
    import('../clients/payer/config.js'),
    import('../clients/payer/hosted.js'),
    import('../clients/payer/ledger.js'),
    import('../clients/payer/ledger-import.js'),
  ]);
  return { ...config, ...hosted, ...ledger, ...imp };
}

function deriveAddress(mods, payer, policy) {
  try {
    const config = mods.loadPayerConfig(
      {
        PAYER_GATEWAY_URL: 'https://gateway.invalid',
        PAYER_GATEWAY_TOKEN_FILE: 'unused',
        PAYER_CARDANO_NETWORK: policy.PAYER_CARDANO_NETWORK,
        PAYER_CARDANO_MNEMONIC_FILE: payer.mnemonicPath,
        BLOCKFROST_PROJECT_ID: 'unused',
        BLOCKFROST_BASE_URL: DEFAULT_BLOCKFROST,
        PAYER_MAX_PER_PAYMENT_BASE_UNITS: policy.PAYER_MAX_PER_PAYMENT_BASE_UNITS,
        PAYER_MAX_CUMULATIVE_BASE_UNITS: policy.PAYER_MAX_CUMULATIVE_BASE_UNITS,
        PAYER_MAX_DAILY_BASE_UNITS: policy.PAYER_MAX_DAILY_BASE_UNITS,
        PAYER_MAX_FEE_LOVELACE: policy.PAYER_MAX_FEE_LOVELACE,
        PAYER_MAX_ADA_OUTPUT_LOVELACE: policy.PAYER_MAX_ADA_OUTPUT_LOVELACE,
        PAYER_ALLOWED_ASSET_UNIT: policy.PAYER_ALLOWED_ASSET_UNIT,
        PAYER_EXPECTED_PAY_TO: policy.PAYER_EXPECTED_PAY_TO,
      },
      { ledger: 'external' },
    );
    return { config, address: mods.deriveWalletAddress(config) };
  } catch (err) {
    // loadPayerConfig names variables only; anything else is replaced by a fixed message so no key material can leak.
    const msg = err instanceof Error && /^invalid payer configuration/.test(err.message) ? err.message : 'could not derive the wallet address from the protected mnemonic';
    fail(msg);
  }
}

function analyseLedger(mods, payer, config, address) {
  const lockPath = `${payer.ledgerPath}.lock`;
  if (existsSync(lockPath)) fail('The legacy payer ledger is locked (a payment may be in flight); resolve it first, then retry');
  const entries = mods.readLedgerSnapshot(payer.ledgerPath);
  for (const e of entries) if (e.header) track(e.header);
  const sourceSha256 = mods.ledgerSourceSha256(entries);
  const retiredPath = mods.retiredMarkerPath(payer.ledgerPath);
  let alreadyRetired = false;
  if (existsSync(retiredPath)) {
    let marker;
    try {
      marker = JSON.parse(readFileSync(retiredPath, 'utf8'));
    } catch {
      fail('The legacy payer ledger has an unreadable retired marker; refusing to continue');
    }
    if (marker?.sourceSha256 !== sourceSha256) fail('The legacy payer ledger is already retired for a different history; refusing to continue');
    alreadyRetired = true;
  }
  const matching = entries.filter((e) => e.network === config.network && e.asset === config.allowedAsset);
  const committed = mods.committedBaseUnits(matching);
  const today = new Date().toISOString().slice(0, 10);
  const dailyToday = matching
    .filter((e) => e.status !== 'accepted' || e.updatedAt.slice(0, 10) === today)
    .reduce((sum, e) => sum + BigInt(e.amountBaseUnits), 0n);
  const count = (s) => entries.filter((e) => e.status === s).length;
  const clamp = (v) => (v < 0n ? 0n : v);
  const min = (a, b) => (a < b ? a : b);
  const headroom = min(config.maxPerPayment, min(clamp(config.maxCumulative - committed), clamp(config.maxDaily - dailyToday)));
  return {
    text: readFileSync(payer.ledgerPath, 'utf8'),
    entryCount: entries.length,
    sourceSha256,
    alreadyRetired,
    committed,
    dailyToday,
    headroom,
    accepted: count('accepted'),
    signed: count('signed'),
    signing: count('signing'),
    address,
  };
}

function legacySignerState(mods, ledgerPath) {
  try {
    new mods.PayerLedger(ledgerPath).assertReady();
    return 'STILL ACTIVE';
  } catch (err) {
    return err instanceof Error && /retired/.test(err.message) ? 'DISABLED' : 'STILL ACTIVE';
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// hosted-demo secrets (not wallet keys)

function hostedSecret(dir, name, dryRun) {
  const full = path.join(dir, name);
  if (existsSync(full)) {
    const value = readFileSync(full, 'utf8').trim();
    if (!value) fail(`Local secret file is empty: ${name} (in ${dir})`);
    return track(value);
  }
  const value = track(randomBytes(32).toString('base64url'));
  if (dryRun) log(`  ${name}: missing, would generate`);
  else {
    mkdirSync(dir, { recursive: true });
    writeFileSync(full, `${value}\n`, { mode: 0o600, flag: 'wx' });
    log(`  ${name}: generated (mode 0600)`);
  }
  return value;
}

// ---------------------------------------------------------------------------------------------------------------------
// Render services

function serviceUrl(service) {
  const url = service?.serviceDetails?.url;
  return typeof url === 'string' && url ? url.replace(/\/+$/, '') : '';
}

async function discoverWeb(opts) {
  let ownerIds;
  if (opts.ownerId) ownerIds = [opts.ownerId];
  else ownerIds = (await listAll('/owners', {}, 'owner')).map((o) => o.id);
  if (!ownerIds.length) fail('No Render workspace is visible to this credential');
  const found = [];
  for (const ownerId of ownerIds) {
    for (const s of await findServices(opts.webName, ownerId)) found.push(s);
  }
  if (found.length === 0) fail(`Web service "${opts.webName}" not found (workspaces checked: ${ownerIds.length})`);
  if (found.length > 1) fail(`Several workspaces own "${opts.webName}"; pass --owner-id`);
  const web = found[0];
  if (web.type !== 'web_service') fail(`"${opts.webName}" is a ${web.type}, expected web_service`);
  if (!web.repo) fail(`Web service "${opts.webName}" has no repo URL`);
  const url = serviceUrl(web);
  if (!url) fail(`Web service "${opts.webName}" has no public URL`);
  return {
    id: web.id,
    ownerId: web.ownerId,
    repo: web.repo,
    branch: web.branch,
    region: web.serviceDetails?.region,
    autoDeployTrigger: web.autoDeployTrigger,
    url,
  };
}

const normalizeDockerfile = (p) => String(p ?? '').replace(/^\.\//, '');

/** Read-only: finds the payer service and validates it (public web service, free plan). */
async function lookupPayer(opts, web) {
  const existing = await findServices(opts.payerName, web.ownerId);
  if (existing.length > 1) fail(`Several services named "${opts.payerName}" in the workspace`);
  const found = existing[0];
  if (!found) return null;
  if (found.type !== 'web_service') fail(`"${opts.payerName}" exists but is a ${found.type}; refusing (must be a public web_service)`);
  const plan = found.serviceDetails?.plan;
  if (plan !== 'free') fail(`Payer service "${opts.payerName}" is on plan "${plan}", not free; refusing to continue`);
  if (!serviceUrl(found)) fail(`Payer service "${opts.payerName}" has no public URL`);
  return found;
}

async function applyPayer(opts, web, found, dryRun) {
  if (!found) {
    if (dryRun) {
      log(`Payer service "${opts.payerName}": would create (free docker web service, region ${web.region}, branch main)`);
      return null;
    }
    const body = {
      type: 'web_service',
      name: opts.payerName,
      ownerId: web.ownerId,
      repo: web.repo,
      branch: 'main',
      autoDeployTrigger: 'off',
      serviceDetails: {
        runtime: 'docker',
        plan: 'free',
        region: web.region,
        healthCheckPath: '/health',
        envSpecificDetails: { dockerfilePath: './Dockerfile.payer', dockerContext: '.' },
      },
    };
    const { data } = await api('POST', '/services', body);
    const service = data?.service ?? data;
    if (!service?.id) fail('Render did not return the created payer service');
    let url = serviceUrl(service);
    if (!url) url = serviceUrl((await api('GET', `/services/${service.id}`)).data);
    if (!url) fail('Created payer service has no public URL yet');
    log(`Payer service "${opts.payerName}": created (${service.id})`);
    return { id: service.id, url };
  }
  const patch = {};
  if (found.branch !== 'main') patch.branch = 'main';
  if (found.autoDeployTrigger !== 'off') patch.autoDeployTrigger = 'off';
  if (normalizeDockerfile(found.serviceDetails?.envSpecificDetails?.dockerfilePath) !== 'Dockerfile.payer') {
    patch.serviceDetails = { envSpecificDetails: { dockerfilePath: './Dockerfile.payer' } };
  }
  if (Object.keys(patch).length) {
    if (dryRun) log(`Payer service "${opts.payerName}": would patch ${Object.keys(patch).join(', ')}`);
    else {
      await api('PATCH', `/services/${found.id}`, patch);
      log(`Payer service "${opts.payerName}": patched ${Object.keys(patch).join(', ')}`);
    }
  } else log(`Payer service "${opts.payerName}": exists, settings already correct`);
  return { id: found.id, url: serviceUrl(found) };
}

async function triggerDeploy(label, serviceId) {
  const { data } = await api('POST', `/services/${serviceId}/deploys`, { clearCache: 'do_not_clear' });
  let id = data?.id;
  if (!id) {
    // 202 "queued" responses carry no body; fall back to the newest deploy.
    const rows = (await api('GET', `/services/${serviceId}/deploys?limit=1`)).data;
    id = Array.isArray(rows) ? rows[0]?.deploy?.id : undefined;
  }
  if (!id) fail(`${label}: could not determine the triggered deploy`);
  log(`${label}: deploy ${id} triggered`);
  return id;
}

async function waitForDeploy(label, serviceId, deployId) {
  const pollMs = Number(process.env.PROVISION_POLL_MS) || 10_000;
  const deadline = Date.now() + 25 * 60_000;
  let last = '';
  while (Date.now() < deadline) {
    const { data } = await api('GET', `/services/${serviceId}/deploys/${deployId}`);
    const status = data?.status ?? 'unknown';
    if (status !== last) {
      log(`${label}: deploy status ${status}`);
      last = status;
    }
    if (status === 'live') return;
    if (TERMINAL_BAD.has(status)) fail(`${label}: deploy ended with status ${status}`);
    await sleep(pollMs);
  }
  fail(`${label}: deploy did not go live within 25 minutes`);
}

// ---------------------------------------------------------------------------------------------------------------------
// verification

async function retry(label, fn) {
  const timeoutMs = Number(process.env.PROVISION_VERIFY_TIMEOUT_MS) || 180_000;
  const intervalMs = Math.min(5000, Math.max(50, Math.floor(timeoutMs / 6)));
  const deadline = Date.now() + timeoutMs;
  let reason = '';
  for (;;) {
    try {
      const problem = await fn();
      if (!problem) return;
      reason = problem;
    } catch (err) {
      reason = err instanceof Error ? err.message : 'request failed';
    }
    if (Date.now() >= deadline) fail(`${label}: ${reason}`);
    await sleep(intervalMs);
  }
}

const timed = (ms = 30_000) => AbortSignal.timeout(ms);

async function verifyWeb(web) {
  await retry('web /health', async () => {
    const res = await fetch(`${web}/health`, { signal: timed() });
    return res.status === 200 ? '' : `HTTP ${res.status}`;
  });
  log('web /health: 200');
  await retry('web /console/', async () => {
    const res = await fetch(`${web}/console/`, { redirect: 'follow', signal: timed() });
    return res.status === 200 ? '' : `HTTP ${res.status}`;
  });
  log('web /console/: 200');
  await retry('web POST /mcp (unauthenticated)', async () => {
    const res = await fetch(`${web}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      signal: timed(),
    });
    if (res.status !== 401) return `expected 401, got HTTP ${res.status}`;
    const challenge = res.headers.get('www-authenticate') ?? '';
    return challenge.includes('resource_metadata') ? '' : '401 without resource_metadata in WWW-Authenticate';
  });
  log('web POST /mcp: 401 with resource_metadata');
}

/** Returns '' when /status proves the imported ledger and caps, else a short reason. */
function statusProblem(json, expect) {
  const src = json?.source;
  const led = json?.ledger;
  if (json?.ok !== true) return 'status ok is not true';
  if (src?.rail !== 'cardano' || src?.network !== expect.network) return 'unexpected rail/network';
  if (src?.publicAddress !== expect.address) return 'payer address does not match the protected wallet';
  if (src?.readiness !== 'configured') return `readiness is ${String(src?.readiness)}`;
  if (!led) return 'status has no ledger summary';
  if (led.imported?.sourceSha256 !== expect.sourceSha256) return 'imported ledger hash does not match the legacy ledger';
  if (led.imported?.entries !== expect.entryCount) return 'imported entry count does not match the legacy ledger';
  let committed;
  try {
    committed = BigInt(led.committedBaseUnits);
  } catch {
    return 'ledger committedBaseUnits is not a number';
  }
  // Later hosted spend only adds to the history, so the hosted total may exceed the frozen legacy total, never fall below it.
  if (committed < expect.committed) return 'hosted committed spend is below the legacy ledger total';
  const caps = led.caps ?? {};
  if (caps.perPayment !== expect.caps.perPayment || caps.cumulative !== expect.caps.cumulative || caps.daily !== expect.caps.daily) return 'payer caps differ from the policy';
  return '';
}

async function verifyPayer(payer, bridgeToken, expect) {
  try {
    await retry('payer /health', async () => {
      const res = await fetch(`${payer}/health`, { signal: timed() });
      return res.status === 200 ? '' : `HTTP ${res.status}`;
    });
    log('payer /health: 200');
    await retry('payer /status', async () => {
      const res = await fetch(`${payer}/status`, { headers: { Authorization: `Bearer ${bridgeToken}` }, signal: timed() });
      if (res.status !== 200) return `HTTP ${res.status}`;
      const json = await res.json().catch(() => null);
      return statusProblem(json, expect);
    });
    log('payer /status: ok (wallet, imported ledger and caps verified)');
    return '';
  } catch (err) {
    const reason = err instanceof Error ? err.message.replace(/^payer \/(status|health): /, '') : 'failed';
    log(`payer verification: NOT OK (${reason})`);
    return reason;
  }
}

async function fetchBalances(base, projectId, address, asset) {
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/addresses/${address}`, { headers: { project_id: projectId }, signal: timed() });
    if (res.status === 404) return { lovelace: 0n, asset: 0n };
    if (res.status !== 200) return null;
    const json = await res.json();
    const amounts = Array.isArray(json?.amount) ? json.amount : [];
    const unit = asset.replace('.', '');
    const qty = (u) => {
      const row = amounts.find((a) => a?.unit === u);
      try {
        return BigInt(row?.quantity ?? '0');
      } catch {
        return 0n;
      }
    };
    return { lovelace: qty('lovelace'), asset: qty(unit) };
  } catch {
    return null;
  }
}

function runSmoke(args, passcode) {
  let command;
  let cmdArgs;
  if (process.env.PROVISION_SMOKE_CMD) {
    let parsed;
    try {
      parsed = JSON.parse(process.env.PROVISION_SMOKE_CMD);
    } catch {
      fail('PROVISION_SMOKE_CMD must be a JSON array');
    }
    if (!Array.isArray(parsed) || !parsed.length) fail('PROVISION_SMOKE_CMD must be a non-empty JSON array');
    [command, ...cmdArgs] = parsed.map(String);
  } else {
    command = process.execPath;
    cmdArgs = [path.join(REPO_ROOT, 'scripts', 'hosted-mcp-smoke.mjs'), ...args];
  }
  return new Promise((resolve) => {
    const child = spawn(command, cmdArgs, {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, HOSTED_MCP_PASSCODE: passcode },
    });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// main

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  readOnly = opts.dryRun;
  apiKey = resolveRenderKey();
  if (process.env.RENDER_API_BASE) apiBase = process.env.RENDER_API_BASE.replace(/\/+$/, '');

  // 1. protected payer, policy, address, ledger: every check that can refuse runs before anything is written.
  const mods = await loadPayerModules();
  const payer = locateProtectedPayer(opts);
  const mnemonic = readFileSync(payer.mnemonicPath, 'utf8');
  track(mnemonic.trim());
  const policyInfo = discoverPolicy(opts, payer);
  const policy = policyInfo.values;
  log(`Policy file: ${policyInfo.file}`);
  log(
    `Policy: per payment ${policy.PAYER_MAX_PER_PAYMENT_BASE_UNITS}, cumulative ${policy.PAYER_MAX_CUMULATIVE_BASE_UNITS}, daily ${policy.PAYER_MAX_DAILY_BASE_UNITS}, ` +
      `max fee ${policy.PAYER_MAX_FEE_LOVELACE} lovelace, max ADA output ${policy.PAYER_MAX_ADA_OUTPUT_LOVELACE} lovelace`,
  );
  log(`Policy asset: ${policy.PAYER_ALLOWED_ASSET_UNIT}; payee: ${policy.PAYER_EXPECTED_PAY_TO}; network: ${policy.PAYER_CARDANO_NETWORK}`);
  const { config, address } = deriveAddress(mods, payer, policy);
  const fingerprint = sha256(address).slice(0, 16);
  if (fingerprint !== opts.fingerprint) fail(`The protected mnemonic derives wallet fingerprint ${fingerprint}, not ${opts.fingerprint}; refusing to continue`);
  log(`Existing wallet verified: ${address} (fingerprint ${fingerprint})`);
  const ledger = analyseLedger(mods, payer, config, address);
  track(ledger.text);
  log(`Legacy ledger: ${ledger.entryCount} entries (accepted ${ledger.accepted}, signed ${ledger.signed}, signing ${ledger.signing}), committed ${ledger.committed}, spent today ${ledger.dailyToday}, headroom ${ledger.headroom}`);

  // 2. Render: web service and its env vars.
  log(opts.dryRun ? 'Mode: dry run (reads only)' : 'Mode: apply');
  const web = await discoverWeb(opts);
  log(`Web service "${opts.webName}": ${web.id} (region ${web.region}, branch ${web.branch})`);
  const webEnv = await getEnvVars(web.id);
  const required = ['DATABASE_URL', 'BLOCKFROST_PROJECT_ID', 'CARDANO_ASSET_UNIT', 'CARDANO_TREASURY_ADDRESS'];
  const missing = required.filter((k) => !webEnv.get(k));
  if (missing.length) fail(`Web service is missing required env var(s): ${missing.join(', ')}`);
  track(webEnv.get('DATABASE_URL'));
  track(webEnv.get('BLOCKFROST_PROJECT_ID'));
  if (webEnv.get('CARDANO_TREASURY_ADDRESS') !== policy.PAYER_EXPECTED_PAY_TO) {
    fail('The web service CARDANO_TREASURY_ADDRESS differs from the payer policy PAYER_EXPECTED_PAY_TO; the payee is not changed silently. Fix one of them and retry');
  }
  if (canonicalAsset(webEnv.get('CARDANO_ASSET_UNIT')) !== canonicalAsset(policy.PAYER_ALLOWED_ASSET_UNIT)) {
    fail('The web service CARDANO_ASSET_UNIT differs from the payer policy PAYER_ALLOWED_ASSET_UNIT; the asset is not changed silently. Fix one of them and retry');
  }
  const blockfrostBase = webEnv.get('BLOCKFROST_BASE_URL') || policy.BLOCKFROST_BASE_URL || DEFAULT_BLOCKFROST;
  const payerFound = await lookupPayer(opts, web);

  // 3. local hosted-demo secrets (random service tokens, never wallet keys). The decoy/old payer.mnemonic there is never read.
  log('Hosted-demo secrets:');
  const bridgeToken = hostedSecret(opts.secretsDir, 'cardano-payer-bridge-token', opts.dryRun);
  const gatewayToken = hostedSecret(opts.secretsDir, 'payer-gateway-token', opts.dryRun);
  const passcode = hostedSecret(opts.secretsDir, 'mcp-owner-passcode', opts.dryRun);
  const gatewayTokenSha = sha256(gatewayToken);

  const asset = config.allowedAsset;
  const balances = await fetchBalances(blockfrostBase, webEnv.get('BLOCKFROST_PROJECT_ID'), address, asset);
  const caps = {
    perPayment: policy.PAYER_MAX_PER_PAYMENT_BASE_UNITS,
    cumulative: policy.PAYER_MAX_CUMULATIVE_BASE_UNITS,
    daily: policy.PAYER_MAX_DAILY_BASE_UNITS,
  };
  const printReport = (legacy, smoke) => {
    log(`Existing wallet address: ${address}   (fingerprint ${fingerprint})`);
    log(`On-chain balance: ${balances ? `${balances.lovelace} lovelace, ${balances.asset} tUSDM base units` : 'unavailable (Blockfrost could not be read)'}`);
    log(`Imported historical entries: ${ledger.entryCount}   (accepted ${ledger.accepted}, signed ${ledger.signed}, signing ${ledger.signing})`);
    log(`Committed tUSDM base units (history): ${ledger.committed}`);
    log(`Policy caps (per payment / daily / cumulative): ${caps.perPayment} / ${caps.daily} / ${caps.cumulative}   [from ${policyInfo.file}]`);
    log(`Safe remaining headroom: ${ledger.headroom} base units`);
    log(`Legacy file signer: ${legacy}`);
    log(`Public MCP smoke: ${smoke}`);
  };

  const payerUrlPlanned = payerFound ? serviceUrl(payerFound) : `https://${opts.payerName}.onrender.com`;
  const desiredPayerEnv = (payerUrl) =>
    new Map([
      ['DATABASE_URL', webEnv.get('DATABASE_URL')],
      ['PAYER_BRIDGE_ALLOWED_HOSTS', new URL(payerUrl).host],
      ['PAYER_BRIDGE_TOKEN_FILE', '/etc/secrets/cardano-payer-bridge-token'],
      ['PAYER_GATEWAY_URL', web.url],
      ['PAYER_GATEWAY_TOKEN_FILE', '/etc/secrets/payer-gateway-token'],
      ['PAYER_CARDANO_NETWORK', policy.PAYER_CARDANO_NETWORK],
      ['PAYER_CARDANO_MNEMONIC_FILE', '/etc/secrets/payer-cardano-mnemonic'],
      ['PAYER_WALLET_ADDRESS', address],
      ['BLOCKFROST_PROJECT_ID', webEnv.get('BLOCKFROST_PROJECT_ID')],
      ['BLOCKFROST_BASE_URL', blockfrostBase],
      ['PAYER_ALLOWED_ASSET_UNIT', policy.PAYER_ALLOWED_ASSET_UNIT],
      ['PAYER_EXPECTED_PAY_TO', policy.PAYER_EXPECTED_PAY_TO],
      ['PAYER_MAX_PER_PAYMENT_BASE_UNITS', policy.PAYER_MAX_PER_PAYMENT_BASE_UNITS],
      ['PAYER_MAX_CUMULATIVE_BASE_UNITS', policy.PAYER_MAX_CUMULATIVE_BASE_UNITS],
      ['PAYER_MAX_DAILY_BASE_UNITS', policy.PAYER_MAX_DAILY_BASE_UNITS],
      ['PAYER_MAX_FEE_LOVELACE', policy.PAYER_MAX_FEE_LOVELACE],
      ['PAYER_MAX_ADA_OUTPUT_LOVELACE', policy.PAYER_MAX_ADA_OUTPUT_LOVELACE],
      ['PAYER_LEGACY_LEDGER_FILE', '/etc/secrets/legacy-ledger'],
      ['PAYER_LEGACY_LEDGER_SHA256', ledger.sourceSha256],
    ]);
  const payerFiles = new Map([
    ['payer-cardano-mnemonic', mnemonic],
    ['legacy-ledger', ledger.text],
    ['cardano-payer-bridge-token', bridgeToken],
    ['payer-gateway-token', gatewayToken],
  ]);
  const webDesired = (payerUrl) =>
    new Map([
      ['PUBLIC_BASE_URL', web.url],
      ['MCP_PUBLIC_URL', web.url],
      ['MCP_HOSTED_ENABLED', 'true'],
      ['MCP_OAUTH_OWNER_PASSCODE_FILE', '/etc/secrets/mcp-owner-passcode'],
      ['CARDANO_PAYER_BRIDGE_URL', payerUrl],
      ['CARDANO_PAYER_BRIDGE_TOKEN_FILE', '/etc/secrets/cardano-payer-bridge-token'],
      ['MCP_PAYER_GATEWAY_TOKEN_SHA256', gatewayTokenSha],
    ]);
  const webFiles = new Map([
    ['mcp-owner-passcode', passcode],
    ['cardano-payer-bridge-token', bridgeToken],
  ]);

  if (opts.dryRun) {
    log(`Plan: ${ledger.alreadyRetired ? 'legacy file ledger already retired for this history' : 'retire the legacy file ledger (marker next to ledger.json)'}`);
    await applyPayer(opts, web, payerFound, true);
    const payerEnvExisting = payerFound ? await getEnvVars(payerFound.id) : new Map();
    log('Payer configuration:');
    await putEnvVars('payer', payerFound?.id ?? '(new)', payerEnvExisting, desiredPayerEnv(payerUrlPlanned), true);
    await putSecretFiles('payer', payerFound?.id ?? '(new)', payerFiles, true);
    log('Web configuration:');
    if (web.branch !== 'main') log('  web branch: would patch to main');
    await putEnvVars('web', web.id, webEnv, webDesired(payerUrlPlanned), true);
    await putSecretFiles('web', web.id, webFiles, true);
    log(`Plan: ${opts.deploy ? 'deploy web then payer, ' : ''}verify, check balances, run smoke.`);
    printReport(ledger.alreadyRetired ? legacySignerState(mods, payer.ledgerPath) : 'pending retirement (dry run)', 'not run (dry run)');
    log('Dry run complete; nothing was changed.');
    return 0;
  }

  // 4. retire first: no other process may sign with the old history from here on. Idempotent for the same history.
  mods.retireFileLedger(payer.ledgerPath, {
    reason: 'migrated to the hosted PostgreSQL payer ledger',
    sourceSha256: ledger.sourceSha256,
    entryCount: ledger.entryCount,
    payerAddress: address,
  });
  log(ledger.alreadyRetired ? 'Legacy file ledger: already retired for this history' : 'Legacy file ledger: retired (local signer disabled)');
  const legacy = legacySignerState(mods, payer.ledgerPath);

  // 5. payer service, env vars, secret files
  const payerSvc = await applyPayer(opts, web, payerFound, false);
  const payerUrl = payerSvc.url;
  log('Payer configuration:');
  const payerEnvExisting = payerFound ? await getEnvVars(payerSvc.id) : new Map();
  await putEnvVars('payer', payerSvc.id, payerEnvExisting, desiredPayerEnv(payerUrl), false);
  await putSecretFiles('payer', payerSvc.id, payerFiles, false);

  // 6. web service
  log('Web configuration:');
  if (web.branch !== 'main') {
    await api('PATCH', `/services/${web.id}`, { branch: 'main' });
    log('  web branch: patched to main');
  } else log('  web branch: already main');
  if (web.autoDeployTrigger && web.autoDeployTrigger !== 'off') log(`  warning: web autoDeployTrigger is "${web.autoDeployTrigger}", left unchanged`);
  await putEnvVars('web', web.id, webEnv, webDesired(payerUrl), false);
  await putSecretFiles('web', web.id, webFiles, false);

  // 7. deploys
  if (opts.deploy) {
    const webDeploy = await triggerDeploy('web', web.id);
    const payerDeploy = await triggerDeploy('payer', payerSvc.id);
    await Promise.all([waitForDeploy('web', web.id, webDeploy), waitForDeploy('payer', payerSvc.id, payerDeploy)]);
  } else log('Deploys skipped (--no-deploy)');

  // 8. verify
  let statusReason = '';
  try {
    await verifyWeb(web.url);
    statusReason = await verifyPayer(payerUrl, bridgeToken, {
      network: policy.PAYER_CARDANO_NETWORK,
      address,
      sourceSha256: ledger.sourceSha256,
      entryCount: ledger.entryCount,
      committed: ledger.committed,
      caps,
    });
  } catch (err) {
    console.log('Hosted MCP: FAIL');
    throw err;
  }

  // 9. smoke
  log('Running no-spend smoke...');
  const smokeOk = await runSmoke(
    ['--base', web.url, '--payer-url', payerUrl, '--payer-token-file', path.join(opts.secretsDir, 'cardano-payer-bridge-token'), '--quote'],
    passcode,
  );

  // 10. report
  printReport(legacy, smokeOk ? 'PASS' : 'FAIL');
  console.log(`Hosted MCP: ${smokeOk ? 'PASS' : 'FAIL'}`);
  let payerLine;
  let payerBad = false;
  if (statusReason) {
    payerLine = `Payer: NOT READY (${statusReason})`;
    payerBad = true;
  } else if (legacy !== 'DISABLED') {
    payerLine = 'Payer: NOT READY (legacy file signer still active)';
    payerBad = true;
  } else if (!balances) payerLine = 'Payer: NOT READY (wallet balance could not be read)';
  else if (ledger.headroom <= 0n) payerLine = 'Payer: NOT READY (cap exhausted)';
  else if (balances.lovelace < MIN_LOVELACE || balances.asset < ledger.headroom) {
    const lacking = [balances.lovelace < MIN_LOVELACE ? 'tADA' : '', balances.asset < ledger.headroom ? 'tUSDM' : ''].filter(Boolean).join(' and ');
    payerLine = `Payer: NOT FUNDED (existing wallet lacks enough ${lacking}: has ${balances.lovelace} lovelace and ${balances.asset} base units; needs >= ${MIN_LOVELACE} lovelace and >= ${ledger.headroom} base units)`;
  } else payerLine = 'Payer: READY';
  log(payerLine);
  console.log(`MCP URL: ${web.url}/mcp`);
  return smokeOk && !payerBad ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err) => {
    console.error(`ERROR: ${safe(err instanceof Error ? err.message : String(err))}`);
    process.exitCode = 1;
  },
);
