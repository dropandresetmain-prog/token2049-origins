import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadHostedMcpConfig } from '../../src/channels/hosted-mcp/config.js';
import { parseSolanaConfig, trustedFacilitator } from '../../src/funding/solana/config.js';
import { facilitatorRequestAllowed } from '../../clients/solana/facilitator.js';
import { hostedSolanaConfig } from '../../clients/solana/hosted.js';
import { scenario } from '../support/solana.js';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));
const temp = () => { const dir = mkdtempSync(join(tmpdir(), 'hosted-solana-')); dirs.push(dir); return dir; };

describe('hosted Solana boundaries', () => {
  it('retains the local private-facilitator allowlist for legacy mode', async () => {
    const s = await scenario(), origin = 'http://t2o-solana-payer:8790';
    expect(trustedFacilitator(origin)).toBe(false);
    expect(parseSolanaConfig({ ...s.env, SOLANA_FACILITATOR_URL: origin, SOLANA_FACILITATOR_TRUSTED_PRIVATE_ORIGIN: origin }).ok).toBe(true);
    for (const url of ['http://other:8790', 'http://t2o-solana-payer:8791', 'http://10.1.1.1:8790', 'http://payer.example.com:8790', origin + '/prepare', origin + '?', origin + '#', 'http://user@t2o-solana-payer:8790']) {
      expect(trustedFacilitator(url, undefined, origin), url).toBe(false);
    }
  });

  it('keeps the legacy facilitator listener restricted to the private peer, exact Host and no Origin', () => {
    const access = { allowedHosts: ['t2o-solana-payer.onrender.com'] };
    expect(facilitatorRequestAllowed('10.2.3.4', 't2o-solana-payer.onrender.com', undefined, access)).toBe(true);
    for (const [peer, host, origin] of [
      ['8.8.8.8', 't2o-solana-payer.onrender.com', undefined],
      ['10.2.3.4', 'evil.example', undefined],
      ['10.2.3.4', 't2o-solana-payer.onrender.com', 'null'],
    ]) expect(facilitatorRequestAllowed(peer, host, origin, access)).toBe(false);
  });

  it('accepts a public HTTPS Solana bridge and local loopback development URL', () => {
    const dir = temp(), pass = join(dir, 'pass'), cardanoToken = join(dir, 'cardano-token'), solanaToken = join(dir, 'solana-token');
    writeFileSync(pass, 'owner-passcode-01234567890');
    writeFileSync(cardanoToken, 'cardano-bridge-token-012345678901');
    writeFileSync(solanaToken, 'solana-bridge-token-012345678901');
    const env = {
      MCP_HOSTED_ENABLED: 'true', MCP_PUBLIC_URL: 'https://capsule.example', PUBLIC_BASE_URL: 'https://capsule.example', PORT: '8787',
      MCP_OAUTH_OWNER_PASSCODE_FILE: pass,
      CARDANO_PAYER_BRIDGE_URL: 'https://cardano-payer.example', CARDANO_PAYER_BRIDGE_TOKEN_FILE: cardanoToken,
      SOLANA_PAYER_BRIDGE_URL: 'https://solana-payer.example', SOLANA_PAYER_BRIDGE_TOKEN_FILE: solanaToken,
      MCP_PAYER_GATEWAY_TOKEN_SHA256: 'a'.repeat(64), MCP_SOLANA_PAYER_GATEWAY_TOKEN_SHA256: 'b'.repeat(64),
    };

    expect(loadHostedMcpConfig(env)).toMatchObject({
      cardanoBridge: { url: 'https://cardano-payer.example' },
      solanaBridge: { url: 'https://solana-payer.example' },
      solanaPayerClientId: 'cli_HOSTEDSOLANAPAYER',
    });
    expect(loadHostedMcpConfig({ ...env, SOLANA_PAYER_BRIDGE_URL: 'http://127.0.0.1:8789' })?.solanaBridge?.url).toBe('http://127.0.0.1:8789');
    expect(() => loadHostedMcpConfig({ ...env, SOLANA_PAYER_BRIDGE_URL: 'http://solana-payer.example' })).toThrow(/https origin/);
    expect(() => loadHostedMcpConfig({ ...env, SOLANA_PAYER_BRIDGE_URL: env.MCP_PUBLIC_URL })).toThrow(/different service/);
    expect(() => loadHostedMcpConfig({ ...env, SOLANA_PAYER_BRIDGE_TOKEN_FILE: cardanoToken })).toThrow(/distinct/);
    expect(() => loadHostedMcpConfig({ ...env, MCP_SOLANA_PAYER_GATEWAY_TOKEN_SHA256: env.MCP_PAYER_GATEWAY_TOKEN_SHA256 })).toThrow(/distinct/);
  });

  it('requires payer-broadcast mode, a public HTTPS gateway and safe signer identities without local ledger files', async () => {
    const s = await scenario(), dir = temp(), payerToken = join(dir, 'payer-token'), gatewayToken = join(dir, 'gateway-token');
    writeFileSync(payerToken, 'solana-payer-token-0123456789012345');
    writeFileSync(gatewayToken, 'solana-gateway-token-0123456789012345');
    const t = s.transfer;
    const env = {
      ...s.env,
      SOLANA_SETTLEMENT_MODE: 'payer_broadcast',
      SOLANA_PAYER_RPC_URL: s.env.SOLANA_RPC_URL,
      SOLANA_PAYER_ADDRESS: t.payer,
      SOLANA_PAYER_TOKEN_ACCOUNT: t.source,
      SOLANA_PAYER_KEY_FILE: 'payer-key-file-placeholder',
      SOLANA_SPONSOR_KEY_FILE: 'sponsor-key-file-placeholder',
      SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS: '10000',
      SOLANA_PAYER_MAX_TOTAL_BASE_UNITS: '10000',
      SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR: '1000',
      SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS: '100000',
      SOLANA_GATEWAY_URL: 'https://capsule.example',
      SOLANA_GATEWAY_TOKEN_FILE: gatewayToken,
      SOLANA_PAYER_BRIDGE_TOKEN_FILE: payerToken,
      SOLANA_PAYER_BRIDGE_ALLOWED_HOSTS: 'solana-payer.example.com',
      PORT: '10000',
      // No ledger-directory or persistent-disk configuration is needed for the PostgreSQL ledger.
    } as NodeJS.ProcessEnv;

    const hosted = hostedSolanaConfig(env);
    expect(hosted).toMatchObject({ port: 10000, hosts: ['solana-payer.example.com'], token: 'solana-payer-token-0123456789012345' });
    expect(hosted.cfg.settlementMode).toBe('payer_broadcast');
    expect(Object.hasOwn(env, 'SOLANA_LEDGER_DIRECTORY')).toBe(false);

    expect(() => hostedSolanaConfig({ ...env, SOLANA_SETTLEMENT_MODE: 'facilitator' })).toThrow(/payer_broadcast/);
    expect(() => hostedSolanaConfig({ ...env, SOLANA_GATEWAY_URL: 'http://gateway.example' })).toThrow(/gateway origin/);
    expect(() => hostedSolanaConfig({ ...env, SOLANA_GATEWAY_URL: 'http://127.0.0.1:8787' })).toThrow(/gateway origin/);
    expect(() => hostedSolanaConfig({ ...env, SOLANA_PAYER_BRIDGE_TOKEN_FILE: gatewayToken })).toThrow(/distinct/);
    expect(() => hostedSolanaConfig({ ...env, SOLANA_PAYER_ADDRESS: env.SOLANA_TREASURY_ADDRESS })).toThrow(/distinct/);
    expect(() => hostedSolanaConfig({ ...env, SOLANA_PAYER_ADDRESS: env.SOLANA_FEE_PAYER_ADDRESS })).toThrow();

    // The existing public sponsor owner may also be the treasury owner; the payer must remain separate.
    const sharedSponsorTreasury = hostedSolanaConfig({ ...env, SOLANA_FEE_PAYER_ADDRESS: env.SOLANA_TREASURY_ADDRESS });
    expect(sharedSponsorTreasury.cfg.sponsor).toBe(sharedSponsorTreasury.cfg.payee);
  });
});
