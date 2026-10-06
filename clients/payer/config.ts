/**
 * Payer process configuration. This process holds spending authority (a mnemonic file); the commerce
 * gateway never imports anything from clients/. Error messages name variables, never values, and the
 * token/mnemonic files are only read at the moment they are needed.
 */
import { isAbsolute, parse } from 'node:path';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { isTrustedBlockfrostUrl } from '../../src/funding/cardano/blockfrost.js';

const IntegerString = z.string().regex(/^[1-9][0-9]*$/, 'positive integer');
const CANON_ASSET = /^(lovelace|[0-9a-f]{56}\.[0-9a-f]{0,64})$/;
const DEFAULT_BLOCKFROST_PREPROD_URL = 'https://cardano-preprod.blockfrost.io/api/v0';

/** https anywhere, plain http only to loopback (the local gateway). No embedded credentials. */
const SafeUrl = z.string().refine((s) => {
  try {
    const u = new URL(s);
    if (u.username || u.password || u.search || u.hash) return false;
    const loop = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
    return u.protocol === 'https:' || (u.protocol === 'http:' && loop);
  } catch {
    return false;
  }
}, 'https URL (or http on loopback)');

export function payerLedgerPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f]/.test(value) || value !== value.trim() ||
      !isAbsolute(value) || !parse(value).base || /[\\/]$/.test(value) ||
      (process.platform === 'win32' && /[<>:"|?*]/.test(value.slice(parse(value).root.length))) ||
      (process.platform === 'win32' && !/^(?:[A-Za-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/.test(value))) {
    throw new Error('invalid payer configuration: PAYER_LEDGER_FILE (absolute file path required)');
  }
  return value;
}

const PayerEnv = z.object({
  PAYER_GATEWAY_URL: SafeUrl,
  PAYER_GATEWAY_TOKEN_FILE: z.string().min(1),
  PAYER_CARDANO_NETWORK: z.literal('cardano:preprod'),
  PAYER_CARDANO_MNEMONIC_FILE: z.string().min(1),
  BLOCKFROST_PROJECT_ID: z.string().min(1),
  BLOCKFROST_BASE_URL: SafeUrl.refine(isTrustedBlockfrostUrl, 'official Preprod or trusted loopback Blockfrost').default(DEFAULT_BLOCKFROST_PREPROD_URL),
  PAYER_MAX_PER_PAYMENT_BASE_UNITS: IntegerString,
  PAYER_MAX_CUMULATIVE_BASE_UNITS: IntegerString,
  PAYER_MAX_DAILY_BASE_UNITS: IntegerString,
  PAYER_MAX_FEE_LOVELACE: IntegerString,
  PAYER_MAX_ADA_OUTPUT_LOVELACE: IntegerString,
  PAYER_ALLOWED_ASSET_UNIT: z.string().transform((s) => s.trim().toLowerCase()).refine((s) => CANON_ASSET.test(s), 'lovelace or policyId.assetNameHex'),
  PAYER_EXPECTED_PAY_TO: z.string().regex(/^addr_test1[0-9a-z]+$/),
  PAYER_LEDGER_FILE: z.string().min(1).refine(s => { try { payerLedgerPath(s); return true; } catch { return false; } }, 'absolute file path required'),
});

export interface PayerConfig {
  gatewayUrl: string;
  gatewayTokenFile: string;
  network: 'cardano:preprod';
  mnemonicFile: string;
  blockfrostProjectId: string;
  blockfrostBaseUrl: string;
  maxPerPayment: bigint;
  maxCumulative: bigint;
  maxDaily: bigint;
  maxFeeLovelace: bigint;
  maxAdaOutputLovelace: bigint;
  allowedAsset: string;
  expectedPayTo: string;
  ledgerFile: string;
}

export interface BridgeConfig {
  port: number;
  tokenFile: string;
}

export function loadPayerConfig(env: NodeJS.ProcessEnv = process.env): PayerConfig {
  // Treat empty strings (from a copied .env.payer.example) as unset so defaults and optionals apply.
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (k.startsWith('PAYER_') || k.startsWith('BLOCKFROST_')) if (v !== undefined && v.trim() !== '') cleaned[k] = v.trim();
  const parsed = PayerEnv.safeParse(cleaned);
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(', ');
    throw new Error(`invalid payer configuration: ${names}`);
  }
  const e = parsed.data;
  if (BigInt(e.PAYER_MAX_CUMULATIVE_BASE_UNITS) < BigInt(e.PAYER_MAX_PER_PAYMENT_BASE_UNITS)) {
    throw new Error('invalid payer configuration: PAYER_MAX_CUMULATIVE_BASE_UNITS');
  }
  return {
    gatewayUrl: e.PAYER_GATEWAY_URL.replace(/\/+$/, ''),
    gatewayTokenFile: e.PAYER_GATEWAY_TOKEN_FILE,
    network: e.PAYER_CARDANO_NETWORK,
    mnemonicFile: e.PAYER_CARDANO_MNEMONIC_FILE,
    blockfrostProjectId: e.BLOCKFROST_PROJECT_ID,
    blockfrostBaseUrl: e.BLOCKFROST_BASE_URL.replace(/\/+$/, ''),
    maxPerPayment: BigInt(e.PAYER_MAX_PER_PAYMENT_BASE_UNITS),
    maxCumulative: BigInt(e.PAYER_MAX_CUMULATIVE_BASE_UNITS),
    maxDaily: BigInt(e.PAYER_MAX_DAILY_BASE_UNITS),
    maxFeeLovelace: BigInt(e.PAYER_MAX_FEE_LOVELACE),
    maxAdaOutputLovelace: BigInt(e.PAYER_MAX_ADA_OUTPUT_LOVELACE),
    allowedAsset: e.PAYER_ALLOWED_ASSET_UNIT,
    expectedPayTo: e.PAYER_EXPECTED_PAY_TO,
    ledgerFile: e.PAYER_LEDGER_FILE,
  };
}

const CARDANO_BRIDGE_VARS = { tokenFile: 'PAYER_BRIDGE_TOKEN_FILE', port: 'PAYER_BRIDGE_PORT', defaultPort: 8788 };

/** Bridge listener settings. Defaults to the Cardano bridge variables; the Solana bridge passes its own names. */
export function loadBridgeConfig(env: NodeJS.ProcessEnv = process.env, vars = CARDANO_BRIDGE_VARS): BridgeConfig {
  const tokenFile = String(env[vars.tokenFile] ?? '').trim();
  const port = Number(String(env[vars.port] ?? String(vars.defaultPort)).trim());
  const bad: string[] = [];
  if (!tokenFile) bad.push(vars.tokenFile);
  if (!Number.isInteger(port) || port < 1 || port > 65535) bad.push(vars.port);
  if (bad.length) throw new Error(`invalid bridge configuration: ${bad.join(', ')}`);
  return { port, tokenFile };
}

/** Read a one-line secret file. Never echo the contents; errors carry only the variable name. */
export function readSecretFile(path: string, label: string): string {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`cannot read ${label}`);
  }
  const v = raw.trim();
  if (!v) throw new Error(`${label} is empty`);
  return v;
}
