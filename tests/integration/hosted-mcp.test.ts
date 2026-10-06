import { describe, it, expect, afterEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHarness, retailIntent, retailFulfillment, type Harness } from '../support/harness.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { createHostedMcp, provisionPayerClient } from '../../src/channels/hosted-mcp/router.js';
import { sha256Hex } from '../../src/infrastructure/ids.js';
import type { HostedMcpConfig } from '../../src/channels/hosted-mcp/config.js';
import { FundingSource, SOLANA_DEVNET_NETWORK, SOLANA_DEVNET_USDC_MINT } from '../../src/contracts/presentation.js';
import { FixtureFundingAdapter } from '../support/fixtures.js';
import { createMcpServer } from '../../src/channels/mcp/server.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { FundingAdapter } from '../../src/contracts/ports.js';

const PASSCODE = 'owner-passcode-0123456789';
const BRIDGE_TOKEN = 'hosted-bridge-secret-0123456789';
const CHATGPT_REDIRECT = 'https://chatgpt.com/connector_platform_oauth_redirect';
const PAYER_ADDRESS = 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2xt3uqxgjqnnj83ws8lhrn648jjxtwq2ytjqp';

const freePort = () => new Promise<number>((resolve) => {
  const s = createNetServer();
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)); });
});
const b64url = (b: Buffer) => b.toString('base64url');
const pkce = () => { const verifier = b64url(randomBytes(32)); return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }; };

interface Fixture { h: Harness; base: string; mcpUrl: string; cleanup: Array<() => Promise<void>>; bridge?: { calls: string[] }; bridgeUrl?: string }

let current: Fixture | undefined;
afterEach(async () => {
  for (const c of current?.cleanup ?? []) await c();
  await current?.h.close();
  current = undefined;
});

const SOLANA_PAYEE = 'So11111111111111111111111111111111111111112';
/** Fixture Solana rail so quotes carry both Cardano and Solana funding options. */
function solanaFixtureAdapter(h: Harness): FundingAdapter {
  const fixture = new FixtureFundingAdapter(h.clock);
  return {
    rail: 'solana', network: SOLANA_DEVNET_NETWORK, paymentHeaderName: 'payment-signature',
    acceptedAsset: () => ({ assetId: SOLANA_DEVNET_USDC_MINT, decimals: 6, symbol: 'Devnet test USDC', payTo: SOLANA_PAYEE, supportsUsdNotional: true }),
    readiness: () => fixture.readiness(),
    paymentRequirements: (r) => fixture.paymentRequirements(r),
    verify: async (header, r) => fixture.verify(header, r),
  };
}

/** Real executors report a type-specific proof status; make the retail fixture report Shopify's ("paid"). */
function retailReportsPaid(h: Harness): void {
  const exec = h.retail.execute.bind(h.retail);
  const retrieve = h.retail.retrieve.bind(h.retail);
  h.retail.execute = async (ctx) => { const r = await exec(ctx); return r.kind === 'succeeded' ? { ...r, commerceStatus: 'paid' } : r; };
  h.retail.retrieve = async (ctx) => { const r = await retrieve(ctx); return r.kind === 'succeeded' ? { ...r, commerceStatus: 'paid' } : r; };
}

/** Gateway + hosted MCP on one listener, with an optional fake Cardano payer on the "private network". */
async function start(opts: { withBridge?: boolean; allowedOrigins?: string[]; withSolana?: boolean; statusDelayMs?: number; headroomBaseUnits?: string; backgroundWaitMs?: number; payStartDelayMs?: number; payResponseDelayMs?: number; bridgeTimeoutMs?: number; bridgeStatusTimeoutMs?: number } = {}): Promise<Fixture> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const cleanup: Array<() => Promise<void>> = [];
  let bridgeUrl: string | undefined;
  const bridge = { calls: [] as string[] };
  // The fake bridge pays through the gateway fixture rail using a payer-scoped token of the hosted customer.
  let payerToken = '';
  let h: Harness;
  if (opts.withBridge) {
    const server: Server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', async () => {
        const send = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
        if (req.url === '/health') return send(200, { ok: true });
        if (req.headers.authorization !== `Bearer ${BRIDGE_TOKEN}`) return send(401, { ok: false, error: { code: 'unauthenticated', message: 'bad token' } });
        if (req.url === '/status') await new Promise((r) => setTimeout(r, opts.statusDelayMs ?? 0)); // a free payer waking from sleep
        if (req.url === '/status') return send(200, { ok: true, source: FundingSource.parse({ sourceId: 'src_' + 'a'.repeat(32), rail: 'cardano', network: 'cardano:preprod', publicAddress: PAYER_ADDRESS, displayAddress: PAYER_ADDRESS.slice(0, 14) + '…' + PAYER_ADDRESS.slice(-6), assetId: h.funding.acceptedAsset().assetId, readiness: 'configured' }), ...(opts.headroomBaseUnits ? { ledger: { headroomBaseUnits: opts.headroomBaseUnits, committedBaseUnits: '66830' } } : {}) });
        const { purchaseId } = JSON.parse(raw) as { purchaseId: string };
        bridge.calls.push(purchaseId);
        await new Promise((r) => setTimeout(r, opts.payStartDelayMs ?? 0)); // slow wake-up / signing before anything is paid
        const got = await h.call('GET', `/v1/purchases/${purchaseId}`, { token: payerToken });
        const amount = got.body.purchase.fundingRequirement.amount.amountBaseUnits as string;
        const fund = await h.call('POST', `/v1/purchases/${purchaseId}/fund`, { token: payerToken, headers: { 'payment-signature': `fixture:hosted-${purchaseId}:${amount}` } });
        if (fund.status !== 202) return send(502, { ok: false, error: { code: fund.body.error.code, message: fund.body.error.message } });
        await new Promise((r) => setTimeout(r, opts.payResponseDelayMs ?? 0)); // payment is durable even if the reply is slow
        send(200, { ok: true, payment: { transferReference: `hosted-${purchaseId}` } });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    bridgeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    cleanup.push(() => new Promise<void>((r) => server.close(() => r())));
  }
  const config: HostedMcpConfig = {
    publicUrl: new URL(base), allowedOrigins: opts.allowedOrigins ?? ['https://chatgpt.com'], ownerPasscode: PASSCODE,
    customerId: 'cus_HOSTEDTESTDEMO', apiClientId: 'cli_HOSTEDTESTDEMO', payerClientId: 'cli_HOSTEDTESTPAYER', extraRedirectUris: [], gatewayUrl: base,
    ...(opts.bridgeTimeoutMs ? { bridgeTimeoutMs: opts.bridgeTimeoutMs } : {}), ...(opts.backgroundWaitMs ? { backgroundWaitMs: opts.backgroundWaitMs } : {}), ...(opts.bridgeStatusTimeoutMs ? { bridgeStatusTimeoutMs: opts.bridgeStatusTimeoutMs } : {}),
    ...(bridgeUrl ? { cardanoBridge: { url: bridgeUrl, token: BRIDGE_TOKEN } } : {}),
  };
  h = await startHarness({ port, extraRouters: (core) => createHostedMcp({ db: core.deps.db, config }).mounts });
  if (opts.withSolana) h.gw.core.deps.fundingAdapters.set('solana', solanaFixtureAdapter(h));
  payerToken = (await createClient(h.gw.db, { customerId: config.customerId, displayName: 'payer', channel: 'test', label: 'hosted-payer', scopes: ['purchases:read', 'purchases:fund'] }, new Date().toISOString())).token;
  return (current = { h, base, mcpUrl: `${base}/mcp`, cleanup, bridge, ...(bridgeUrl ? { bridgeUrl } : {}) });
}

