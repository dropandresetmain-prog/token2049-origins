import { describe, it, expect, afterEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHarness, retailIntent, retailFulfillment, type Harness } from '../support/harness.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { createHostedMcp } from '../../src/channels/hosted-mcp/router.js';
import type { HostedMcpConfig } from '../../src/channels/hosted-mcp/config.js';
import { FundingSource } from '../../src/contracts/presentation.js';

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

interface Fixture { h: Harness; base: string; mcpUrl: string; cleanup: Array<() => Promise<void>>; bridge?: { calls: string[] } }

let current: Fixture | undefined;
afterEach(async () => {
  for (const c of current?.cleanup ?? []) await c();
  await current?.h.close();
  current = undefined;
});

/** Gateway + hosted MCP on one listener, with an optional fake Cardano payer on the "private network". */
async function start(opts: { withBridge?: boolean; allowedOrigins?: string[] } = {}): Promise<Fixture> {
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
        if (req.headers.authorization !== `Bearer ${BRIDGE_TOKEN}`) return send(401, { ok: false, error: { code: 'unauthenticated', message: 'bad token' } });
        if (req.url === '/status') return send(200, { ok: true, source: FundingSource.parse({ sourceId: 'src_' + 'a'.repeat(32), rail: 'cardano', network: 'cardano:preprod', publicAddress: PAYER_ADDRESS, displayAddress: PAYER_ADDRESS.slice(0, 14) + '…' + PAYER_ADDRESS.slice(-6), assetId: h.funding.acceptedAsset().assetId, readiness: 'configured' }) });
        const { purchaseId } = JSON.parse(raw) as { purchaseId: string };
        bridge.calls.push(purchaseId);
        const got = await h.call('GET', `/v1/purchases/${purchaseId}`, { token: payerToken });
        const amount = got.body.purchase.fundingRequirement.amount.amountBaseUnits as string;
        const fund = await h.call('POST', `/v1/purchases/${purchaseId}/fund`, { token: payerToken, headers: { 'payment-signature': `fixture:hosted-${purchaseId}:${amount}` } });
        if (fund.status !== 202) return send(502, { ok: false, error: { code: fund.body.error.code, message: fund.body.error.message } });
        send(200, { ok: true, payment: { transferReference: `hosted-${purchaseId}` } });
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    bridgeUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    cleanup.push(() => new Promise<void>((r) => server.close(() => r())));
  }
  const config: HostedMcpConfig = {
    publicUrl: new URL(base), allowedOrigins: opts.allowedOrigins ?? ['https://chatgpt.com'], ownerPasscode: PASSCODE,
    customerId: 'cus_HOSTEDTESTDEMO', apiClientId: 'cli_HOSTEDTESTDEMO', extraRedirectUris: [], gatewayUrl: base,
    ...(bridgeUrl ? { cardanoBridge: { url: bridgeUrl, token: BRIDGE_TOKEN } } : {}),
  };
  h = await startHarness({ port, extraRouters: (core) => createHostedMcp({ db: core.deps.db, config }).mounts });
  payerToken = (await createClient(h.gw.db, { customerId: config.customerId, displayName: 'payer', channel: 'test', label: 'hosted-payer', scopes: ['purchases:read', 'purchases:fund'] }, new Date().toISOString())).token;
  return (current = { h, base, mcpUrl: `${base}/mcp`, cleanup, bridge });
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
      expect(found.structuredContent.selection).toMatchObject({ markOneRecommended: true, askUserToChoose: true });
      expect(found.content[0].text).toMatch(/Recommended/);
      expect(found.content[0].text).toMatch(/do not call create_quote yet/);
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

  it('ends with "Order confirmed" only after the purchase state proves retail success', async () => {
    const f = await start({ withBridge: true });
    const g = await fullGrant(f);
    const client = await mcp(f, g.tokens.access_token);
    try {
      const found = await client.callTool({ name: 'find_offers', arguments: { intent: retailIntent() } }) as any;
      const quoted = await client.callTool({ name: 'create_quote', arguments: { offerId: found.structuredContent.offers[0].offerId, fulfillment: retailFulfillment } }) as any;
      const quote = quoted.structuredContent.quote;
      const bought = await client.callTool({ name: 'buy', arguments: { quoteId: quote.quoteId, selectedFundingOptionId: quote.fundingOptions[0].fundingOptionId, maxTotal: quote.payablePrincipal, quoteDigest: quote.digest } }) as any;
      expect(bought.structuredContent.status).toBe('execution_pending');
      expect(bought.structuredContent.orderConfirmation).toBeUndefined();
      expect(bought.content[0].text).not.toMatch(/Order confirmed/);
      const pid = bought.structuredContent.purchase.purchaseId;
      const pending = await client.callTool({ name: 'get_purchase', arguments: { purchaseId: pid } }) as any;
      expect(pending.structuredContent.orderConfirmation).toBeUndefined();
      expect(pending.content[0].text).not.toMatch(/Order confirmed/);

      await f.h.gw.worker.tick();
      const done = await client.callTool({ name: 'get_purchase', arguments: { purchaseId: pid } }) as any;
      expect(done.structuredContent.purchase.state).toBe('succeeded');
      const c = done.structuredContent.orderConfirmation;
      expect(c.headline).toBe('Order confirmed');
      expect(c.orderReference).toBe(done.structuredContent.purchase.providerReference);
      expect(c.receiptId).toBe(done.structuredContent.purchase.receipt.receiptId);
      expect(c.payments[0]).toMatchObject({ rail: 'cardano', transferReference: `hosted-${pid}` });
      expect(done.content[0].text).toMatch(/^Order confirmed\./);
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
});
