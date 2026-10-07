import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
// The provisioners are JavaScript CLIs and intentionally have no declaration files.
// @ts-expect-error JavaScript CLI helper import is exercised at runtime by Vitest.
import { applyPayer, configureRenderAccess, lookupPayer } from '../../scripts/provision-hosted-mcp-render.mjs';
// @ts-expect-error JavaScript CLI helper import is exercised at runtime by Vitest.
import { solanaProvisionPlan } from '../../scripts/provision-hosted-solana-render.mjs';

const gatewayToken = 'solana-gateway-token-test-only';
const bridgeToken = 'solana-bridge-token-test-only';
const payerHistoryHash = '1'.repeat(64);
const sponsorHistoryHash = '2'.repeat(64);
const payerHistoryText = 'synthetic-payer-ledger-history';
const sponsorHistoryText = 'synthetic-sponsor-ledger-history';
const databaseUrl = 'postgres://gateway:db-test-only@db.example/gateway';
const web = { id: 'srv-gateway', ownerId: 'owner-test', repo: 'https://example.test/repo.git', branch: 'main', region: 'singapore', url: 'https://token2049-origins.onrender.com', databaseUrl };
const payerUrl = 'https://t2o-solana-payer.onrender.com';
const tokens = { gateway: gatewayToken, bridge: bridgeToken };

