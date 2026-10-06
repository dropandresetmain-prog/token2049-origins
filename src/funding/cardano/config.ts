/**
 * Cardano rail configuration. Parsed from env by the adapter itself so missing secrets never stop the
 * gateway from booting; the rail just reports MISSING_CONFIG. Error output carries variable NAMES only.
 */
import {
  CANONICAL_CARDANO_ASSET_REGEX,
  CARDANO_ADDRESS_REGEX,
  CARDANO_PREPROD_CAIP2,
  LOVELACE_ASSET,
  USDM_PREPROD_ASSET,
} from '@x402/cardano';
import { DEFAULT_BLOCKFROST_PREPROD_URL, isTrustedBlockfrostUrl } from './blockfrost.js';
import { missingEnv } from '../../infrastructure/config.js';

// Masumi dispenser tUSDM is distinct from the SDK default token. Recognize its exact Preprod
// identity only; the shared ticker never permits substituting one asset for the other.
// Source: https://www.masumi.network/dev/masumi/documentation/how-to-guides/list-agent-on-sokosumi
export const MASUMI_USDM_PREPROD_ASSET = '16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde.0014df10745553444d';
const isRecognizedTusdm = (unit: string) => unit === USDM_PREPROD_ASSET || unit === MASUMI_USDM_PREPROD_ASSET;

export const CARDANO_NETWORK = CARDANO_PREPROD_CAIP2; // 'cardano:preprod'
/** L1 depth advertised in every requirement and required before the adapter reports `confirmed`. */
export const REQUIRED_L1_CONFIRMATIONS = 1;

/** Env names that must be present (BLOCKFROST_BASE_URL is optional, defaulting to preprod). */
export const REQUIRED_ENV = [
  'CARDANO_NETWORK',
  'CARDANO_FACILITATOR_URL',
  'CARDANO_TREASURY_ADDRESS',
  'CARDANO_ASSET_UNIT',
  'CARDANO_ASSET_DECIMALS',
  'BLOCKFROST_PROJECT_ID',
] as const;

export interface CardanoConfig {
  network: typeof CARDANO_NETWORK;
  facilitatorUrl: string;
  facilitatorHost: string;
  treasuryAddress: string;
  /** Canonical lowercase `lovelace` or `policyId.assetNameHex`. */
  assetUnit: string;
  decimals: number;
  blockfrostProjectId: string;
  blockfrostBaseUrl: string;
  /** Exact SDK-default or Masumi-dispenser Preprod tUSDM identity, never a ticker match. */
  isTusdm: boolean;
}

export type CardanoConfigResult =
  | { ok: true; config: CardanoConfig }
  | { ok: false; missing: string[]; invalid: string[] };

/** https anywhere, or plain http only to a loopback host (self-hosted facilitator / test servers). */
function safeHttpUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null; // credentials in URLs leak into logs
  const loopback = u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
  if (u.protocol === 'https:' || (u.protocol === 'http:' && loopback)) return u;
  return null;
}

export function parseCardanoConfig(env: NodeJS.ProcessEnv): CardanoConfigResult {
  const missing = missingEnv(env, [...REQUIRED_ENV]);
  const invalid: string[] = [];
  const v = (n: string) => String(env[n] ?? '').trim();
  const has = (n: string) => !missing.includes(n);

  if (has('CARDANO_NETWORK') && v('CARDANO_NETWORK') !== CARDANO_NETWORK) invalid.push('CARDANO_NETWORK');

  const facilitator = has('CARDANO_FACILITATOR_URL') ? safeHttpUrl(v('CARDANO_FACILITATOR_URL')) : null;
  if (has('CARDANO_FACILITATOR_URL') && !facilitator) invalid.push('CARDANO_FACILITATOR_URL');

  // Testnet only: mainnet `addr1…` is rejected on purpose.
  if (has('CARDANO_TREASURY_ADDRESS')) {
    const a = v('CARDANO_TREASURY_ADDRESS');
    if (!a.startsWith('addr_test1') || !CARDANO_ADDRESS_REGEX.test(a)) invalid.push('CARDANO_TREASURY_ADDRESS');
  }

  // Hex is case-insensitive on chain; normalize to the lowercase canonical wire form the SDK requires.
  const unit = has('CARDANO_ASSET_UNIT') ? v('CARDANO_ASSET_UNIT').toLowerCase() : '';
  if (has('CARDANO_ASSET_UNIT') && !CANONICAL_CARDANO_ASSET_REGEX.test(unit)) invalid.push('CARDANO_ASSET_UNIT');

  let decimals = NaN;
  if (has('CARDANO_ASSET_DECIMALS')) {
    decimals = /^\d{1,2}$/.test(v('CARDANO_ASSET_DECIMALS')) ? Number(v('CARDANO_ASSET_DECIMALS')) : NaN;
    if (!Number.isInteger(decimals) || decimals > 18) invalid.push('CARDANO_ASSET_DECIMALS');
    // Recognized tUSDM tokens and lovelace are 6-decimal; a different value mis-scales quotes.
    else if ((unit === LOVELACE_ASSET || isRecognizedTusdm(unit)) && decimals !== 6) invalid.push('CARDANO_ASSET_DECIMALS');
  }

  const rawBase = v('BLOCKFROST_BASE_URL');
  const base = rawBase ? safeHttpUrl(rawBase) : null;
  if (rawBase && (!base || !isTrustedBlockfrostUrl(rawBase))) invalid.push('BLOCKFROST_BASE_URL');

  if (missing.length || invalid.length || !facilitator) return { ok: false, missing, invalid };
  return {
    ok: true,
    config: {
      network: CARDANO_NETWORK,
      facilitatorUrl: facilitator.toString().replace(/\/+$/, ''),
      facilitatorHost: facilitator.host,
      treasuryAddress: v('CARDANO_TREASURY_ADDRESS'),
      assetUnit: unit,
      decimals,
      blockfrostProjectId: v('BLOCKFROST_PROJECT_ID'),
      blockfrostBaseUrl: base ? base.toString().replace(/\/+$/, '') : DEFAULT_BLOCKFROST_PREPROD_URL,
      isTusdm: isRecognizedTusdm(unit),
    },
  };
}
