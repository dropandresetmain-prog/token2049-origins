import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { BridgeClient } from '../../src/channels/mcp/bridge.js';

const servers: Server[] = [];
afterEach(async () => { for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r())); });

async function bridgeReplying(body: unknown) {
  const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r)); servers.push(server);
  return new BridgeClient('cardano', { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, token: 'cardano-bridge-secret-0123456789' });
}

describe('payer bridge success with a pending outcome (no funding evidence yet)', () => {
  it.each([
    ['omitted transferReference', { ok: true, payment: {} }],
    ['explicit null transferReference (older payer build)', { ok: true, payment: { transferReference: null } }],
    ['no payment object', { ok: true }],
  ])('is canonical success with %s, never bridge_bad_response', async (_n, body) => {
    expect(await (await bridgeReplying(body)).pay('pur_ABCDEFGHIJKLMNOP')).toEqual({ ok: true, transferReference: null });
  });
  it('still returns a transferReference when the payer knows one', async () => {
    expect(await (await bridgeReplying({ ok: true, payment: { transferReference: 'a'.repeat(64) } })).pay('pur_ABCDEFGHIJKLMNOP')).toEqual({ ok: true, transferReference: 'a'.repeat(64) });
  });
});
