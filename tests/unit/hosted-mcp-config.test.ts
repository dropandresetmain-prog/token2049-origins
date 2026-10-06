import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostedConfigError, loadHostedMcpConfig, parsePrivateBridgeUrl, parsePublicOrigin } from '../../src/channels/hosted-mcp/config.js';
import { hostAllowed, originAllowed } from '../../src/channels/hosted-mcp/router.js';
import { INSTRUCTIONS } from '../../src/channels/mcp/server.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const PUBLIC = 'https://token2049-origins.onrender.com';

function env(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'hosted-cfg-')); roots.push(root);
  const pass = join(root, 'pass'); const bridge = join(root, 'bridge');
  writeFileSync(pass, 'owner-passcode-0123456789\n'); writeFileSync(bridge, 'bridge-token-0123456789-abcdef\n');
  return { MCP_HOSTED_ENABLED: 'true', MCP_PUBLIC_URL: PUBLIC, PUBLIC_BASE_URL: PUBLIC, PORT: '8787', MCP_OAUTH_OWNER_PASSCODE_FILE: pass,
    CARDANO_PAYER_BRIDGE_URL: 'http://t2o-cardano-payer:8788', CARDANO_PAYER_BRIDGE_TOKEN_FILE: bridge, ...over } as NodeJS.ProcessEnv;
}

describe('hosted MCP configuration', () => {
  it('is off unless explicitly enabled', () => {
    expect(loadHostedMcpConfig({ PUBLIC_BASE_URL: PUBLIC })).toBeNull();
    expect(loadHostedMcpConfig(env({ MCP_HOSTED_ENABLED: 'yes' }))).toBeNull();
  });

  it('loads the production shape: one public origin, private Cardano bridge, loopback gateway', () => {
    const c = loadHostedMcpConfig(env())!;
    expect(c.publicUrl.origin).toBe(PUBLIC);
    expect(c.cardanoBridge).toMatchObject({ url: 'http://t2o-cardano-payer:8788' });
    expect(c.gatewayUrl).toBe('http://127.0.0.1:8787');
    expect(Object.keys(c)).not.toContain('gatewayToken'); // no shared gateway key exists in hosted mode
  });

  it.each([
    ['http public origin', { MCP_PUBLIC_URL: 'http://token2049-origins.onrender.com', PUBLIC_BASE_URL: 'http://token2049-origins.onrender.com' }],
    ['public origin with a path', { MCP_PUBLIC_URL: `${PUBLIC}/mcp` }],
    ['mismatched PUBLIC_BASE_URL', { PUBLIC_BASE_URL: 'https://other.example' }],
    ['missing PUBLIC_BASE_URL', { PUBLIC_BASE_URL: undefined }],
    ['credentials in the origin', { MCP_PUBLIC_URL: 'https://user:pw@token2049-origins.onrender.com' }],
    ['a Solana bridge', { SOLANA_PAYER_BRIDGE_URL: 'http://127.0.0.1:9', SOLANA_PAYER_BRIDGE_TOKEN_FILE: 'x' }],
    ['a half-configured Cardano bridge', { CARDANO_PAYER_BRIDGE_TOKEN_FILE: undefined }],
    ['a public bridge host', { CARDANO_PAYER_BRIDGE_URL: 'https://payer.example.com' }],
    ['a bridge with credentials', { CARDANO_PAYER_BRIDGE_URL: 'http://user:pw@t2o-cardano-payer:8788' }],
    ['a bridge with a path', { CARDANO_PAYER_BRIDGE_URL: 'http://t2o-cardano-payer:8788/pay' }],
    ['a missing passcode file', { MCP_OAUTH_OWNER_PASSCODE_FILE: '/nonexistent/passcode' }],
    ['a non-https extra redirect', { MCP_OAUTH_EXTRA_REDIRECT_URIS: 'http://evil.example/cb' }],
    ['a path-bearing allowed origin', { MCP_ALLOWED_ORIGINS: 'https://x.example/path' }],
  ])('refuses %s', (_name, over) => {
    expect(() => loadHostedMcpConfig(env(over))).toThrow(HostedConfigError);
  });

  it('refuses a short owner passcode and never echoes secrets in errors', () => {
    const root = mkdtempSync(join(tmpdir(), 'hosted-short-')); roots.push(root);
    const short = join(root, 'short'); writeFileSync(short, 'tooshort');
    try { loadHostedMcpConfig(env({ MCP_OAUTH_OWNER_PASSCODE_FILE: short })); throw new Error('should have thrown'); }
    catch (e) { expect((e as Error).message).not.toContain('tooshort'); expect(e).toBeInstanceOf(HostedConfigError); }
  });

  it('accepts bridge hosts only as single-label private names or loopback', () => {
    expect(parsePrivateBridgeUrl('http://t2o-cardano-payer:8788', 'x')).toBe('http://t2o-cardano-payer:8788');
    expect(parsePrivateBridgeUrl('http://127.0.0.1:8788', 'x')).toBe('http://127.0.0.1:8788');
    for (const bad of ['http://10.0.0.5:8788', 'http://payer.internal:8788', 'http://169.254.169.254', 'ftp://t2o-cardano-payer']) expect(() => parsePrivateBridgeUrl(bad, 'x'), bad).toThrow(HostedConfigError);
    expect(parsePublicOrigin(PUBLIC + '/', 'x').origin).toBe(PUBLIC);
  });
});

