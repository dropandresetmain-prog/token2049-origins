#!/usr/bin/env node
/**
 * Idempotent provisioner for the hosted MCP demo on Render, driven by ONE secret: env RENDER_API_KEY.
 *
 *  - finds the existing public web service (`--web-name`) and reads its env vars,
 *  - ensures a FREE docker web service for the Cardano payer exists (never private, never a disk, never a paid plan),
 *  - sets env vars one key at a time (PUT /services/{id}/env-vars/{KEY}); never uses the replace-all endpoint,
 *  - uploads secret files from a local secrets dir, deploys both services, verifies, checks wallet funding, runs the
 *    no-spend smoke.
 *
 * Nothing secret is ever printed: only names and statuses. The API key is never written anywhere.
 *
 * Usage: RENDER_API_KEY=... node scripts/provision-hosted-mcp-render.mjs [--dry-run] [--no-deploy]
 *          [--secrets-dir <dir>] [--wallet-address <addr>] [--web-name <name>] [--payer-name <name>] [--owner-id <id>]
 * Test-only seams: RENDER_API_BASE, PROVISION_SMOKE_CMD (JSON array), PROVISION_POLL_MS, PROVISION_VERIFY_TIMEOUT_MS.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_WALLET =
  'addr_test1qzxfrsznxqm4y2f40jv4xfdydpagzmva82c4asgzdvhsk6eqrvlay7vdxxca7rzlk5z29pe756yq58rutu6v4d02hmtqjy2drl';
const DEFAULT_SECRETS_DIR = 'C:\\Dev\\token2049-setup\\secrets\\hosted-demo';
const DEFAULT_BLOCKFROST = 'https://cardano-preprod.blockfrost.io/api/v0';
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TERMINAL_BAD = new Set(['build_failed', 'update_failed', 'canceled', 'deactivated', 'pre_deploy_failed']);

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

// ---------------------------------------------------------------------------------------------------------------------
// arguments

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    deploy: true,
    secretsDir: process.env.HOSTED_SECRETS_DIR || DEFAULT_SECRETS_DIR,
    wallet: DEFAULT_WALLET,
    webName: 'token2049-origins',
    payerName: 't2o-cardano-payer',
    ownerId: process.env.RENDER_OWNER_ID || '',
  };
  const takesValue = {
    '--secrets-dir': 'secretsDir',
    '--wallet-address': 'wallet',
    '--web-name': 'webName',
    '--payer-name': 'payerName',
    '--owner-id': 'ownerId',
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
  if (!/^addr_test1[0-9a-z]+$/.test(opts.wallet)) fail('--wallet-address must match ^addr_test1[0-9a-z]+$');
  return opts;
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
// local secrets

function readSecretFile(dir, file) {
  const full = path.join(dir, file);
  if (!existsSync(full)) fail(`Missing local secret file: ${file} (in ${dir})`);
  const value = readFileSync(full, 'utf8').trim();
  if (!value) fail(`Local secret file is empty: ${file}`);
  return track(value);
}

// ---------------------------------------------------------------------------------------------------------------------
// provisioning steps

function serviceUrl(service) {
  const url = service?.serviceDetails?.url;
  return typeof url === 'string' && url ? url.replace(/\/+$/, '') : '';
}

async function discoverWeb(opts) {
  let ownerIds;
  if (opts.ownerId) ownerIds = [opts.ownerId];
  else ownerIds = (await listAll('/owners', {}, 'owner')).map((o) => o.id);
  if (!ownerIds.length) fail('No Render workspace is visible to this API key');
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
    autoDeploy: web.autoDeploy,
    url,
  };
}

const normalizeDockerfile = (p) => String(p ?? '').replace(/^\.\//, '');

async function ensurePayer(opts, web, dryRun) {
  const existing = await findServices(opts.payerName, web.ownerId);
  if (existing.length > 1) fail(`Several services named "${opts.payerName}" in the workspace`);
  const found = existing[0];
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
      autoDeploy: 'no',
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
  if (found.type !== 'web_service') fail(`"${opts.payerName}" exists but is a ${found.type}; refusing (must be a public web_service)`);
  const plan = found.serviceDetails?.plan;
  if (plan !== 'free') fail(`Payer service "${opts.payerName}" is on plan "${plan}", not free; refusing to continue`);
  const patch = {};
  if (found.branch !== 'main') patch.branch = 'main';
  if (found.autoDeploy !== 'no') patch.autoDeploy = 'no';
  if (normalizeDockerfile(found.serviceDetails?.envSpecificDetails?.dockerfilePath) !== 'Dockerfile.payer') {
    patch.serviceDetails = { envSpecificDetails: { dockerfilePath: './Dockerfile.payer' } };
  }
  const url = serviceUrl(found);
  if (!url) fail(`Payer service "${opts.payerName}" has no public URL`);
  if (Object.keys(patch).length) {
    if (dryRun) log(`Payer service "${opts.payerName}": would patch ${Object.keys(patch).join(', ')}`);
    else {
      await api('PATCH', `/services/${found.id}`, patch);
      log(`Payer service "${opts.payerName}": patched ${Object.keys(patch).join(', ')}`);
    }
  } else log(`Payer service "${opts.payerName}": exists, settings already correct`);
  return { id: found.id, url };
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

async function verifyPayer(payer, bridgeToken, wallet) {
  await retry('payer /health', async () => {
    const res = await fetch(`${payer}/health`, { signal: timed() });
    return res.status === 200 ? '' : `HTTP ${res.status}`;
  });
  log('payer /health: 200');
  try {
    await retry('payer /status', async () => {
      const res = await fetch(`${payer}/status`, { headers: { Authorization: `Bearer ${bridgeToken}` }, signal: timed() });
      if (res.status !== 200) return `HTTP ${res.status}`;
      const json = await res.json().catch(() => null);
      const src = json?.source;
      if (json?.ok !== true) return 'ok is not true';
      if (src?.rail !== 'cardano' || src?.network !== 'cardano:preprod') return 'unexpected rail/network';
      if (src?.publicAddress !== wallet) return 'publicAddress does not match the wallet address';
      if (src?.readiness !== 'configured') return `readiness is ${String(src?.readiness)}`;
      return '';
    });
    log('payer /status: ok (cardano:preprod, configured, address matches)');
    return true;
  } catch (err) {
    log(`payer /status: NOT OK (${err instanceof Error ? err.message : 'failed'})`);
    return false;
  }
}

async function checkFunding(base, projectId, wallet, unit) {
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/addresses/${wallet}`, {
      headers: { project_id: projectId },
      signal: timed(),
    });
    if (res.status === 404) {
      log('wallet funding: address has no on-chain history yet');
      return false;
    }
    if (res.status !== 200) {
      log(`wallet funding: Blockfrost HTTP ${res.status} (could not check)`);
      return false;
    }
    const json = await res.json();
    const amounts = Array.isArray(json?.amount) ? json.amount : [];
    const qty = (u) => {
      const row = amounts.find((a) => a?.unit === u);
      try {
        return BigInt(row?.quantity ?? '0');
      } catch {
        return 0n;
      }
    };
    const lovelaceOk = qty('lovelace') >= 5_000_000n;
    const assetOk = qty(unit) >= 500_000n;
    log(`wallet funding: lovelace ${lovelaceOk ? 'sufficient' : 'LOW'} (need >= 5000000), asset ${assetOk ? 'sufficient' : 'LOW'} (need >= 500000)`);
    return lovelaceOk && assetOk;
  } catch (err) {
    log(`wallet funding: could not check (${err instanceof Error ? err.message : 'failed'})`);
    return false;
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
  apiKey = process.env.RENDER_API_KEY ?? '';
  if (!apiKey) fail('RENDER_API_KEY is not set');
  track(apiKey);
  if (process.env.RENDER_API_BASE) apiBase = process.env.RENDER_API_BASE.replace(/\/+$/, '');
  readOnly = opts.dryRun;

  // Local secrets first: fail before any API call if one is missing.
  const dir = opts.secretsDir;
  const mnemonic = readSecretFile(dir, 'payer.mnemonic');
  const bridgeToken = readSecretFile(dir, 'cardano-payer-bridge-token');
  const gatewayToken = readSecretFile(dir, 'payer-gateway-token');
  const passcode = readSecretFile(dir, 'mcp-owner-passcode');
  const gatewayTokenSha = createHash('sha256').update(gatewayToken, 'utf8').digest('hex');

  log(opts.dryRun ? 'Mode: dry run (reads only)' : 'Mode: apply');

  // 1-2. web service and its env vars
  const web = await discoverWeb(opts);
  log(`Web service "${opts.webName}": ${web.id} (region ${web.region}, branch ${web.branch})`);
  const webEnv = await getEnvVars(web.id);
  const required = ['DATABASE_URL', 'BLOCKFROST_PROJECT_ID', 'CARDANO_ASSET_UNIT', 'CARDANO_TREASURY_ADDRESS'];
  const missing = required.filter((k) => !webEnv.get(k));
  if (missing.length) fail(`Web service is missing required env var(s): ${missing.join(', ')}`);
  track(webEnv.get('DATABASE_URL'));
  track(webEnv.get('BLOCKFROST_PROJECT_ID'));
  const blockfrostBase = webEnv.get('BLOCKFROST_BASE_URL') || DEFAULT_BLOCKFROST;

  // 3. payer service
  const payer = await ensurePayer(opts, web, opts.dryRun);
  const payerUrl = payer?.url ?? `https://${opts.payerName}.onrender.com`;
  const payerHost = new URL(payerUrl).host;
  const payerExisting = payer ? await getEnvVars(payer.id) : new Map();

  // 4-5. payer env vars and secret files
  log('Payer configuration:');
  const payerEnv = new Map([
    ['DATABASE_URL', webEnv.get('DATABASE_URL')],
    ['PAYER_BRIDGE_ALLOWED_HOSTS', payerHost],
    ['PAYER_BRIDGE_TOKEN_FILE', '/etc/secrets/cardano-payer-bridge-token'],
    ['PAYER_GATEWAY_URL', web.url],
    ['PAYER_GATEWAY_TOKEN_FILE', '/etc/secrets/payer-gateway-token'],
    ['PAYER_CARDANO_NETWORK', 'cardano:preprod'],
    ['PAYER_CARDANO_MNEMONIC_FILE', '/etc/secrets/payer-cardano-mnemonic'],
    ['PAYER_WALLET_ADDRESS', opts.wallet],
    ['BLOCKFROST_PROJECT_ID', webEnv.get('BLOCKFROST_PROJECT_ID')],
    ['BLOCKFROST_BASE_URL', blockfrostBase],
    ['PAYER_ALLOWED_ASSET_UNIT', webEnv.get('CARDANO_ASSET_UNIT')],
    ['PAYER_EXPECTED_PAY_TO', webEnv.get('CARDANO_TREASURY_ADDRESS')],
    ['PAYER_MAX_PER_PAYMENT_BASE_UNITS', '500000'],
    ['PAYER_MAX_CUMULATIVE_BASE_UNITS', '1500000'],
    ['PAYER_MAX_DAILY_BASE_UNITS', '1000000'],
    ['PAYER_MAX_FEE_LOVELACE', '2000000'],
    ['PAYER_MAX_ADA_OUTPUT_LOVELACE', '3000000'],
  ]);
  const payerId = payer?.id ?? '(new)';
  await putEnvVars('payer', payerId, payerExisting, payerEnv, opts.dryRun || !payer);
  await putSecretFiles(
    'payer',
    payerId,
    new Map([
      ['payer-cardano-mnemonic', mnemonic],
      ['cardano-payer-bridge-token', bridgeToken],
      ['payer-gateway-token', gatewayToken],
    ]),
    opts.dryRun || !payer,
  );

  // 6. web service
  log('Web configuration:');
  if (web.branch !== 'main') {
    if (opts.dryRun) log('  web branch: would patch to main');
    else {
      await api('PATCH', `/services/${web.id}`, { branch: 'main' });
      log('  web branch: patched to main');
    }
  } else log('  web branch: already main');
  if (web.autoDeploy && web.autoDeploy !== 'no') log(`  warning: web autoDeploy is "${web.autoDeploy}", left unchanged`);
  const webDesired = new Map([
    ['PUBLIC_BASE_URL', web.url],
    ['MCP_PUBLIC_URL', web.url],
    ['MCP_HOSTED_ENABLED', 'true'],
    ['MCP_OAUTH_OWNER_PASSCODE_FILE', '/etc/secrets/mcp-owner-passcode'],
    ['CARDANO_PAYER_BRIDGE_URL', payerUrl],
    ['CARDANO_PAYER_BRIDGE_TOKEN_FILE', '/etc/secrets/cardano-payer-bridge-token'],
    ['MCP_PAYER_GATEWAY_TOKEN_SHA256', gatewayTokenSha],
  ]);
  await putEnvVars('web', web.id, webEnv, webDesired, opts.dryRun);
  await putSecretFiles(
    'web',
    web.id,
    new Map([
      ['mcp-owner-passcode', passcode],
      ['cardano-payer-bridge-token', bridgeToken],
    ]),
    opts.dryRun,
  );

  if (opts.dryRun) {
    log(`Dry run complete. Plan: ${opts.deploy ? 'deploy web then payer, ' : ''}verify, check wallet funding, run smoke.`);
    return 0;
  }

  // 7. deploys
  if (opts.deploy) {
    const webDeploy = await triggerDeploy('web', web.id);
    const payerDeploy = await triggerDeploy('payer', payer.id);
    await Promise.all([waitForDeploy('web', web.id, webDeploy), waitForDeploy('payer', payer.id, payerDeploy)]);
  } else log('Deploys skipped (--no-deploy)');

  // 8. verify
  let statusOk = false;
  try {
    await verifyWeb(web.url);
    statusOk = await verifyPayer(payerUrl, bridgeToken, opts.wallet);
  } catch (err) {
    console.log('Hosted MCP: FAIL');
    throw err;
  }

  // 9. funding (informational)
  const funded = await checkFunding(blockfrostBase, webEnv.get("BLOCKFROST_PROJECT_ID"), opts.wallet, webEnv.get("CARDANO_ASSET_UNIT"));

  // 10. smoke
  log('Running no-spend smoke...');
  const smokeOk = await runSmoke(
    [
      '--base', web.url,
      '--payer-url', payerUrl,
      '--payer-token-file', path.join(dir, 'cardano-payer-bridge-token'),
      '--quote',
    ],
    passcode,
  );

  // 11. summary
  if (!smokeOk) {
    console.log('Hosted MCP: FAIL');
    return 1;
  }
  console.log('Hosted MCP: PASS');
  if (!statusOk) console.log('Payer: NOT READY');
  else if (!funded) console.log(`Payer: NOT FUNDED (send tADA + tUSDM to ${opts.wallet})`);
  else console.log('Payer: READY');
  console.log(`MCP URL: ${web.url}/mcp`);
  return 0;
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
