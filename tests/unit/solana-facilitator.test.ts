import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { trustedFacilitator, parseSolanaConfig } from '../../src/funding/solana/config.js';
import { createSolanaFacilitatorClient } from '../../src/funding/solana/facilitator.js';
import { scenario } from '../support/solana.js';

const origin = 'https://facilitator.example.com';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
describe('Solana facilitator trust and transport', () => {
  it.each(['http://127.0.0.1:18992', 'http://localhost:18992', 'http://[::1]:18992'])('accepts loopback %s', url => expect(trustedFacilitator(url)).toBe(true));
  it('accepts only the explicitly configured HTTPS origin', async () => {
    const s = await scenario();
    expect(parseSolanaConfig({ ...s.env, SOLANA_FACILITATOR_URL: origin, SOLANA_FACILITATOR_TRUSTED_ORIGIN: origin }).ok).toBe(true);
    expect(parseSolanaConfig({ ...s.env, SOLANA_FACILITATOR_URL: origin }).ok).toBe(false);
    expect(parseSolanaConfig({ ...s.env, SOLANA_FACILITATOR_TRUSTED_ORIGIN: 'http://remote.example.com' }).ok).toBe(false);
  });
  it.each(['https://other.example.com', 'https://facilitator.example.com.evil.test', 'https://facilitator.example.com:444', 'http://facilitator.example.com', origin + '/prepare', origin + '?a=1', origin + '#x', 'https://user@facilitator.example.com'])('rejects untrusted URL %s', url => expect(trustedFacilitator(url, origin)).toBe(false));
  it('preserves bearer auth, routes and x402 request bodies', async () => {
    const s = await scenario(), dir = mkdtempSync(join(tmpdir(), 'solana-http-')); dirs.push(dir);
    const tokenFile = join(dir, 'token'); writeFileSync(tokenFile, 'test-bearer\n');
    const parsed = parseSolanaConfig({ ...s.env, SOLANA_FACILITATOR_TOKEN_FILE: tokenFile }); if (!parsed.ok) throw new Error('test config');
    const transport = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('/supported') ? { kinds: [], extensions: [], signers: {} } : url.endsWith('/verify') ? { isValid: true } : { success: true, transaction: 'signature', network: 'solana:devnet' })));
    const client = createSolanaFacilitatorClient(parsed.config, transport as typeof fetch);
    const payload = JSON.parse(Buffer.from(s.header, 'base64').toString());
    await client.getSupported(); await client.verify(payload, payload.accepted); await client.settle(payload, payload.accepted);
    expect(transport.mock.calls).toHaveLength(3);
    for (const [url, init] of transport.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).toMatch(/\/(supported|verify|settle)$/); expect(init.redirect).toBe('error');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-bearer');
      if (init.body) expect(JSON.parse(String(init.body))).toEqual({ x402Version: 2, paymentPayload: payload, paymentRequirements: payload.accepted });
    }
    writeFileSync(tokenFile, ''); await expect(client.getSupported()).rejects.toThrow('authentication'); expect(transport).toHaveBeenCalledTimes(3);
  });
  it.each(['supported', 'verify', 'settle'] as const)('rejects real %s redirects without sending bearer credentials to the target', async route => {
    let targetCalls = 0;
    const server = createServer((req, res) => { if (req.url === '/' + route) { res.writeHead(307, { Location: '/target' }); res.end(); } else { targetCalls++; res.end('{}'); } });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const s = await scenario(), dir = mkdtempSync(join(tmpdir(), 'solana-redirect-')); dirs.push(dir);
      const tokenFile = join(dir, 'token'); writeFileSync(tokenFile, 'test-bearer');
      const addr = server.address(); if (!addr || typeof addr === 'string') throw new Error('test server');
      const parsed = parseSolanaConfig({ ...s.env, SOLANA_FACILITATOR_TOKEN_FILE: tokenFile, SOLANA_FACILITATOR_URL: 'http://127.0.0.1:' + addr.port }); if (!parsed.ok) throw new Error('test config');
      const client = createSolanaFacilitatorClient(parsed.config), payload = JSON.parse(Buffer.from(s.header, 'base64').toString());
      await expect(route === 'supported' ? client.getSupported() : client[route](payload, payload.accepted)).rejects.toThrow(); expect(targetCalls).toBe(0);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
