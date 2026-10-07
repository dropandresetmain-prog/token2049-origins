import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HostedConfigError, loadHostedMcpConfig, parsePayerBridgeUrl, parsePublicOrigin } from '../../src/channels/hosted-mcp/config.js';
import { hostAllowed, originAllowed } from '../../src/channels/hosted-mcp/router.js';
import { INSTRUCTIONS } from '../../src/channels/mcp/server.js';

const roots: string[] = [];
afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
const PUBLIC = 'https://token2049-origins.onrender.com';
const PAYER = 'https://t2o-cardano-payer.onrender.com';

function env(over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  const root = mkdtempSync(join(tmpdir(), 'hosted-cfg-')); roots.push(root);
  const pass = join(root, 'pass'); const bridge = join(root, 'bridge');
  writeFileSync(pass, 'owner-passcode-0123456789\n'); writeFileSync(bridge, 'bridge-token-0123456789-abcdef\n');
  return { MCP_HOSTED_ENABLED: 'true', MCP_PUBLIC_URL: PUBLIC, PUBLIC_BASE_URL: PUBLIC, PORT: '8787', MCP_OAUTH_OWNER_PASSCODE_FILE: pass,
    CARDANO_PAYER_BRIDGE_URL: PAYER, CARDANO_PAYER_BRIDGE_TOKEN_FILE: bridge, ...over } as NodeJS.ProcessEnv;
}