/** Run the whole OAuth dance the way ChatGPT does and return the tokens. */
async function connect(f: Fixture, over: { passcode?: string; resource?: string; scope?: string } = {}) {
  const reg = await fetch(`${f.base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'ChatGPT', redirect_uris: [CHATGPT_REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
  expect(reg.status).toBe(201);
  const client = (await reg.json()) as { client_id: string };
  const { verifier, challenge } = pkce();
  const q = new URLSearchParams({ response_type: 'code', client_id: client.client_id, redirect_uri: CHATGPT_REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 'st-1', resource: over.resource ?? f.mcpUrl, ...(over.scope ? { scope: over.scope } : {}) });
  const page = await fetch(`${f.base}/authorize?${q}`, { redirect: 'manual' });
  const html = page.status === 200 ? await page.text() : '';
  const requestId = /name="request_id" value="([^"]+)"/.exec(html)?.[1];
  return { client, verifier, requestId, page, html, approve: (passcode = over.passcode ?? PASSCODE) => fetch(`${f.base}/oauth/consent`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request_id: requestId ?? '', passcode, decision: 'approve' }) }) };
}

async function token(f: Fixture, client: { client_id: string }, params: Record<string, string>) {
  return fetch(`${f.base}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.client_id, ...params }) });
}

async function fullGrant(f: Fixture) {
  const c = await connect(f);
  const consent = await c.approve();
  expect(consent.status).toBe(302);
  const loc = new URL(consent.headers.get('location')!);
  const res = await token(f, c.client, { grant_type: 'authorization_code', code: loc.searchParams.get('code')!, code_verifier: c.verifier, redirect_uri: CHATGPT_REDIRECT, resource: f.mcpUrl });
  expect(res.status).toBe(200);
  return { ...c, tokens: (await res.json()) as { access_token: string; refresh_token: string; scope: string; expires_in: number }, loc };
}

async function mcp(f: Fixture, accessToken: string) {
  const client = new Client({ name: 'chatgpt-test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(f.mcpUrl), { requestInit: { headers: { authorization: `Bearer ${accessToken}` } } }));
  return client;
}

const rpc = (f: Fixture, headers: Record<string, string> = {}, body: unknown = { jsonrpc: '2.0', id: 1, method: 'tools/list' }) =>
  fetch(f.mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers }, body: JSON.stringify(body) });

describe('hosted MCP: transport, host/origin and discovery', () => {
  it('rejects unauthenticated calls with a discoverable 401 challenge', async () => {
    const f = await start();
    const res = await rpc(f);
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate')!;
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`resource_metadata="${f.base}/.well-known/oauth-protected-resource/mcp"`);
    expect((await rpc(f, { authorization: 'Bearer t2o_oat_notarealtokennotarealtoken' })).status).toBe(401);
    // A gateway customer key is not an MCP credential: only OAuth access tokens are accepted on /mcp.
    expect((await rpc(f, { authorization: `Bearer ${f.h.alice.token}` })).status).toBe(401);
  });

  it('publishes protected-resource and authorization-server metadata (S256, DCR, scopes)', async () => {
    const f = await start();
    const prm = await (await fetch(`${f.base}/.well-known/oauth-protected-resource/mcp`)).json() as any;
    expect(prm.resource).toBe(f.mcpUrl);
    expect(prm.authorization_servers).toEqual([`${f.base}/`]);
    const root = await (await fetch(`${f.base}/.well-known/oauth-protected-resource`)).json() as any;
    expect(root.resource).toBe(f.mcpUrl);
    const as = await (await fetch(`${f.base}/.well-known/oauth-authorization-server`)).json() as any;
    expect(as.code_challenge_methods_supported).toEqual(['S256']);
    expect(as.registration_endpoint).toBe(`${f.base}/register`);
    expect(as.authorization_endpoint).toBe(`${f.base}/authorize`);
    expect(as.scopes_supported).not.toContain('purchases:fund');
  });

  it('accepts only the configured public host and origins, and only POST', async () => {
    const f = await start();
    const { access_token } = (await fullGrant(f)).tokens;
    const auth = { authorization: `Bearer ${access_token}` };
    const init = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } };
    expect((await rpc(f, auth, init)).status).toBe(200);
    expect((await rpc(f, { ...auth, origin: f.base }, init)).status).toBe(200);
    expect((await rpc(f, { ...auth, origin: 'https://chatgpt.com' }, init)).status).toBe(200);
    expect((await rpc(f, { ...auth, origin: 'https://evil.example' }, init)).status).toBe(403);
    expect((await rpc(f, { ...auth, origin: 'null' }, init)).status).toBe(403);
    expect((await fetch(f.mcpUrl, { method: 'GET', headers: auth })).status).toBe(405);
    expect((await fetch(f.mcpUrl, { method: 'DELETE', headers: auth })).status).toBe(405);
    // Host header spoofing (raw socket request, since fetch forbids overriding Host).
    const { request } = await import('node:http');
    const status = await new Promise<number>((resolve) => {
      const r = request({ host: '127.0.0.1', port: new URL(f.base).port, path: '/mcp', method: 'POST', headers: { host: 'token2049-origins.onrender.com.evil.example', 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...auth } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      r.end(JSON.stringify(init));
    });
    expect(status).toBe(403);
    // Forwarded-host headers are never trusted to make a bad host good.
    const { request: req2 } = await import('node:http');
    const status2 = await new Promise<number>((resolve) => {
      const r = req2({ host: '127.0.0.1', port: new URL(f.base).port, path: '/mcp', method: 'POST', headers: { host: 'evil.example', 'x-forwarded-host': new URL(f.base).host, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...auth } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      r.end(JSON.stringify(init));
    });
    expect(status2).toBe(403);
  });

  it('bounds the request body', async () => {
    const f = await start();
    const { access_token } = (await fullGrant(f)).tokens;
    const huge = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(1_100_000) } };
    const res = await rpc(f, { authorization: `Bearer ${access_token}` }, huge);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toMatch(/stack|at .*\.ts/);
  });
});