describe('production host and origin rules', () => {
  const pub = new URL(PUBLIC);
  it('accepts exactly the configured public host', () => {
    expect(hostAllowed('token2049-origins.onrender.com', pub)).toBe(true);
    expect(hostAllowed('TOKEN2049-ORIGINS.ONRENDER.COM', pub)).toBe(true);
    for (const h of [undefined, '', 'token2049-origins.onrender.com:444', 'token2049-origins.onrender.com.evil.example', 'evil.example', '127.0.0.1', 'localhost', 'onrender.com']) expect(hostAllowed(h, pub), String(h)).toBe(false);
  });
  it('accepts no Origin, the public origin, or an explicit allowlist entry only', () => {
    const allowed = ['https://chatgpt.com'];
    expect(originAllowed(undefined, pub, allowed)).toBe(true);
    expect(originAllowed(PUBLIC, pub, allowed)).toBe(true);
    expect(originAllowed('https://chatgpt.com', pub, allowed)).toBe(true);
    for (const o of ['null', 'http://token2049-origins.onrender.com', 'https://evil.example', 'https://chatgpt.com.evil.example', 'http://127.0.0.1:8787', '']) expect(originAllowed(o, pub, allowed), o).toBe(false);
  });
});

describe('shopping-behaviour instructions', () => {
  it('requires a top-3 shortlist with one Recommended option and an explicit user choice before create_quote', () => {
    expect(INSTRUCTIONS).toMatch(/best 3 viable options/);
    expect(INSTRUCTIONS).toMatch(/exactly ONE as "Recommended"/);
    expect(INSTRUCTIONS).toMatch(/ask the user which one they want/);
    expect(INSTRUCTIONS).toMatch(/never call create_quote on your own initiative/);
    expect(INSTRUCTIONS).toMatch(/call create_quote only after the user chose an offer/i);
  });
  it('requires explicit rail selection and approval before buy, with no inference or fallback', () => {
    expect(INSTRUCTIONS).toMatch(/explicitly select a payment rail/);
    expect(INSTRUCTIONS).toMatch(/explicitly approve the exact quote/);
    expect(INSTRUCTIONS).toMatch(/never default to one, never fall back to another rail/);
    expect(INSTRUCTIONS).toMatch(/Call buy only after both/);
  });
  it('does not hardcode any merchant or product as the recommendation', () => {
    expect(INSTRUCTIONS).not.toMatch(/EPICKA|adapter|travel/i);
  });
  it('forbids claiming confirmation before the purchase proves success', () => {
    expect(INSTRUCTIONS).toMatch(/Never tell the user a purchase is complete unless/);
    expect(INSTRUCTIONS).toMatch(/returns orderConfirmation/);
  });
});
