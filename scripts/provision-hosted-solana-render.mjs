#!/usr/bin/env node
/** Read-only by default. --apply is a final approved migration/provisioning step and may start a Render deploy. */
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolveRenderKey, configureRenderAccess, discoverWeb, lookupPayer, applyPayer, getEnvVars, putEnvVars, putSecretFiles, hostedSecret, track } from './provision-hosted-mcp-render.mjs';
import { loadSolanaPayerConfig } from '../clients/solana/config.js';
import { loadSigner, assertPrivateKeyFile } from '../clients/solana/signer.js';
import { SolanaLedger } from '../clients/solana/ledger.js';
import { parseSolanaImport, retireSolanaHistories, solanaSourceHash } from '../clients/solana/ledger-import.js';

const hash = text => createHash('sha256').update(text).digest('hex');
const POLICY_KEYS = ['SOLANA_NETWORK', 'SOLANA_RPC_URL', 'SOLANA_PAYER_RPC_URL', 'SOLANA_USDC_MINT', 'SOLANA_ASSET_DECIMALS',
  'SOLANA_TREASURY_ADDRESS', 'SOLANA_TREASURY_TOKEN_ACCOUNT', 'SOLANA_FEE_PAYER_ADDRESS', 'SOLANA_PAYER_ADDRESS', 'SOLANA_PAYER_TOKEN_ACCOUNT',
  'SOLANA_MAX_PAYMENT_BASE_UNITS', 'SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS', 'SOLANA_PAYER_MAX_TOTAL_BASE_UNITS', 'SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR', 'SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS'];