describe('hosted MCP: OAuth 2.1 authorization code + PKCE', () => {
  it('registers only allowlisted redirect URIs', async () => {
    const f = await start();
    const bad = await fetch(`${f.base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://evil.example/cb'], token_endpoint_auth_method: 'none' }) });
    expect(bad.status).toBe(400);
    const loose = await fetch(`${f.base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/connector/oauth/abc123_-X'], token_endpoint_auth_method: 'none' }) });
    expect(loose.status).toBe(201);
    const body = await loose.json() as any;
    expect(body.client_secret).toBeUndefined();
    expect(body.token_endpoint_auth_method).toBe('none');
    const nested = await fetch(`${f.base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['https://chatgpt.com/connector/oauth/abc/../../evil'], token_endpoint_auth_method: 'none' }) });
    expect(nested.status).toBe(400);
  });

  it('requires the owner passcode, then issues scoped tokens bound to this resource', async () => {
    const f = await start();
    const c = await connect(f);
    expect(c.page.headers.get('cache-control')).toBe('no-store');
    expect(c.page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    const wrong = await c.approve('not-the-passcode-at-all');
    expect(wrong.status).toBe(401);
    const ok = await c.approve();
    expect(ok.status).toBe(302);
    const loc = new URL(ok.headers.get('location')!);
    expect(loc.origin + loc.pathname).toBe(CHATGPT_REDIRECT);
    expect(loc.searchParams.get('state')).toBe('st-1');
    expect(loc.searchParams.get('iss')).toBe(f.base);
    // Single use authorization request.
    expect((await c.approve()).status).toBe(400);
    const res = await token(f, c.client, { grant_type: 'authorization_code', code: loc.searchParams.get('code')!, code_verifier: c.verifier, redirect_uri: CHATGPT_REDIRECT, resource: f.mcpUrl });
    const tokens = await res.json() as any;
    expect(tokens.token_type).toBe('Bearer');
    expect(tokens.scope.split(' ').sort()).toEqual(['offers:read', 'purchases:read', 'purchases:write', 'quotes:write']);
    expect(tokens.scope).not.toContain('purchases:fund');
    expect(tokens.access_token).toMatch(/^t2o_oat_/);
  });

  it('refuses a wrong PKCE verifier, a replayed code (revoking its tokens) and a foreign resource', async () => {
    const f = await start();
    const c = await connect(f);
    const code = new URL((await c.approve()).headers.get('location')!).searchParams.get('code')!;
    const wrong = await token(f, c.client, { grant_type: 'authorization_code', code, code_verifier: b64url(randomBytes(32)), redirect_uri: CHATGPT_REDIRECT });
    expect(wrong.status).toBe(400);
    const good = await token(f, c.client, { grant_type: 'authorization_code', code, code_verifier: c.verifier, redirect_uri: CHATGPT_REDIRECT });
    expect(good.status).toBe(200);
    const { access_token } = await good.json() as any;
    expect((await rpc(f, { authorization: `Bearer ${access_token}` })).status).toBe(200);
    const replay = await token(f, c.client, { grant_type: 'authorization_code', code, code_verifier: c.verifier, redirect_uri: CHATGPT_REDIRECT });
    expect(replay.status).toBe(400);
    expect((await rpc(f, { authorization: `Bearer ${access_token}` })).status).toBe(401);

    const other = await connect(f, { resource: 'https://other.example/mcp' });
    expect(other.page.status).toBe(302); // invalid_target is delivered to the registered redirect, never rendered
    expect(new URL(other.page.headers.get('location')!).searchParams.get('error')).toBe('invalid_target');
  });

  it('rejects unsupported scopes such as purchases:fund', async () => {
    const f = await start();
    const c = await connect(f, { scope: 'purchases:fund' });
    expect(c.page.status).toBe(302);
    expect(new URL(c.page.headers.get('location')!).searchParams.get('error')).toBe('invalid_scope');
  });

  it('rotates refresh tokens and kills the grant when an old one is replayed', async () => {
    const f = await start();
    const g = await fullGrant(f);
    const r1 = await token(f, g.client, { grant_type: 'refresh_token', refresh_token: g.tokens.refresh_token });
    expect(r1.status).toBe(200);
    const next = await r1.json() as any;
    expect(next.access_token).not.toBe(g.tokens.access_token);
    expect((await rpc(f, { authorization: `Bearer ${next.access_token}` })).status).toBe(200);
    const replay = await token(f, g.client, { grant_type: 'refresh_token', refresh_token: g.tokens.refresh_token });
    expect(replay.status).toBe(400);
    expect((await rpc(f, { authorization: `Bearer ${next.access_token}` })).status).toBe(401);
    const widened = await fullGrant(f);
    const wide = await token(f, widened.client, { grant_type: 'refresh_token', refresh_token: widened.tokens.refresh_token, scope: 'purchases:fund' });
    expect(wide.status).toBe(400);
  });

  it('locks out passcode guessing', async () => {
    const f = await start();
    const c = await connect(f);
    for (let i = 0; i < 5; i++) expect((await c.approve(`wrong-guess-number-${i}-padding`)).status).toBe(401);
    expect((await c.approve()).status).toBe(429);
  });

  it('honours operator revocation of the demo identity immediately', async () => {
    const f = await start();
    const g = await fullGrant(f);
    expect((await rpc(f, { authorization: `Bearer ${g.tokens.access_token}` })).status).toBe(200);
    await f.h.gw.db.run('UPDATE api_clients SET revoked_at = $1 WHERE id = $2', new Date().toISOString(), 'cli_HOSTEDTESTDEMO');
    expect((await rpc(f, { authorization: `Bearer ${g.tokens.access_token}` })).status).toBe(401);
    expect((await f.h.call('GET', '/v1/purchases/pur_0000000000000', { token: g.tokens.access_token })).status).toBe(401);
    const again = await connect(f);
    const denied = await again.approve();
    expect(new URL(denied.headers.get('location')!).searchParams.get('error')).toBe('access_denied');
  });

  it('never lets an OAuth token fund a purchase or read evidence', async () => {
    const f = await start();
    const g = await fullGrant(f);
    const funded = await f.h.call('POST', '/v1/purchases/pur_0000000000000/fund', { token: g.tokens.access_token });
    expect(funded.status).toBe(403);
    expect((await f.h.call('GET', '/v1/evidence/purchases/pur_0000000000000', { token: g.tokens.access_token })).status).toBeGreaterThanOrEqual(401);
  });
});

describe('hosted MCP: tools over the real transport', () => {
  it('lists tools with OAuth security schemes and honest annotations', async () => {
    const f = await start();
    const g = await fullGrant(f);
    const client = await mcp(f, g.tokens.access_token);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(['buy', 'create_quote', 'find_offers', 'get_purchase']);
      const scopes: Record<string, string> = { find_offers: 'offers:read', create_quote: 'quotes:write', buy: 'purchases:write', get_purchase: 'purchases:read' };
      for (const t of tools) {
        expect((t._meta as any).securitySchemes).toEqual([{ type: 'oauth2', scopes: [scopes[t.name]] }]);
        expect(t.annotations).toBeDefined();
      }
      expect(tools.find((t) => t.name === 'find_offers')!.annotations).toMatchObject({ readOnlyHint: true });
      expect(tools.find((t) => t.name === 'buy')!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
      expect(client.getInstructions()).toMatch(/best 3 viable options/);
    } finally { await client.close(); }
  });

  it('runs find_offers -> create_quote as the OAuth customer, with selection guidance and no leaked secrets', async () => {
    const f = await start({ withBridge: true });
    const g = await fullGrant(f);
    const client = await mcp(f, g.tokens.access_token);
    try {
      const found = await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } }) as any;
      expect(found.isError).toBeFalsy();
      expect(found.structuredContent.interaction).toMatchObject({ nextAction: 'present_options_and_ask_user_to_choose', createQuoteAllowedNow: false, markExactlyOneRecommended: true, presentAtMost: 3 });
      expect(found.structuredContent.shortlist.length).toBeLessThanOrEqual(3);
      expect(found.content[0].text).toMatch(/Recommended/);
      expect(found.content[0].text).toMatch(/Do NOT call create_quote yet/);
      const offerId = found.structuredContent.offers[0].offerId;
      const quoted = await client.callTool({ name: 'create_quote', arguments: { offerId, fulfillment: retailFulfillment } }) as any;
      expect(quoted.isError).toBeFalsy();
      expect(quoted.structuredContent.fundingSources[0]).toMatchObject({ rail: 'cardano', readiness: 'configured' });
      expect(JSON.stringify(found) + JSON.stringify(quoted)).not.toContain(g.tokens.access_token);
      expect(JSON.stringify(found) + JSON.stringify(quoted)).not.toContain(BRIDGE_TOKEN);
      expect(JSON.stringify(quoted)).not.toContain(PASSCODE);
    } finally { await client.close(); }
  });

  it('requires explicit funding selection and approval before the hosted Cardano payer is called', async () => {
    const f = await start({ withBridge: true });
    const g = await fullGrant(f);
    const client = await mcp(f, g.tokens.access_token);
    try {
      const found = await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } }) as any;
      const quoted = await client.callTool({ name: 'create_quote', arguments: { offerId: found.structuredContent.offers[0].offerId, fulfillment: retailFulfillment } }) as any;
      const quote = quoted.structuredContent.quote;
      const noChoice = await client.callTool({ name: 'buy', arguments: { quoteId: quote.quoteId } }) as any;
      expect(noChoice.structuredContent.phase).toBe('funding_selection');
      const noApproval = await client.callTool({ name: 'buy', arguments: { quoteId: quote.quoteId, selectedFundingOptionId: quote.fundingOptions[0].fundingOptionId } }) as any;
      expect(noApproval.structuredContent.phase).toBe('approval');
      expect(f.bridge!.calls).toEqual([]);

      const approved = { quoteId: quote.quoteId, selectedFundingOptionId: quote.fundingOptions[0].fundingOptionId, maxTotal: quote.payablePrincipal, quoteDigest: quote.digest };
      // Concurrent duplicate buys: exactly one purchase and at most one payer call that results in a payment.
      const results = await Promise.all([1, 2, 3].map(() => client.callTool({ name: 'buy', arguments: approved }) as Promise<any>));
      const purchaseIds = new Set(results.map((r) => r.structuredContent?.purchase?.purchaseId).filter(Boolean));
      expect(purchaseIds.size).toBe(1);
      const funding = await f.h.gw.db.all('SELECT * FROM funding_evidence');
      expect(funding.length).toBe(1);
      const pid = [...purchaseIds][0] as string;
      expect(new Set(f.bridge!.calls)).toEqual(new Set([pid]));
    } finally { await client.close(); }
  });

  it('ends with ORDER CONFIRMED only after the purchase state proves retail success', async () => {
    const f = await start({ withBridge: true });
    retailReportsPaid(f.h);
    const g = await fullGrant(f);
    const client = await mcp(f, g.tokens.access_token);
    try {
      const found = await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } }) as any;
      const quoted = await client.callTool({ name: 'create_quote', arguments: { offerId: found.structuredContent.offers[0].offerId, fulfillment: retailFulfillment } }) as any;
      const quote = quoted.structuredContent.quote;
      const bought = await client.callTool({ name: 'buy', arguments: { quoteId: quote.quoteId, selectedFundingOptionId: quote.fundingOptions[0].fundingOptionId, maxTotal: quote.payablePrincipal, quoteDigest: quote.digest } }) as any;
      expect(bought.structuredContent.status).toBe('execution_pending');
      expect(bought.structuredContent.orderConfirmation).toBeUndefined();
      expect(bought.content[0].text).not.toMatch(/ORDER CONFIRMED/);
      const pid = bought.structuredContent.purchase.purchaseId;
      const pending = await client.callTool({ name: 'get_purchase', arguments: { purchaseId: pid } }) as any;
      expect(pending.structuredContent.orderConfirmation).toBeUndefined();
      expect(pending.content[0].text).not.toMatch(/ORDER CONFIRMED/);

      await f.h.gw.worker.tick();
      const done = await client.callTool({ name: 'get_purchase', arguments: { purchaseId: pid } }) as any;
      expect(done.structuredContent.purchase.state).toBe('succeeded');
      const c = done.structuredContent.orderConfirmation;
      expect(c.headline).toBe('ORDER CONFIRMED');
      expect(c.paymentVerified).toBe(true);
      expect(c.orderReference).toBe(done.structuredContent.purchase.providerReference);
      expect(c.receiptId).toBe(done.structuredContent.purchase.receipt.receiptId);
      expect(c.payments[0]).toMatchObject({ rail: 'cardano', transferReference: `hosted-${pid}` });
      expect(done.content[0].text).toMatch(/^ORDER CONFIRMED\n/);
    } finally { await client.close(); }
  });

  it('reports no hosted payer as action_required instead of falling back to another rail', async () => {
    const f = await start({ withBridge: false });
    const g = await fullGrant(f);
    const client = await mcp(f, g.tokens.access_token);
    try {
      const found = await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } }) as any;
      const quoted = await client.callTool({ name: 'create_quote', arguments: { offerId: found.structuredContent.offers[0].offerId, fulfillment: retailFulfillment } }) as any;
      expect(quoted.structuredContent.fundingSources).toEqual([]);
      expect(quoted.content[0].text).toMatch(/External payment action required/);
    } finally { await client.close(); }
  });

  it('keeps a token without the tool scope out and asks ChatGPT to re-link', async () => {
    const f = await start();
    const g = await fullGrant(f);
    // Narrow the token in storage to simulate a grant that lacks offers:read.
    await f.h.gw.db.run("UPDATE oauth_tokens SET scopes_json = '[\"purchases:read\"]' WHERE kind = 'access'");
    const client = await mcp(f, g.tokens.access_token);
    try {
      const res = await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } }) as any;
      expect(res.isError).toBe(true);
      expect(res._meta['mcp/www_authenticate'][0]).toMatch(/error="insufficient_scope".*scope="offers:read"/);
    } finally { await client.close(); }
  });
});

describe('hosted MCP: public smoke script', () => {
  it('passes end to end (discovery, OAuth+PKCE, initialize, tools/list, find_offers, create_quote) and spends nothing', async () => {
    const f = await start({ withBridge: true });
    const { stdout } = await promisify(execFile)(process.execPath, ['scripts/hosted-mcp-smoke.mjs', '--base', f.base, '--quote'], { env: { ...process.env, HOSTED_MCP_PASSCODE: PASSCODE }, timeout: 60_000 });
    expect(stdout).not.toMatch(/FAIL/);
    expect(stdout).toMatch(/all checks passed \(nothing was bought or paid\)/);
    expect(stdout).not.toContain(PASSCODE);
    expect(stdout).not.toMatch(/t2o_oat_|t2o_ort_/);
    expect(f.bridge!.calls).toEqual([]);
    expect(await f.h.gw.db.all('SELECT id FROM purchases')).toEqual([]);
  }, 90_000);

  it('also wakes and checks the hosted payer (/health, /status, wrong token, no-token /pay) without paying', async () => {
    const f = await start({ withBridge: true });
    const dir = mkdtempSync(join(tmpdir(), 'smoke-payer-'));
    const tokenFile = join(dir, 'token');
    writeFileSync(tokenFile, BRIDGE_TOKEN + '\n');
    try {
      const { stdout } = await promisify(execFile)(process.execPath, ['scripts/hosted-mcp-smoke.mjs', '--base', f.base, '--payer-url', f.bridgeUrl!, '--payer-token-file', tokenFile], { env: { ...process.env, HOSTED_MCP_PASSCODE: PASSCODE }, timeout: 60_000 });
      expect(stdout).toMatch(/PASS {2}payer \/health/);
      expect(stdout).toMatch(/PASS {2}payer \/status reports the configured Cardano Preprod wallet/);
      expect(stdout).toMatch(/PASS {2}payer refuses a wrong bearer token/);
      expect(stdout).not.toMatch(/FAIL/);
      expect(stdout).not.toContain(BRIDGE_TOKEN);
      expect(f.bridge!.calls).toEqual([]);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 90_000);
});

describe('hosted MCP acceptance: the exact ChatGPT conversation', () => {
  it('shortlist -> user choice -> quote with Cardano and Solana options -> user approval -> buy -> polling creates nothing -> ORDER CONFIRMED', async () => {
    const f = await start({ withBridge: true, withSolana: true });
    retailReportsPaid(f.h);
    const g = await fullGrant(f);
    const client = await mcp(f, g.tokens.access_token);
    const tools = new Set<string>();
    const call = async (name: string, args: Record<string, unknown>) => { tools.add(name); return await client.callTool({ name, arguments: args }) as any; };
    try {
      // 1. "Find me an international travel adapter." -> a shortlist, and create_quote is explicitly NOT the next action.
      const found = await call('find_offers', { intent: retailIntent() });
      expect(found.structuredContent.interaction.nextAction).toBe('present_options_and_ask_user_to_choose');
      expect(found.structuredContent.interaction.createQuoteAllowedNow).toBe(false);
      expect(found.content[0].text).toMatch(/Do NOT call create_quote yet/);
      expect(found.content[0].text).toMatch(/exactly ONE as "Recommended"/);
      expect(f.h.gw.db && (await f.h.gw.db.all('SELECT id FROM quotes')).length).toBe(0); // nothing quoted until the user chooses
      const chosen = found.structuredContent.shortlist[0].offerId; // the "user" explicitly chooses

      // 2. create_quote only after that choice: exact terms and BOTH funding options, with no purchase yet.
      const quoted = await call('create_quote', { offerId: chosen, fulfillment: retailFulfillment });
      const quote = quoted.structuredContent.quote;
      expect(quote.fundingOptions.map((o: any) => o.rail)).toEqual(['cardano', 'solana']);
      expect(quoted.content[0].text).toMatch(/- cardano .*Connected wallet/);
      expect(quoted.content[0].text).toMatch(/- solana .*External payment action required/);
      expect(quoted.content[0].text).toMatch(/explicit approval/);
      expect((await f.h.gw.db.all('SELECT id FROM purchases')).length).toBe(0);

      // 3. buy cannot proceed without the user's explicit rail choice and approval.
      expect((await call('buy', { quoteId: quote.quoteId })).structuredContent.phase).toBe('funding_selection');
      const cardano = quote.fundingOptions.find((o: any) => o.rail === 'cardano');
      expect((await call('buy', { quoteId: quote.quoteId, selectedFundingOptionId: cardano.fundingOptionId })).structuredContent.phase).toBe('approval');
      expect(f.bridge!.calls).toEqual([]);

      // 4. The user selects Cardano and approves the exact quote.
      const bought = await call('buy', { quoteId: quote.quoteId, selectedFundingOptionId: cardano.fundingOptionId, maxTotal: quote.payablePrincipal, quoteDigest: quote.digest });
      const pid = bought.structuredContent.purchase.purchaseId;
      expect(bought.structuredContent.orderConfirmation).toBeUndefined();

      // 5. Polling never creates another purchase or payment, before or after completion.
      const snapshot = async () => ({ purchases: (await f.h.gw.db.all('SELECT id FROM purchases')).length, funding: (await f.h.gw.db.all('SELECT * FROM funding_evidence')).length, bridge: f.bridge!.calls.length });
      const before = await snapshot();
      expect(before).toEqual({ purchases: 1, funding: 1, bridge: 1 });
      for (let i = 0; i < 3; i++) expect((await call('get_purchase', { purchaseId: pid })).structuredContent.orderConfirmation).toBeUndefined();
      await f.h.gw.worker.tick();
      const done = await call('get_purchase', { purchaseId: pid, includeEvents: true });
      for (let i = 0; i < 3; i++) await call('get_purchase', { purchaseId: pid });
      expect(await snapshot()).toEqual(before);

      // 6. Final payoff.
      const c = done.structuredContent.orderConfirmation;
      expect(c).toMatchObject({ headline: 'ORDER CONFIRMED', commerceType: 'retail', paymentVerified: true, purchaseId: pid });
      expect(c.receiptId).toMatch(/^rcp_/);
      expect(c.reference.value).toBe(done.structuredContent.purchase.providerReference);
      expect(c.payments[0]).toMatchObject({ rail: 'cardano', transferReference: `hosted-${pid}` });
      const text = done.content[0].text as string;
      expect(text).toMatch(/^ORDER CONFIRMED\n/);
      expect(text).toMatch(/Receipt: rcp_/);
      expect(text).toMatch(/Payment verified \(cardano\)/);
      expect(text).toMatch(/End your reply with "ORDER CONFIRMED"/);
      expect([...tools].sort()).toEqual(['buy', 'create_quote', 'find_offers', 'get_purchase']);
    } finally { await client.close(); }
  });

  it('choosing Solana without a hosted Solana payer buys nothing and falls back to nothing', async () => {
    const f = await start({ withBridge: true, withSolana: true });
    const g = await fullGrant(f);
    const client = await mcp(f, g.tokens.access_token);
    try {
      const found = await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } }) as any;
      const quoted = await client.callTool({ name: 'create_quote', arguments: { offerId: found.structuredContent.offers[0].offerId, fulfillment: retailFulfillment } }) as any;
      const quote = quoted.structuredContent.quote;
      const solana = quote.fundingOptions.find((o: any) => o.rail === 'solana');
      const res = await client.callTool({ name: 'buy', arguments: { quoteId: quote.quoteId, selectedFundingOptionId: solana.fundingOptionId, maxTotal: quote.payablePrincipal, quoteDigest: quote.digest } }) as any;
      expect(res.structuredContent.status).toBe('action_required');
      expect(f.bridge!.calls).toEqual([]);
      expect((await f.h.gw.db.all('SELECT id FROM purchases')).length).toBe(0);
    } finally { await client.close(); }
  });
});

describe('hosted MCP acceptance: commerce-specific final states', () => {
  /** Real succeeded retail purchase, then re-shaped per commerce type and served by a stub gateway through the real MCP tools. */
  async function base() {
    const f = await start({ withBridge: true });
    retailReportsPaid(f.h);
    const g = await fullGrant(f);
    const client = await mcp(f, g.tokens.access_token);
    const found = await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } }) as any;
    const quoted = await client.callTool({ name: 'create_quote', arguments: { offerId: found.structuredContent.offers[0].offerId, fulfillment: retailFulfillment } }) as any;
    const q = quoted.structuredContent.quote;
    const bought = await client.callTool({ name: 'buy', arguments: { quoteId: q.quoteId, selectedFundingOptionId: q.fundingOptions[0].fundingOptionId, maxTotal: q.payablePrincipal, quoteDigest: q.digest } }) as any;
    await f.h.gw.worker.tick();
    const done = await client.callTool({ name: 'get_purchase', arguments: { purchaseId: bought.structuredContent.purchase.purchaseId } }) as any;
    await client.close();
    expect(done.structuredContent.orderConfirmation.headline).toBe('ORDER CONFIRMED');
    return done.structuredContent.purchase as any;
  }

  async function viaStub(purchase: unknown) {
    const server = createMcpServer({
      gatewayUrl: 'http://stub.invalid', gatewayToken: 't2o_oat_stubtoken0123456789abcdef',
      fetch: (async () => new Response(JSON.stringify({ purchase }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch,
    });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'stub', version: '0' });
    await Promise.all([server.connect(a), client.connect(b)]);
    const res = await client.callTool({ name: 'get_purchase', arguments: { purchaseId: (purchase as any).purchaseId } }) as any;
    await client.close(); await server.close();
    return res;
  }

  const shape = (p: any, over: { category: 'retail' | 'hotel' | 'flight'; route: string; status: string; ref: string; keepSource?: boolean }) => {
    const { sourceOffer, sandboxExecution, ...receipt } = p.receipt;
    return { ...p, category: over.category, route: over.route, commerceStatus: over.status, providerReference: over.ref,
      receipt: { ...receipt, ...(over.keepSource ? { sourceOffer } : {}), category: over.category, route: over.route, commerceStatus: over.status, providerReference: over.ref } };
  };

  it.each([
    { category: 'retail', route: 'shopify', status: 'paid', ref: '#1003', headline: 'ORDER CONFIRMED', line: 'Order: #1003' },
    { category: 'hotel', route: 'nuitee', status: 'confirmed', ref: 'BK-7781234', headline: 'BOOKING CONFIRMED', line: 'Booking reference: BK-7781234' },
    { category: 'flight', route: 'atlas', status: 'ticketed', ref: 'ATL-20261007-42', headline: 'TICKET ISSUED', line: 'Provider order / ticket reference: ATL-20261007-42' },
  ] as const)('$category ends with $headline plus its references', async ({ category, route, status, ref, headline, line }) => {
    const done = await base();
    const res = await viaStub(shape(done, { category, route, status, ref }));
    const text = res.content[0].text as string;
    expect(text.split('\n')[0]).toBe(headline);
    expect(text).toContain(line);
    expect(text).toMatch(/Receipt: rcp_/);
    expect(text).toMatch(/Payment verified \(cardano\): /);
    expect(res.structuredContent.orderConfirmation).toMatchObject({ headline, commerceType: category, paymentVerified: true });
    // The other commerce types' labels never appear.
    for (const other of ['ORDER CONFIRMED', 'BOOKING CONFIRMED', 'TICKET ISSUED'].filter((h) => h !== headline)) expect(text).not.toContain(other);
  });

  it.each([
    ['retail only reported "confirmed" (not the paid proof)', { category: 'retail', route: 'shopify', status: 'confirmed', ref: '#1003' }],
    ['hotel held, not confirmed', { category: 'hotel', route: 'nuitee', status: 'held', ref: 'BK-1' }],
    ['hotel paid but not confirmed', { category: 'hotel', route: 'nuitee', status: 'paid', ref: 'BK-1' }],
    ['flight still ticketing', { category: 'flight', route: 'atlas', status: 'ticketing', ref: 'ATL-1' }],
    ['flight merely confirmed, not ticketed', { category: 'flight', route: 'atlas', status: 'confirmed', ref: 'ATL-1' }],
  ] as const)('shows no success label when %s', async (_name, over) => {
    const done = await base();
    const res = await viaStub(shape(done, over));
    expect(res.content[0].text).not.toMatch(/ORDER CONFIRMED|BOOKING CONFIRMED|TICKET ISSUED/);
    expect(res.structuredContent.orderConfirmation).toBeUndefined();
  });

  it.each([
    ['purchase not succeeded', (p: any) => ({ ...p, state: 'executing' })],
    ['purchase unresolved', (p: any) => ({ ...p, state: 'unresolved' })],
    ['no receipt issued', (p: any) => ({ ...p, receipt: null })],
    ['merchant payment not paid', (p: any) => ({ ...p, merchantPaymentStatus: 'pending', receipt: { ...p.receipt, merchantPaymentStatus: 'pending' } })],
    ['no provider reference', (p: any) => ({ ...p, providerReference: null })],
    ['funding not verified', (p: any) => ({ ...p, receipt: { ...p.receipt, funding: p.receipt.funding.map((x: any) => ({ ...x, paymentState: 'submitted' })) } })],
  ] as const)('shows no success label when %s', async (_name, mutate) => {
    const done = await base();
    const res = await viaStub(mutate(shape(done, { category: 'retail', route: 'shopify', status: 'paid', ref: '#1003' })));
    expect(res.content[0].text).not.toMatch(/ORDER CONFIRMED|BOOKING CONFIRMED|TICKET ISSUED/);
    expect(res.structuredContent.orderConfirmation).toBeUndefined();
  });
});

describe('hosted payer gateway client provisioning (hash only)', () => {
  const cfg = (f: Fixture, hash?: string): HostedMcpConfig => ({
    publicUrl: new URL(f.base), allowedOrigins: [], ownerPasscode: PASSCODE, customerId: 'cus_HOSTEDTESTDEMO', apiClientId: 'cli_HOSTEDTESTDEMO',
    payerClientId: 'cli_HOSTEDTESTPAYER', extraRedirectUris: [], gatewayUrl: f.base, ...(hash ? { payerTokenSha256: hash } : {}),
  });

  it('registers a payer client scoped to read+fund for the hosted customer only, and is idempotent', async () => {
    const f = await start();
    const token = 't2o_' + randomBytes(32).toString('base64url');
    await provisionPayerClient(f.h.gw.db, cfg(f, sha256Hex(token)));
    await provisionPayerClient(f.h.gw.db, cfg(f, sha256Hex(token)));
    const rows = await f.h.gw.db.all<any>("SELECT customer_id, scopes_json, channel FROM api_clients WHERE id = 'cli_HOSTEDTESTPAYER'");
    expect(rows).toHaveLength(1);
    expect(rows[0].customer_id).toBe('cus_HOSTEDTESTDEMO');
    expect(JSON.parse(rows[0].scopes_json)).toEqual(['purchases:read', 'purchases:fund']);
    // The payer can read/fund purchases but cannot search, quote or buy; the plaintext token is never stored.
    expect((await f.h.call('POST', '/v1/offers/search', { token, body: { intent: retailIntent() } })).status).toBe(403);
    expect((await f.h.call('GET', '/v1/purchases/pur_0000000000000', { token })).status).toBe(404);
    expect(JSON.stringify(await f.h.gw.db.all('SELECT * FROM api_clients'))).not.toContain(token);
  });

  it('rotates the hash, keeps operator revocation, and does nothing without a configured hash', async () => {
    const f = await start();
    const one = 't2o_' + randomBytes(32).toString('base64url'), two = 't2o_' + randomBytes(32).toString('base64url');
    await provisionPayerClient(f.h.gw.db, cfg(f));
    expect(await f.h.gw.db.all("SELECT id FROM api_clients WHERE id = 'cli_HOSTEDTESTPAYER'")).toEqual([]);
    await provisionPayerClient(f.h.gw.db, cfg(f, sha256Hex(one)));
    await provisionPayerClient(f.h.gw.db, cfg(f, sha256Hex(two)));
    expect((await f.h.call('GET', '/v1/purchases/pur_0000000000000', { token: one })).status).toBe(401);
    expect((await f.h.call('GET', '/v1/purchases/pur_0000000000000', { token: two })).status).toBe(404);
    await f.h.gw.db.run("UPDATE api_clients SET revoked_at = $1 WHERE id = 'cli_HOSTEDTESTPAYER'", new Date().toISOString());
    await provisionPayerClient(f.h.gw.db, cfg(f, sha256Hex(one)));
    expect((await f.h.call('GET', '/v1/purchases/pur_0000000000000', { token: one })).status).toBe(401);
    expect((await f.h.call('GET', '/v1/purchases/pur_0000000000000', { token: two })).status).toBe(401);
  });
});

describe('hosted MCP: free payer cold starts', () => {
  const approvedBuy = async (client: Client, quote: any) => ({ quoteId: quote.quoteId, selectedFundingOptionId: quote.fundingOptions[0].fundingOptionId, maxTotal: quote.payablePrincipal, quoteDigest: quote.digest });
  async function quoteOnce(client: Client) {
    const found = await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } }) as any;
    const quoted = await client.callTool({ name: 'create_quote', arguments: { offerId: found.structuredContent.offers[0].offerId, fulfillment: retailFulfillment } }) as any;
    return quoted;
  }

  it('waits for a sleeping payer to wake instead of reporting it unavailable', async () => {
    const f = await start({ withBridge: true, statusDelayMs: 700, bridgeStatusTimeoutMs: 5000 });
    const client = await mcp(f, (await fullGrant(f)).tokens.access_token);
    try {
      const quoted = await quoteOnce(client);
      expect(quoted.structuredContent.fundingSources[0]).toMatchObject({ rail: 'cardano', readiness: 'configured' });
      expect(quoted.content[0].text).toMatch(/Connected wallet/);
    } finally { await client.close(); }
  });

  it('a payer that is too slow to answer is "unavailable", never silently another rail', async () => {
    const f = await start({ withBridge: true, withSolana: true, statusDelayMs: 1500, bridgeStatusTimeoutMs: 200 });
    const client = await mcp(f, (await fullGrant(f)).tokens.access_token);
    try {
      const quoted = await quoteOnce(client);
      expect(quoted.structuredContent.fundingSources).toEqual([]);
      expect(quoted.content[0].text).not.toMatch(/Connected wallet/);
      const q = quoted.structuredContent.quote;
      const res = await client.callTool({ name: 'buy', arguments: await approvedBuy(client, q) }) as any;
      expect(res.structuredContent.status).toBe('action_required');
      expect((await f.h.gw.db.all('SELECT id FROM purchases')).length).toBe(0);
    } finally { await client.close(); }
  });

  it('a timeout during the payment call never causes a second payment: durable payer history decides', async () => {
    const f = await start({ withBridge: true, payResponseDelayMs: 800, bridgeTimeoutMs: 250 });
    const client = await mcp(f, (await fullGrant(f)).tokens.access_token);
    try {
      const q = (await quoteOnce(client)).structuredContent.quote;
      const args = await approvedBuy(client, q);
      const first = await client.callTool({ name: 'buy', arguments: args }) as any;
      // The gateway gave up waiting, but the payer had already paid; the reply says the outcome is unknown, not "paid" or "failed for good".
      expect(first.structuredContent.payment).toMatchObject({ attempted: true, ok: false, code: 'bridge_unreachable' });
      expect(first.content[0].text).not.toMatch(/ORDER CONFIRMED/);
      const again = await client.callTool({ name: 'buy', arguments: args }) as any;
      const third = await client.callTool({ name: 'buy', arguments: args }) as any;
      for (const r of [again, third]) expect(r.structuredContent.purchase.purchaseId).toBe(first.structuredContent.purchase.purchaseId);
      expect(f.bridge!.calls).toHaveLength(1);
      expect((await f.h.gw.db.all('SELECT id FROM purchases')).length).toBe(1);
      expect((await f.h.gw.db.all('SELECT * FROM funding_evidence')).length).toBe(1);
      const polled = await client.callTool({ name: 'get_purchase', arguments: { purchaseId: first.structuredContent.purchase.purchaseId } }) as any;
      expect(polled.structuredContent.purchase.paymentState).not.toBe('not_received');
    } finally { await client.close(); }
  });
});

describe('hosted MCP: payer spend-cap headroom', () => {
  async function quoted(f: Fixture) {
    const client = await mcp(f, (await fullGrant(f)).tokens.access_token);
    const found = await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } }) as any;
    const q = await client.callTool({ name: 'create_quote', arguments: { offerId: found.structuredContent.offers[0].offerId, fulfillment: retailFulfillment } }) as any;
    return { client, q };
  }

  it('tells the user at quote time when the payer\'s remaining cap is below the payment, and refuses before creating any purchase', async () => {
    const f = await start({ withBridge: true, headroomBaseUnits: '1' });
    const { client, q } = await quoted(f);
    try {
      const quote = q.structuredContent.quote;
      expect(q.content[0].text).toMatch(/remaining spend cap \(1 base units\) is below this payment: it would be refused/);
      const res = await client.callTool({ name: 'buy', arguments: { quoteId: quote.quoteId, selectedFundingOptionId: quote.fundingOptions[0].fundingOptionId, maxTotal: quote.payablePrincipal, quoteDigest: quote.digest } }) as any;
      expect(res.isError).toBe(true);
      expect(res.structuredContent.error.code).toBe('payer_cap_exceeded');
      expect(res.structuredContent).toMatchObject({ remainingCapBaseUnits: '1', requiredBaseUnits: quote.fundingOptions[0].amount.amountBaseUnits });
      expect(res.content[0].text).toMatch(/Nothing has been purchased and no purchase was created/);
      expect(f.bridge!.calls).toEqual([]);
      expect((await f.h.gw.db.all('SELECT id FROM purchases')).length).toBe(0);
    } finally { await client.close(); }
  });

  it('proceeds normally when the headroom covers the payment (and when a payer reports none)', async () => {
    for (const headroomBaseUnits of ['999999999999', undefined]) {
      const f = await start({ withBridge: true, ...(headroomBaseUnits ? { headroomBaseUnits } : {}) });
      const { client, q } = await quoted(f);
      try {
        const quote = q.structuredContent.quote;
        expect(q.content[0].text).not.toMatch(/would be refused/);
        const res = await client.callTool({ name: 'buy', arguments: { quoteId: quote.quoteId, selectedFundingOptionId: quote.fundingOptions[0].fundingOptionId, maxTotal: quote.payablePrincipal, quoteDigest: quote.digest } }) as any;
        expect(res.isError).toBeFalsy();
        expect(f.bridge!.calls).toHaveLength(1);
      } finally { await client.close(); await current?.h.close(); for (const c of current?.cleanup ?? []) await c(); current = undefined; }
    }
  });
});

describe('hosted MCP: tool calls that outlast ChatGPT\'s ~60 s patience', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('create_quote answers "still running" quickly, joins the same job on repeat, and never starts a second quote', async () => {
    const f = await start({ withBridge: true, backgroundWaitMs: 150 });
    let quotes = 0;
    const orig = f.h.retail.quote.bind(f.h.retail);
    f.h.retail.quote = async (...args: Parameters<typeof orig>) => { quotes++; await sleep(700); return orig(...args); };
    const client = await mcp(f, (await fullGrant(f)).tokens.access_token);
    try {
      const found = await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } }) as any;
      const args = { offerId: found.structuredContent.offers[0].offerId, fulfillment: retailFulfillment };
      const t0 = Date.now();
      const first = await client.callTool({ name: 'create_quote', arguments: args }) as any;
      expect(Date.now() - t0).toBeLessThan(600);
      expect(first.isError).toBeFalsy();
      expect(first.structuredContent).toMatchObject({ status: 'quote_pending', retryAfterSeconds: 20 });
      expect(first.content[0].text).toMatch(/call create_quote again with EXACTLY the same offerId and fulfillment/);
      expect((await client.callTool({ name: 'create_quote', arguments: args }) as any).structuredContent.status).toBe('quote_pending');
      await sleep(800);
      const done = await client.callTool({ name: 'create_quote', arguments: args }) as any;
      expect(done.structuredContent.quote.quoteId).toMatch(/^quo_/);
      expect(done.content[0].text).toMatch(/Exact quote for/);
      const again = await client.callTool({ name: 'create_quote', arguments: args }) as any;
      expect(again.structuredContent.quote.quoteId).toBe(done.structuredContent.quote.quoteId);
      expect(quotes).toBe(1);
      expect((await f.h.gw.db.all('SELECT id FROM quotes')).length).toBe(1);
    } finally { await client.close(); }
  });

  for (const [name, delays, expectedStatus] of [
    ['a payer that is slow before it has paid', { payStartDelayMs: 900 }, 'payment_in_progress'],
    ['a payer that has paid but is slow to answer', { payResponseDelayMs: 900 }, 'execution_pending'],
  ] as const) {
    it(`buy returns promptly with ${name}, never repeats the payment, and get_purchase follows it`, async () => {
      const f = await start({ withBridge: true, backgroundWaitMs: 150, ...delays });
      const client = await mcp(f, (await fullGrant(f)).tokens.access_token);
      try {
        const found = await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } }) as any;
        const q = (await client.callTool({ name: 'create_quote', arguments: { offerId: found.structuredContent.offers[0].offerId, fulfillment: retailFulfillment } }) as any).structuredContent.quote;
        const args = { quoteId: q.quoteId, selectedFundingOptionId: q.fundingOptions[0].fundingOptionId, maxTotal: q.payablePrincipal, quoteDigest: q.digest };
        const t0 = Date.now();
        const first = await client.callTool({ name: 'buy', arguments: args }) as any;
        expect(Date.now() - t0).toBeLessThan(700);
        expect(first.isError).toBeFalsy();
        expect(first.structuredContent.status).toBe(expectedStatus);
        expect(first.structuredContent.payment).toMatchObject({ attempted: true, inProgress: true });
        if (expectedStatus === 'payment_in_progress') expect(first.content[0].text).toMatch(/Do NOT call buy again/);
        expect(first.content[0].text).not.toMatch(/ORDER CONFIRMED/);
        const pid = first.structuredContent.purchase.purchaseId;
        const again = await client.callTool({ name: 'buy', arguments: args }) as any;
        expect(again.structuredContent.purchase.purchaseId).toBe(pid);
        await sleep(1300);
        const polled = await client.callTool({ name: 'get_purchase', arguments: { purchaseId: pid } }) as any;
        expect(polled.structuredContent.purchase.paymentState).not.toBe('not_received');
        expect(f.bridge!.calls).toEqual([pid]);
        expect((await f.h.gw.db.all('SELECT * FROM funding_evidence')).length).toBe(1);
        expect((await f.h.gw.db.all('SELECT id FROM purchases')).length).toBe(1);
      } finally { await client.close(); }
    });
  }
});
