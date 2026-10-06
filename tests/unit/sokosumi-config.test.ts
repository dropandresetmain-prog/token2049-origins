import { describe, expect, it } from 'vitest';
import { loadSokosumiMarketplaceConfig, SokosumiConfigError } from '../../src/channels/sokosumi/config.js';
import { TUSDM } from '../../src/integrations/masumi/client.js';

const base = (): NodeJS.ProcessEnv => ({
  SOKOSUMI_MARKETPLACE_ENABLED: 'true', SOKOSUMI_DATABASE_URL: 'postgres://capsule:secret@db.example.com/capsule',
  SOKOSUMI_DATABASE_SCHEMA: 'sokosumi_marketplace_test', MASUMI_NETWORK: 'preprod',
  MASUMI_PAYMENT_SERVICE_URL: 'https://mps.example.com', MASUMI_PAYMENT_API_KEY: 'm'.repeat(32),
  MASUMI_AGENT_ID: 'agent-public-id', MASUMI_SELLER_VKEY: 'seller-public-vkey', MASUMI_SELLER_ADDRESS: 'addr_test1seller',
  MASUMI_CONTRACT_ADDRESS: 'addr_test1contract', MASUMI_PAYMENT_ASSET_UNIT: TUSDM,
  MASUMI_SERVICE_FEE_BASE_UNITS: '10000', MASUMI_BLOCKFROST_PROJECT_ID: 'blockfrost-test-key',
  MASUMI_CHANNEL_AUTH_TOKEN: 'a'.repeat(32), SOKOSUMI_GATEWAY_SEARCH_TOKEN: 'gateway-search-token', SOKOSUMI_CUSTOMER_ID: 'cus_capsule', PORT: '8787',
});

describe('Sokosumi marketplace configuration', () => {
  it('stays disabled by default', () => expect(loadSokosumiMarketplaceConfig({})).toBeNull());
  it('requires an isolated schema and remotely reachable HTTPS Masumi service', () => {
    expect(() => loadSokosumiMarketplaceConfig({ ...base(), SOKOSUMI_DATABASE_SCHEMA: 'public' })).toThrow(SokosumiConfigError);
    expect(() => loadSokosumiMarketplaceConfig({ ...base(), SOKOSUMI_DATABASE_SCHEMA: 'shared_core' })).toThrow(SokosumiConfigError);
    expect(() => loadSokosumiMarketplaceConfig({ ...base(), DATABASE_SCHEMA: 'sokosumi_marketplace_test' })).toThrow(SokosumiConfigError);
    expect(() => loadSokosumiMarketplaceConfig({ ...base(), SOKOSUMI_DATABASE_SCHEMA: 'masumi_historical' })).toThrow(SokosumiConfigError);
    expect(() => loadSokosumiMarketplaceConfig({ ...base(), MASUMI_PAYMENT_SERVICE_URL: 'http://127.0.0.1:3012' })).toThrow(SokosumiConfigError);
  });
  it('rejects alternate network and payment assets before enabling ingress', () => {
    expect(() => loadSokosumiMarketplaceConfig({ ...base(), MASUMI_NETWORK: 'mainnet' })).toThrow(SokosumiConfigError);
    expect(() => loadSokosumiMarketplaceConfig({ ...base(), MASUMI_PAYMENT_ASSET_UNIT: '1'.repeat(56) })).toThrow(SokosumiConfigError);
  });
  it('requires a dedicated search token and never falls back to the gateway-wide credential', () => {
    const env: NodeJS.ProcessEnv = { ...base(), GATEWAY_API_TOKEN: 'g'.repeat(64) };
    delete env.SOKOSUMI_GATEWAY_SEARCH_TOKEN;
    expect(() => loadSokosumiMarketplaceConfig(env)).toThrow(/SOKOSUMI_GATEWAY_SEARCH_TOKEN/);
  });
});
