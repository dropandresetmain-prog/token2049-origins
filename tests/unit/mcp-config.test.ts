import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ConfigError, loadConfigFromEnv } from '../../src/channels/mcp/config.js';
import { GatewayClient } from '../../src/channels/mcp/client.js';
import { BridgeClient } from '../../src/channels/mcp/bridge.js';

const TOKEN = 'mcp-config-test-token-0123456789';
let dir: string;
let tokenFile: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcp-config-'));
  tokenFile = join(dir, 'token');
  writeFileSync(tokenFile, TOKEN);
});
afterAll(() => {
  unlinkSync(tokenFile);
  rmdirSync(dir);
});

function config(gatewayUrl: string, bridgeUrl?: string) {
  return loadConfigFromEnv({
    GATEWAY_URL: gatewayUrl,
    GATEWAY_TOKEN_FILE: tokenFile,
    ...(bridgeUrl ? { PAYER_BRIDGE_URL: bridgeUrl, PAYER_BRIDGE_TOKEN_FILE: tokenFile } : {}),
  });
}

const LOOPBACK_URLS = ['http://127.0.0.1:8080', 'http://localhost:8080', 'http://[::1]:8080', 'https://127.0.0.1:8080'];
const UNSAFE_BASES = [
  'https://user:password@gateway.example', 'https://user@gateway.example', 'https://@gateway.example',
  'https://gateway.example?token=secret', 'https://gateway.example?', 'https://gateway.example#section', 'https://gateway.example#',
  'https://gateway.example\\path', 'https:gateway.example', 'https:///gateway.example', 'https://gateway.example/base path',
  'https://gate\nway.example', 'htt\np://gateway.example', 'ftp://gateway.example', 'not-a-url',
];

describe('MCP credential destination configuration', () => {
  it.each([...LOOPBACK_URLS, 'https://gateway.example', 'https://gateway.example/base/'])('accepts gateway %s and normalizes trailing slash', (url) => {
    expect(config(url).gatewayUrl).toBe(new URL(url).toString().replace(/\/+$/, ''));
  });
  it.each(LOOPBACK_URLS)('accepts loopback payer bridge %s', (url) => {
    expect(config('https://gateway.example', `${url}/`).bridges?.cardano).toEqual({ url, token: TOKEN });
  });
  it.each(['http://gateway.example', 'http://192.168.1.10', 'http://0.0.0.0', 'http://localhost.evil.example', 'http://[::ffff:127.0.0.1]'])('refuses nonloopback cleartext gateway %s', (url) => {
    expect(() => config(url)).toThrow(ConfigError);
  });
  it.each(['https://gateway.example', 'http://192.168.1.10', 'https://192.168.1.10', 'http://0.0.0.0', 'https://localhost.evil.example', 'http://localhost.'])('refuses remote or ambiguous payer bridge %s', (url) => {
    expect(() => config('https://gateway.example', url)).toThrow(ConfigError);
  });
  it.each(UNSAFE_BASES)('refuses unsafe gateway base %s without echoing it', (url) => {
    try { config(url); throw new Error('configuration unexpectedly accepted'); }
    catch (e) { expect(e).toBeInstanceOf(ConfigError); expect((e as Error).message).not.toContain(url); }
  });
  it.each([
    'http://user:password@localhost:8080', 'http://@127.0.0.1:8080', 'http://localhost:8080?token=secret',
    'http://localhost:8080?', 'http://localhost:8080#section', 'http://localhost:8080#', 'http://localhost:8080\\path',
  ])('refuses unsafe loopback bridge base %s', (url) => {
    expect(() => config('https://gateway.example', url)).toThrow(ConfigError);
  });
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}
const close = (server: Server) => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

describe('MCP bearer redirect protection', () => {
  it('wake pings the unauthenticated payer /health without sending the bridge token and never throws', async () => {
    const seen: Array<{ url?: string; authorization?: string }> = [];
    const payer = createServer((req, res) => { seen.push({ url: req.url, authorization: req.headers.authorization }); res.writeHead(200).end('{"ok":true}'); });
    try {
      const url = await listen(payer);
      BridgeClient.fromConfig(config(url, url))[0]!.wake();
      await vi.waitFor(() => expect(seen).toEqual([{ url: '/health', authorization: undefined }]));
      expect(() => new BridgeClient('cardano', { url: 'http://127.0.0.1:1', token: TOKEN }).wake()).not.toThrow();
    } finally {
      await close(payer);
    }
  });

  it.each([301, 302, 303, 307, 308])('gateway and bridge refuse HTTP %i redirects without reaching the destination', async (status) => {
    let redirectedCalls = 0;
    const destination = createServer((_req, res) => { redirectedCalls++; res.writeHead(200).end('{}'); });
    const destinationUrl = await listen(destination);
    const requests: Array<{ method?: string; authorization?: string }> = [];
    const redirector = createServer((req, res) => {
      requests.push({ method: req.method, authorization: req.headers.authorization });
      res.writeHead(status, { location: `${destinationUrl}/capture` }).end();
    });
    try {
      const url = await listen(redirector);
      const cfg = config(url, url);
      await expect(new GatewayClient(cfg).getPurchase('purchase-review')).rejects.toMatchObject({ code: 'gateway_unreachable' });
      await expect(BridgeClient.fromConfig(cfg)[0]!.pay('purchase-review')).resolves.toMatchObject({ ok: false, code: 'bridge_unreachable' });
      expect(requests).toEqual([{ method: 'GET', authorization: `Bearer ${TOKEN}` }, { method: 'POST', authorization: `Bearer ${TOKEN}` }]);
      expect(redirectedCalls).toBe(0);
    } finally {
      await close(redirector);
      await close(destination);
    }
  });
});