describe('hosted MCP configuration', () => {
  it('is off unless explicitly enabled', () => {
    expect(loadHostedMcpConfig({ PUBLIC_BASE_URL: PUBLIC })).toBeNull();
    expect(loadHostedMcpConfig(env({ MCP_HOSTED_ENABLED: 'yes' }))).toBeNull();
  });

  it('loads the production shape: one public origin, one https free-service payer, loopback gateway', () => {
    const c = loadHostedMcpConfig(env())!;
    expect(c.publicUrl.origin).toBe(PUBLIC);
    expect(c.cardanoBridge).toMatchObject({ url: PAYER });
    expect(c.gatewayUrl).toBe('http://127.0.0.1:8787');
    expect(Object.keys(c)).not.toContain('gatewayToken'); // no shared gateway key exists in hosted mode
  });

  it.each([
    ['http public origin', { MCP_PUBLIC_URL: 'http://token2049-origins.onrender.com', PUBLIC_BASE_URL: 'http://token2049-origins.onrender.com' }],
    ['public origin with a path', { MCP_PUBLIC_URL: `${PUBLIC}/mcp` }],
    ['mismatched PUBLIC_BASE_URL', { PUBLIC_BASE_URL: 'https://other.example' }],
    ['missing PUBLIC_BASE_URL', { PUBLIC_BASE_URL: undefined }],
    ['credentials in the origin', { MCP_PUBLIC_URL: 'https://user:pw@token2049-origins.onrender.com' }],
    ['a half-configured Solana bridge', { SOLANA_PAYER_BRIDGE_URL: 'http://t2o-solana-payer:8789' }],
    ['a remote-http Solana bridge', { SOLANA_PAYER_BRIDGE_URL: 'http://payer.example.com', SOLANA_PAYER_BRIDGE_TOKEN_FILE: 'x' }],
    ['a half-configured Cardano bridge', { CARDANO_PAYER_BRIDGE_TOKEN_FILE: undefined }],
    ['a plain-http payer origin', { CARDANO_PAYER_BRIDGE_URL: 'http://t2o-cardano-payer.onrender.com' }],
    ['the gateway as its own payer', { CARDANO_PAYER_BRIDGE_URL: PUBLIC }],
    ['a payer with credentials', { CARDANO_PAYER_BRIDGE_URL: 'https://user:pw@t2o-cardano-payer.onrender.com' }],
    ['a payer with a path', { CARDANO_PAYER_BRIDGE_URL: `${PAYER}/pay` }],
    ['a payer with a query', { CARDANO_PAYER_BRIDGE_URL: `${PAYER}?x=1` }],
    ['a missing passcode file', { MCP_OAUTH_OWNER_PASSCODE_FILE: '/nonexistent/passcode' }],
    ['a malformed payer token hash', { MCP_PAYER_GATEWAY_TOKEN_SHA256: 'not-a-hash' }],
    ['a malformed console key hash', { MCP_CONSOLE_KEY_SHA256: 'nope' }],
    ['a non-https extra redirect', { MCP_OAUTH_EXTRA_REDIRECT_URIS: 'http://evil.example/cb' }],
    ['a path-bearing allowed origin', { MCP_ALLOWED_ORIGINS: 'https://x.example/path' }],
  ])('refuses %s', (_name, over) => {
    expect(() => loadHostedMcpConfig(env(over))).toThrow(HostedConfigError);
  });

  it('accepts a payer token hash (hash only, never the token)', () => {
    const h = 'a'.repeat(64);
    expect(loadHostedMcpConfig(env({ MCP_PAYER_GATEWAY_TOKEN_SHA256: h.toUpperCase() }))!.payerTokenSha256).toBe(h);
    expect(loadHostedMcpConfig(env())!.payerTokenSha256).toBeUndefined();
  });

  it('refuses a short owner passcode and never echoes secrets in errors', () => {
    const root = mkdtempSync(join(tmpdir(), 'hosted-short-')); roots.push(root);
    const short = join(root, 'short'); writeFileSync(short, 'tooshort');
    try { loadHostedMcpConfig(env({ MCP_OAUTH_OWNER_PASSCODE_FILE: short })); throw new Error('should have thrown'); }
    catch (e) { expect((e as Error).message).not.toContain('tooshort'); expect(e).toBeInstanceOf(HostedConfigError); }
  });

  it('accepts exactly one https payer origin (loopback http only for local development)', () => {
    expect(parsePayerBridgeUrl(`${PAYER}/`, 'x')).toBe(PAYER);
    expect(parsePayerBridgeUrl('http://127.0.0.1:8788', 'x')).toBe('http://127.0.0.1:8788');
    for (const bad of ['http://payer.example.com', 'ftp://payer.example.com', 'https://payer.example.com/pay', 'https://payer.example.com#frag', 'not a url']) expect(() => parsePayerBridgeUrl(bad, 'x'), bad).toThrow(HostedConfigError);
    expect(() => parsePayerBridgeUrl(PUBLIC, 'x', PUBLIC)).toThrow(HostedConfigError);
    expect(parsePublicOrigin(PUBLIC + '/', 'x').origin).toBe(PUBLIC);
  });

  it('accepts a public HTTPS Solana bridge and a loopback HTTP development bridge', () => {
    const root = mkdtempSync(join(tmpdir(), 'hosted-solana-bridge-')); roots.push(root);
    const tokenFile = join(root, 'bridge-token');
    writeFileSync(tokenFile, 'solana-bridge-token-0123456789-abcdef');
    const base = { SOLANA_PAYER_BRIDGE_TOKEN_FILE: tokenFile };
    expect(loadHostedMcpConfig(env({ ...base, SOLANA_PAYER_BRIDGE_URL: 'https://solana-payer.onrender.com' }))!.solanaBridge?.url)
      .toBe('https://solana-payer.onrender.com');
    expect(loadHostedMcpConfig(env({ ...base, SOLANA_PAYER_BRIDGE_URL: 'http://127.0.0.1:8789' }))!.solanaBridge?.url)
      .toBe('http://127.0.0.1:8789');
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

describe('public demo console configuration',()=>{
 it('requires an explicit valid opt-in',()=>{
  expect(loadHostedMcpConfig(env())?.publicConsoleReadOnly).toBeUndefined();
  expect(loadHostedMcpConfig(env({MCP_PUBLIC_CONSOLE_READ_ONLY:'false'}))?.publicConsoleReadOnly).toBeUndefined();
  expect(loadHostedMcpConfig(env({MCP_PUBLIC_CONSOLE_READ_ONLY:'true'}))?.publicConsoleReadOnly).toBe(true);
  expect(()=>loadHostedMcpConfig(env({MCP_PUBLIC_CONSOLE_READ_ONLY:'yes'}))).toThrow(/must be true or false/);
 });
});
