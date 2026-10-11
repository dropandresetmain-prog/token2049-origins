import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BridgeClient } from '../../src/channels/mcp/bridge.js';
import { PAYER_WAKE_URL, PAYER_WAKE_DESTINATION, loadPayerWake, secretsOf } from '../../src/channels/mcp/config.js';
import { loadHostedMcpConfig } from '../../src/channels/hosted-mcp/config.js';
const TOKEN = 'payment-credential-fixture';
const WAKE = 'b'.repeat(64);
const asleep = () => new Response('private platform body', { status: 429, headers: { 'x-render-routing': 'hibernate-rate-limited' } });
const woke = () => Response.json({ ok: true, category: 'upstream_2xx', upstreamStatus: 200, contentType: 'json', renderRouting: 'none', durationMs: 1, paymentAttempted: false });
const ready = () => Response.json({ ok: true, source: null });
function harness(responses: Array<() => Response | Promise<Response>>, wakeUrl = PAYER_WAKE_URL) {
  const calls: Array<{url:string; init?:RequestInit}> = [], events: unknown[] = [], waits: number[] = [];
  const client = new BridgeClient('sui', { url: PAYER_WAKE_DESTINATION, token: TOKEN, wake: { url: wakeUrl, token: WAKE },
    fetch: async (input, init) => { calls.push({url:String(input),init}); const next=responses.shift(); if (!next) throw Error('unexpected extra call'); return next(); },
    statusTimeoutMs: 90_000, diag: e=>events.push(e), wait: async ms=>{waits.push(ms);} });
  return {client,calls,events,waits};
}
describe('optional fixed health wake before payment authority', () => {
  it('wakes only the refused selected payer and then verifies direct authenticated readiness', async () => {
    const h=harness([asleep,woke,ready]);
    expect(await h.client.prepare()).toBe(true);
    expect(h.calls.map(c=>c.url)).toEqual([PAYER_WAKE_DESTINATION+'/status',PAYER_WAKE_URL,PAYER_WAKE_DESTINATION+'/status']);
    expect(h.calls[1]!.init).toMatchObject({method:'POST',redirect:'error'});
    expect(h.calls[1]!.init?.body).toBeUndefined();
    expect([...new Headers(h.calls[1]!.init?.headers)]).toEqual([['authorization','Bearer '+WAKE]]);
    for(const c of [h.calls[0]!,h.calls[2]!])expect(new Headers(c.init?.headers).get('authorization')).toBe('Bearer '+TOKEN);
    expect(JSON.stringify(h.events)).not.toContain(WAKE);expect(JSON.stringify(h.events)).not.toContain(TOKEN);
    expect(h.calls.some(c=>c.url.endsWith('/pay'))).toBe(false);
  });
  it('never wakes a warm payer',async()=>{const h=harness([ready]);expect(await h.client.prepare()).toBe(true);expect(h.calls).toHaveLength(1);});
  it.each([401,403])('never wakes after an authentication refusal %s',async status=>{const h=harness([()=>Response.json({ok:false},{status})]);expect(await h.client.prepare()).toBe(false);expect(h.calls).toHaveLength(1);});
  it('does not wake for an ordinary application throttle',async()=>{const h=harness([()=>Response.json({ok:false},{status:429}),ready]);expect(await h.client.prepare()).toBe(true);expect(h.calls.map(c=>c.url)).toEqual([PAYER_WAKE_DESTINATION+'/status',PAYER_WAKE_DESTINATION+'/status']);});
  it.each([429,503])('a failed wake %s fails closed without repeating the wake or paying',async status=>{const h=harness([asleep,()=>Response.json({ok:false},{status})]);expect(await h.client.prepare()).toBe(false);expect(h.calls).toHaveLength(2);});
  it('does not equate health success with authenticated readiness',async()=>{const h=harness([asleep,woke,()=>Response.json({ok:false},{status:401})]);expect(await h.client.prepare()).toBe(false);expect(h.calls).toHaveLength(3);});
  it('never retries a successful wake when direct readiness remains refused',async()=>{const h=harness([asleep,woke,...Array.from({length:11},()=>asleep)]);expect(await h.client.prepare()).toBe(false);expect(h.calls.filter(c=>c.url===PAYER_WAKE_URL)).toHaveLength(1);expect(h.calls.every(c=>!c.url.endsWith('/pay'))).toBe(true);});
  it('coalesces concurrent preparations into one wake',async()=>{let finish!:(v:Response)=>void;const h=harness([asleep,()=>new Promise(r=>{finish=r;}),ready]);const a=h.client.prepare(),b=h.client.prepare();while(!finish)await new Promise(r=>setTimeout(r,0));finish(woke());expect(await Promise.all([a,b])).toEqual([true,true]);expect(h.calls).toHaveLength(3);});
  it('refuses a changed wake destination before sending credentials',async()=>{const h=harness([asleep],'https://evil.invalid/wake');expect(await h.client.prepare()).toBe(false);expect(h.calls).toHaveLength(1);});
  it('respects Retry-After that exceeds the entire readiness budget',async()=>{const h=harness([()=>new Response('',{status:429,headers:{'x-render-routing':'hibernate-rate-limited','retry-after':'120'}})]);expect(await h.client.prepare()).toBe(false);expect(h.calls).toHaveLength(1);});
  it('refuses malformed wake success',async()=>{const h=harness([asleep,()=>Response.json({ok:true,paymentAttempted:true})]);expect(await h.client.prepare()).toBe(false);expect(h.calls).toHaveLength(2);});
});
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function configuration(over:Record<string,string|undefined>={}) {
 const root=mkdtempSync(join(tmpdir(),'wake-config-'));roots.push(root);
 const file=(name:string,value:string)=>{const path=join(root,name);writeFileSync(path,value);return path;};
 return {MCP_HOSTED_ENABLED:'true',MCP_PUBLIC_URL:'https://token2049-origins.onrender.com',PUBLIC_BASE_URL:'https://token2049-origins.onrender.com',
 MCP_OAUTH_OWNER_PASSCODE_FILE:file('owner','owner-fixture-0123456789'),MULTIWALLET_PAYER_URL:PAYER_WAKE_DESTINATION,MULTIWALLET_PAYER_TOKEN_FILE:file('payer',TOKEN),
 MCP_PAYER_WAKE_URL:PAYER_WAKE_URL,MCP_PAYER_WAKE_TOKEN_FILE:file('wake',WAKE),...over};
}
describe('dedicated wake configuration',()=>{
 it('loads only the fixed optional pair and scrubs its new secret',()=>{const c=loadHostedMcpConfig(configuration())!;expect(c.consolidatedBridge?.wake).toEqual({url:PAYER_WAKE_URL,token:WAKE});expect(secretsOf({gatewayUrl:'https://gateway.invalid',gatewayToken:'host-oauth-fixture',consolidatedBridge:c.consolidatedBridge})).toContain(WAKE);});
 it.each([{MCP_PAYER_WAKE_TOKEN_FILE:undefined},{MCP_PAYER_WAKE_URL:undefined},{MCP_PAYER_WAKE_URL:PAYER_WAKE_URL+'?target=x'},{MULTIWALLET_PAYER_URL:'https://other-payer.invalid'},{MULTIWALLET_PAYER_URL:undefined,MULTIWALLET_PAYER_TOKEN_FILE:undefined}])('rejects unsafe or partial configuration',over=>expect(()=>loadHostedMcpConfig(configuration(over))).toThrow());
 it('rejects reuse of a payment or host token',()=>{const env=configuration();const bridge={url:PAYER_WAKE_DESTINATION,token:WAKE};expect(()=>loadPayerWake(env,bridge,[])).toThrow(/distinct dedicated/);expect(()=>loadPayerWake(env,{url:PAYER_WAKE_DESTINATION,token:TOKEN},[WAKE])).toThrow(/distinct dedicated/);});
 it('rejects a short/nonhex wake secret without echoing it',()=>{const env=configuration();writeFileSync(env.MCP_PAYER_WAKE_TOKEN_FILE!,'sensitive-nonhex-fixture-secret');expect(()=>loadHostedMcpConfig(env)).toThrow(/64-character hex/);try{loadHostedMcpConfig(env);}catch(e){expect(String(e)).not.toContain('sensitive-nonhex-fixture-secret');}});
 it('remains absent by default',()=>{const c=loadHostedMcpConfig(configuration({MCP_PAYER_WAKE_URL:undefined,MCP_PAYER_WAKE_TOKEN_FILE:undefined}))!;expect(c.consolidatedBridge?.wake).toBeUndefined();});
});
