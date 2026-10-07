import { readFileSync } from 'node:fs';
import { MasumiClient, TUSDM, validateServiceUrl } from '../../integrations/masumi/client.js';
import type { SokosumiIdentity } from './runtime.js';

export interface SokosumiMarketplaceConfig {
  databaseUrl: string;
  databaseSchema: string;
  gatewayUrl: string;
  identity: SokosumiIdentity;
  masumi: MasumiClient;
}

export class SokosumiConfigError extends Error {}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key]?.trim();
  if (!value) throw new SokosumiConfigError(`${key} is required`);
  return value;
}

function secret(env: NodeJS.ProcessEnv, valueKey: string, fileKey: string, minLength: number): string {
  const value = env[valueKey]?.trim();
  const path = env[fileKey]?.trim();
  if (value && path) throw new SokosumiConfigError(`${valueKey} and ${fileKey} cannot both be set`);
  let resolved = value;
  if (path) {
    try { resolved = readFileSync(path, 'utf8').trim(); }
    catch { throw new SokosumiConfigError(`${fileKey} cannot be read`); }
  }
  if (!resolved || resolved.length < minLength) throw new SokosumiConfigError(`${valueKey} or ${fileKey} is required`);
  return resolved;
}

/** Nothing is configured unless explicitly enabled; errors never include secret values. */
export function loadSokosumiMarketplaceConfig(env: NodeJS.ProcessEnv): SokosumiMarketplaceConfig | null {
  if (env.SOKOSUMI_MARKETPLACE_ENABLED !== 'true') {
    if (env.SOKOSUMI_MARKETPLACE_ENABLED && env.SOKOSUMI_MARKETPLACE_ENABLED !== 'false') {
      throw new SokosumiConfigError('SOKOSUMI_MARKETPLACE_ENABLED must be true or false');
    }
    return null;
  }
  const databaseUrl = required(env, 'SOKOSUMI_DATABASE_URL');
  const databaseSchema = required(env, 'SOKOSUMI_DATABASE_SCHEMA');
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) throw new SokosumiConfigError('SOKOSUMI_DATABASE_URL must use PostgreSQL');
  const coreSchema = (env.DATABASE_SCHEMA ?? env.DB_SCHEMA ?? 'public').trim();
  if (!/^sokosumi_marketplace_[a-z0-9_]+$/.test(databaseSchema) || databaseSchema === coreSchema) {
    throw new SokosumiConfigError('SOKOSUMI_DATABASE_SCHEMA must use a fresh sokosumi_marketplace_* namespace distinct from the core schema');
  }
  if (env.MASUMI_NETWORK !== 'preprod') throw new SokosumiConfigError('MASUMI_NETWORK must be preprod');
  const paymentServiceUrl = validateServiceUrl(required(env, 'MASUMI_PAYMENT_SERVICE_URL'));
  const paymentService = new URL(paymentServiceUrl);
  if (paymentService.protocol !== 'https:' || ['localhost', '127.0.0.1', '::1'].includes(paymentService.hostname)) {
    throw new SokosumiConfigError('MASUMI_PAYMENT_SERVICE_URL must be a remotely reachable HTTPS origin');
  }
  const assetUnit = required(env, 'MASUMI_PAYMENT_ASSET_UNIT');
  if (assetUnit !== TUSDM) throw new SokosumiConfigError('Only the exact Preprod tUSDM asset is enabled');
  const sellerVkey = secret(env, 'MASUMI_SELLER_VKEY', 'MASUMI_SELLER_VKEY_FILE', 1);
  const masumi = new MasumiClient({
    baseUrl: paymentServiceUrl,
    token: secret(env, 'MASUMI_PAYMENT_API_KEY', 'MASUMI_PAYMENT_API_KEY_FILE', 24),
    agentIdentifier: required(env, 'MASUMI_AGENT_ID'), sellerVkey,
    sellerAddress: required(env, 'MASUMI_SELLER_ADDRESS'), contractAddress: required(env, 'MASUMI_CONTRACT_ADDRESS'),
    assetUnit, feeBaseUnits: required(env, 'MASUMI_SERVICE_FEE_BASE_UNITS'),
    blockfrostKey: secret(env, 'MASUMI_BLOCKFROST_PROJECT_ID', 'MASUMI_BLOCKFROST_PROJECT_ID_FILE', 1),
    blockfrostBaseUrl: 'https://cardano-preprod.blockfrost.io/api/v0',
  });
  const authToken = secret(env, 'MASUMI_CHANNEL_AUTH_TOKEN', 'MASUMI_CHANNEL_AUTH_TOKEN_FILE', 32);
  const gatewayToken = secret(env, 'SOKOSUMI_GATEWAY_SEARCH_TOKEN', 'SOKOSUMI_GATEWAY_SEARCH_TOKEN_FILE', 1);
  const port = Number(env.PORT ?? '8787');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new SokosumiConfigError('PORT must be a valid TCP port');
  return {
    databaseUrl, databaseSchema, gatewayUrl: `http://127.0.0.1:${port}`,
    identity: { owner: required(env, 'SOKOSUMI_CUSTOMER_ID'), token: authToken, gatewayToken }, masumi,
  };
}