const policy = {
  SOLANA_NETWORK: 'devnet',
  SOLANA_RPC_URL: 'https://api.devnet.solana.com',
  SOLANA_PAYER_RPC_URL: 'https://api.devnet.solana.com',
  SOLANA_USDC_MINT: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
  SOLANA_ASSET_DECIMALS: '6',
  SOLANA_TREASURY_ADDRESS: 'treasury-address',
  SOLANA_TREASURY_TOKEN_ACCOUNT: 'treasury-token-account',
  SOLANA_FEE_PAYER_ADDRESS: 'sponsor-address',
  SOLANA_PAYER_ADDRESS: 'payer-address',
  SOLANA_PAYER_TOKEN_ACCOUNT: 'payer-token-account',
  SOLANA_MAX_PAYMENT_BASE_UNITS: '10000',
  SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS: '10000',
  SOLANA_PAYER_MAX_TOTAL_BASE_UNITS: '100000',
  SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR: '10000',
  SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS: '100000',
};
const histories = [
  { text: payerHistoryText, expectedSha256: payerHistoryHash },
  { text: sponsorHistoryText, expectedSha256: sponsorHistoryHash },
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hosted Solana Render plan', () => {
  it('targets the public HTTPS free payer and keeps signer/history secrets off the gateway env', () => {
    const plan = solanaProvisionPlan(policy, histories, web, payerUrl, tokens);

    for (const [key, value] of Object.entries(policy)) expect(plan.payer.get(key), key).toBe(value);
    expect(plan.gateway.get('SOLANA_PAYER_BRIDGE_URL')).toBe(payerUrl);
    expect(new URL(plan.gateway.get('SOLANA_PAYER_BRIDGE_URL')!).protocol).toBe('https:');
    expect(plan.gateway.get('SOLANA_PAYER_BRIDGE_TOKEN_FILE')).toBe('/etc/secrets/solana-payer-bridge-token');
    expect(plan.gateway.get('MCP_SOLANA_PAYER_GATEWAY_TOKEN_SHA256')).toBe(createHash('sha256').update(gatewayToken).digest('hex'));
    expect(plan.gateway.get('MCP_SOLANA_PAYER_GATEWAY_TOKEN_SHA256')).not.toBe(createHash('sha256').update('cardano-gateway-token').digest('hex'));

    expect(plan.gateway.has('DATABASE_URL')).toBe(false);
    expect(plan.payer.get('DATABASE_URL')).toBe(databaseUrl);
    for (const map of [plan.gateway, plan.payer]) {
      for (const [key, value] of map) {
        expect(value).not.toContain(gatewayToken);
        expect(value).not.toContain(bridgeToken);
        expect(value).not.toContain(payerHistoryText);
        expect(value).not.toContain(sponsorHistoryText);
        expect(value).not.toMatch(/BEGIN (?:OPENSSH |ED25519 )?PRIVATE KEY/);
        if (key === 'DATABASE_URL') expect(map).toBe(plan.payer);
      }
    }

    for (const key of ['SOLANA_PAYER_KEY_FILE', 'SOLANA_SPONSOR_KEY_FILE', 'SOLANA_LEGACY_PAYER_LEDGER_FILE', 'SOLANA_LEGACY_SPONSOR_LEDGER_FILE']) {
      expect(plan.gateway.has(key), key).toBe(false);
    }
    expect(plan.payer.get('SOLANA_PAYER_KEY_FILE')).toBe('/etc/secrets/solana-payer-key');
    expect(plan.payer.get('SOLANA_SPONSOR_KEY_FILE')).toBe('/etc/secrets/solana-sponsor-key');
    expect(plan.payer.get('SOLANA_LEGACY_SIGNERS_RETIRED')).toBe('true');
    expect(plan.payer.get('SOLANA_LEGACY_PAYER_LEDGER_SHA256')).toBe(payerHistoryHash);
    expect(plan.payer.get('SOLANA_LEGACY_SPONSOR_LEDGER_SHA256')).toBe(sponsorHistoryHash);

    for (const map of [plan.gateway, plan.payer]) {
      expect([...map.keys()].some(key => /FACILITATOR|LEDGER_DIRECTORY|SOLANA_LEDGER_FILE/.test(key))).toBe(false);
    }
  });

  it('fails closed when a required payer policy field is missing', () => {
    const missing = { ...policy };
    delete (missing as Partial<typeof policy>).SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS;
    expect(() => solanaProvisionPlan(missing, histories, web, payerUrl, tokens)).toThrow('missing policy field: SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS');
  });

  it('creates only a free public Docker web service on the requested branch and Dockerfile', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ service: { id: 'srv-solana', serviceDetails: { url: payerUrl } } }), { status: 201 });
    }));
    configureRenderAccess({ key: 'test-render-key', dryRun: false, base: 'https://render.invalid/v1' });

    const service = await applyPayer({ payerName: 't2o-solana-payer', branch: 'feat/hosted-commerce-completion', dockerfile: './Dockerfile.solana' }, web, null, false);
    const requestBody = JSON.parse(String(calls[0]?.init?.body));
    expect(service).toEqual({ id: 'srv-solana', url: payerUrl });
    expect(new URL(service!.url).protocol).toBe('https:');
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://render.invalid/v1/services');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(requestBody).toMatchObject({
      type: 'web_service', name: 't2o-solana-payer', branch: 'feat/hosted-commerce-completion', autoDeployTrigger: 'off',
      serviceDetails: { runtime: 'docker', plan: 'free', envSpecificDetails: { dockerfilePath: './Dockerfile.solana', dockerContext: '.' } },
    });
    expect(requestBody.serviceDetails.disk).toBeUndefined();
    expect(JSON.stringify(requestBody)).not.toMatch(/private_service|disk/);
  });

  it('refuses an existing payer service unless its Render plan is free', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([
      { service: { id: 'srv-paid', name: 't2o-solana-payer', type: 'web_service', serviceDetails: { plan: 'starter', url: payerUrl } }, cursor: 'next' },
    ]), { status: 200 })));
    configureRenderAccess({ key: 'test-render-key', dryRun: true, base: 'https://render.invalid/v1' });
    await expect(lookupPayer({ payerName: 't2o-solana-payer' }, web)).rejects.toThrow('not free; refusing to continue');
  });

  it('imports the Solana provisioner and its Cardano helper without running the CLI or making requests', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    // @ts-expect-error The query makes a fresh runtime import of the JavaScript CLI entrypoint.
    await import('../../scripts/provision-hosted-solana-render.mjs?inert-import-check');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