export function solanaProvisionPlan(env, inputs, web, url, tokens) {
  const payer = new Map(POLICY_KEYS.map(key => [key, env[key]]));
  for (const [key, value] of payer) if (!value) throw new Error(`missing policy field: ${key}`);
  const publicConfig = new Map(['SOLANA_NETWORK', 'SOLANA_RPC_URL', 'SOLANA_USDC_MINT', 'SOLANA_ASSET_DECIMALS', 'SOLANA_TREASURY_ADDRESS', 'SOLANA_TREASURY_TOKEN_ACCOUNT', 'SOLANA_FEE_PAYER_ADDRESS', 'SOLANA_MAX_PAYMENT_BASE_UNITS'].map(key => [key, env[key]]));
  publicConfig.set('SOLANA_SETTLEMENT_MODE', 'payer_broadcast');
  publicConfig.set('SOLANA_PAYER_BRIDGE_URL', url);
  publicConfig.set('SOLANA_PAYER_BRIDGE_TOKEN_FILE', '/etc/secrets/solana-payer-bridge-token');
  publicConfig.set('MCP_SOLANA_PAYER_GATEWAY_TOKEN_SHA256', hash(tokens.gateway));
  for (const [key, value] of Object.entries({
    DATABASE_URL: web.databaseUrl, SOLANA_SETTLEMENT_MODE: 'payer_broadcast', SOLANA_GATEWAY_URL: web.url,
    SOLANA_PAYER_BRIDGE_ALLOWED_HOSTS: new URL(url).host,
    SOLANA_PAYER_KEY_FILE: '/etc/secrets/solana-payer-key', SOLANA_SPONSOR_KEY_FILE: '/etc/secrets/solana-sponsor-key',
    SOLANA_PAYER_BRIDGE_TOKEN_FILE: '/etc/secrets/solana-payer-bridge-token', SOLANA_GATEWAY_TOKEN_FILE: '/etc/secrets/solana-payer-gateway-token',
    SOLANA_LEGACY_SIGNERS_RETIRED: 'true', SOLANA_LEGACY_PAYER_LEDGER_FILE: '/etc/secrets/solana-legacy-payer', SOLANA_LEGACY_SPONSOR_LEDGER_FILE: '/etc/secrets/solana-legacy-sponsor',
    SOLANA_LEGACY_PAYER_LEDGER_SHA256: inputs[0].expectedSha256, SOLANA_LEGACY_SPONSOR_LEDGER_SHA256: inputs[1].expectedSha256,
  })) payer.set(key, value);
  return { payer, gateway: publicConfig };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const value = flag => { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; };
  const allowed = new Set(['--apply', '--dry-run', '--policy-file', '--payer-ledger', '--sponsor-ledger', '--branch', '--secrets-dir', '--owner-id']);
  for (let i = 0; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error('unknown provisioning argument');
    if (!['--apply', '--dry-run'].includes(args[i])) { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('provisioning argument requires a value'); i++; }
  }
  if (apply && args.includes('--dry-run')) throw new Error('choose --apply or --dry-run');
  const policyFile = value('--policy-file');
  const payerPath = value('--payer-ledger'), sponsorPath = value('--sponsor-ledger');
  if (!policyFile || !payerPath || !sponsorPath) throw new Error('--policy-file, --payer-ledger and --sponsor-ledger are required; never initialize new history');
  process.loadEnvFile(policyFile);
  const env = { ...process.env, SOLANA_SETTLEMENT_MODE: 'payer_broadcast' };
  const cfg = loadSolanaPayerConfig(env, { ledger: 'external' });
  let keysProtected = true;
  try { assertPrivateKeyFile(cfg.keyFile); assertPrivateKeyFile(cfg.sponsorKeyFile); } catch { keysProtected = false; }
  if (apply && !keysProtected) throw new Error('signer key files must be protected before provisioning');
  await Promise.all([loadSigner(cfg.keyFile, cfg.payer), loadSigner(cfg.sponsorKeyFile, cfg.sponsor)]);
  const inputs = [
    { role: 'payer', owner: cfg.payer, path: path.resolve(payerPath) },
    { role: 'sponsor', owner: cfg.sponsor, path: path.resolve(sponsorPath) },
  ].map(input => {
    if (existsSync(input.path + '.lock') && !existsSync(input.path + '.retired')) throw new Error('Solana legacy signer lock exists; reconcile before provisioning');
    new SolanaLedger(input.path, input.owner).read({ allowRetired: true });
    const text = track(readFileSync(input.path, 'utf8'));
    return { ...input, text, expectedSha256: solanaSourceHash(text) };
  });
  const rows = inputs.map(parseSolanaImport);
  const committed = rows[0].reduce((n, e) => n + BigInt(e.amount), 0n);
  const fees = rows[1].reduce((n, e) => n + BigInt(e.fee), 0n);
  const incomplete = rows.flat().filter(e => !e.id.startsWith('history:') && (!e.signature || !e.header)).length;
  console.log(JSON.stringify({ noSpend: true, mode: apply ? 'apply' : 'dry-run', payer: cfg.payer, sponsor: cfg.sponsor,
    histories: inputs.map((input, i) => ({ role: input.role, entries: rows[i].length, sourceSha256: input.expectedSha256 })),
    committedBaseUnits: committed.toString(), sponsorFeeLamports: fees.toString(), incomplete, keysProtected,
    caps: { perPayment: cfg.maxPerPayment.toString(), cumulative: cfg.maxTotal.toString(), sponsorFee: cfg.maxFees.toString() },
    remainingBaseUnits: (cfg.maxTotal - committed).toString(), legacyRetired: inputs.every(input => existsSync(input.path + '.retired')) }));
  if (committed >= cfg.maxTotal || fees + 10001n > cfg.maxFees) throw new Error('existing Solana history exhausts the policy');
  if (apply && incomplete) throw new Error('unresolved legacy reservations require reconciliation before migration');
  configureRenderAccess({ key: resolveRenderKey(), dryRun: !apply, base: process.env.RENDER_API_BASE });
  const opts = { webName: 'token2049-origins', payerName: 't2o-solana-payer', ownerId: value('--owner-id') || '', branch: value('--branch') || 'feat/hosted-commerce-completion', dockerfile: './Dockerfile.solana' };
  const web = await discoverWeb(opts);
  const webEnv = await getEnvVars(web.id);
  if (!webEnv.get('DATABASE_URL')) throw new Error('existing gateway PostgreSQL is required');
  for (const key of ['SOLANA_TREASURY_ADDRESS', 'SOLANA_TREASURY_TOKEN_ACCOUNT', 'SOLANA_FEE_PAYER_ADDRESS', 'SOLANA_USDC_MINT', 'SOLANA_ASSET_DECIMALS']) {
    if (webEnv.get(key) && webEnv.get(key) !== env[key]) throw new Error(`existing gateway identity/policy differs: ${key}`);
  }
  const existing = await lookupPayer(opts, web);
  if (existing?.serviceDetails?.disk) throw new Error('disk-backed Solana service refused');
  const secretsDir = value('--secrets-dir') || 'C:/Dev/token2049-setup/secrets/hosted-demo';
  const tokens = { bridge: hostedSecret(secretsDir, 'solana-payer-bridge-token', !apply), gateway: hostedSecret(secretsDir, 'solana-payer-gateway-token', !apply) };
  if (tokens.bridge === tokens.gateway) throw new Error('Solana service tokens must be distinct');
  if (tokens.bridge === readFileIfExists(path.join(secretsDir, 'cardano-payer-bridge-token')) || hash(tokens.gateway) === webEnv.get('MCP_PAYER_GATEWAY_TOKEN_SHA256')) throw new Error('Solana and Cardano service tokens must be distinct');
  if (apply) await retireSolanaHistories(inputs);
  const service = await applyPayer(opts, web, existing, !apply);
  const url = service?.url || 'https://t2o-solana-payer.onrender.com';
  const plan = solanaProvisionPlan(env, inputs, { ...web, databaseUrl: track(webEnv.get('DATABASE_URL')) }, url, tokens);
  const payerFiles = new Map([
    ['solana-payer-key', track(readFileSync(cfg.keyFile, 'utf8'))], ['solana-sponsor-key', track(readFileSync(cfg.sponsorKeyFile, 'utf8'))],
    ['solana-legacy-payer', inputs[0].text], ['solana-legacy-sponsor', inputs[1].text],
    ['solana-payer-bridge-token', tokens.bridge], ['solana-payer-gateway-token', tokens.gateway],
  ]);
  await putEnvVars('solana payer', service?.id || '(new)', existing ? await getEnvVars(existing.id) : new Map(), plan.payer, !apply);
  await putSecretFiles('solana payer', service?.id || '(new)', payerFiles, !apply);
  await putEnvVars('gateway', web.id, webEnv, plan.gateway, !apply);
  await putSecretFiles('gateway', web.id, new Map([['solana-payer-bridge-token', tokens.bridge]]), !apply);
  console.log(apply ? 'Solana migration/configuration applied. Verify deploys, imports and no-spend dual-rail readiness before any funding proof.' : 'Dry run complete; no retirement, service writes or deployment. --apply requires final approval.');
}
const readFileIfExists = file => existsSync(file) ? readFileSync(file, 'utf8').trim() : '';
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(() => {
  // API and configuration errors may contain provider/config values. The report above carries safe actionable state only.
  console.error('Solana provisioning rejected; check policy, protected identities, complete history, retirement and free-service configuration. No automatic spend or retry.');
  process.exitCode = 1;
});
