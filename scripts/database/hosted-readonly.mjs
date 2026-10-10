#!/usr/bin/env node
/** Non-spending database-cutover verifier: OAuth/PKCE, MCP discovery and historical purchase readback only. No provider search, quote, buy, payment or signing call. */
import { createHash, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { BACKUP,connect,privateWrite } from './migration-tools.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const { values } = parseArgs({ options: { base: { type: 'string' } } });
const base = (values.base ?? '').replace(/\/+$/, '');
if (base !== 'https://token2049-origins.onrender.com') { process.stderr.write('Only the existing authorized Capsule origin is permitted.\n'); process.exit(2); }
const passcode = readFileSync('C:/Dev/token2049-setup/secrets/hosted-demo/mcp-owner-passcode','utf8').trim();
if (passcode.length < 16) {
  process.stderr.write('usage: node --import tsx scripts/database/hosted-readonly.mjs --base https://host\n');
  process.exit(2);
}
const mcpUrl = `${base}/mcp`;
const redirect = 'https://chatgpt.com/connector_platform_oauth_redirect';
let failed = 0;
const check = (name, ok, extra = '') => { process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}\n`); if (!ok) failed++; return ok; };
const b64 = (b) => b.toString('base64url');


const unauth = await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
const challenge = unauth.headers.get('www-authenticate') ?? '';
check('unauthenticated POST /mcp -> 401 with resource_metadata challenge', unauth.status === 401 && /resource_metadata="[^"]+oauth-protected-resource/.test(challenge), `status=${unauth.status}`);

const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource/mcp`)).json().catch(() => ({}));
check('protected-resource metadata names this MCP resource', prm.resource === mcpUrl, `resource=${prm.resource}`);
const as = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json().catch(() => ({}));
check('authorization server advertises S256 PKCE and registration', Array.isArray(as.code_challenge_methods_supported) && as.code_challenge_methods_supported.includes('S256') && !!as.registration_endpoint);
check('purchases:fund is not grantable', !(as.scopes_supported ?? []).includes('purchases:fund'));

const evil = await fetch(mcpUrl, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', origin: 'https://evil.example', authorization: 'Bearer x' }, body: '{}' });
check('foreign Origin is refused before authentication', evil.status === 403, `status=${evil.status}`);

const reg = await fetch(as.registration_endpoint ?? `${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Capsule smoke test', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
const client = await reg.json().catch(() => ({}));
check('dynamic client registration', reg.status === 201 && !!client.client_id);

const verifier = b64(randomBytes(32));
const challengeS256 = b64(createHash('sha256').update(verifier).digest());
const authz = new URLSearchParams({ response_type: 'code', client_id: client.client_id ?? '', redirect_uri: redirect, code_challenge: challengeS256, code_challenge_method: 'S256', state: 'smoke', resource: mcpUrl });
const page = await fetch(`${as.authorization_endpoint ?? base + '/authorize'}?${authz}`, { redirect: 'manual' });
const requestId = /name="request_id" value="([^"]+)"/.exec(await page.text())?.[1];
check('authorize renders the owner consent page', page.status === 200 && !!requestId);

const consent = await fetch(`${base}/oauth/consent`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request_id: requestId ?? '', passcode, decision: 'approve' }) });
const code = new URL(consent.headers.get('location') ?? 'https://invalid.example').searchParams.get('code');
check('owner passcode accepted, authorization code issued', consent.status === 302 && !!code);

const tokenReq = (extra) => fetch(as.token_endpoint ?? `${base}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.client_id ?? '', ...extra }) });
const tokenRes = await tokenReq({ grant_type: 'authorization_code', code: code ?? '', code_verifier: verifier, redirect_uri: redirect, resource: mcpUrl });
const tokens = await tokenRes.json().catch(() => ({}));
check('token exchange with PKCE verifier', tokenRes.status === 200 && !!tokens.access_token, `scope=${tokens.scope}`);
check('granted scope excludes purchases:fund', typeof tokens.scope === 'string' && !tokens.scope.includes('purchases:fund'));
check('replayed authorization code is rejected', (await tokenReq({ grant_type: 'authorization_code', code: code ?? '', code_verifier: verifier, redirect_uri: redirect })).status === 400);
// The replay revokes that grant (OAuth 2.1), so run the MCP checks on a fresh grant.
const fresh = await (async () => {
  const p = await fetch(`${base}/authorize?${new URLSearchParams({ ...Object.fromEntries(authz), code_challenge: challengeS256 })}`, { redirect: 'manual' });
  const id = /name="request_id" value="([^"]+)"/.exec(await p.text())?.[1];
  const c = await fetch(`${base}/oauth/consent`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ request_id: id ?? '', passcode, decision: 'approve' }) });
  const cd = new URL(c.headers.get('location') ?? 'https://invalid.example').searchParams.get('code');
  return (await tokenReq({ grant_type: 'authorization_code', code: cd ?? '', code_verifier: verifier, redirect_uri: redirect, resource: mcpUrl })).json().catch(() => ({}));
})();

if (fresh.access_token) {
  const mcp = new Client({ name: 'capsule-smoke', version: '1.0.0' });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers: { authorization: `Bearer ${fresh.access_token}` } } }));
  check('MCP initialize', !!mcp.getServerVersion(), `server=${mcp.getServerVersion()?.name}`);
  const { tools } = await mcp.listTools();
  check('tools/list exposes the four Capsule tools', ['buy', 'create_quote', 'find_offers', 'get_purchase'].every((n) => tools.some((t) => t.name === n)));
  check('every tool declares an oauth2 security scheme', tools.every((t) => t._meta?.securitySchemes?.[0]?.type === 'oauth2'));
  check('instructions require a top-3 shortlist and explicit choices', /best 3 viable options/.test(mcp.getInstructions() ?? '') && /explicitly select a payment rail/.test(mcp.getInstructions() ?? ''));
  const db=await connect(readFileSync(BACKUP+'/neon-authoritative-app-url','utf8'));
  let purchase;
  try {purchase=(await db.query('SELECT id,customer_id FROM purchases ORDER BY created_at LIMIT 1')).rows[0];}finally{await db.end();}
  if(purchase){const found=await mcp.callTool({name:'get_purchase',arguments:{purchaseId:purchase.id}});check('historical get_purchase',!found.isError && found.structuredContent?.purchase?.state==='succeeded');}
  privateWrite(BACKUP+'/oauth-readonly-'+Date.now()+'.json',JSON.stringify({oauthPassed:failed===0,verifiedAt:new Date().toISOString(),existingMcpUrl:mcpUrl}));
  await mcp.close();
} else {
  check('second grant for MCP checks', false);
}
process.stdout.write(failed ? `\n${failed} check(s) failed\n` : '\nall checks passed (nothing was bought or paid)\n');
process.exit(failed ? 1 : 0);
