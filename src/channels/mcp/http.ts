import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpConfig } from './config.js';
import { createMcpServer } from './server.js';
import type { BackgroundJobs } from './tools.js';

export const MAX_BODY_BYTES = 1_000_000;

/** Loopback-only authority check (DNS-rebinding defence): Host must be 127.0.0.1 / localhost / [::1]. */
function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  return /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(hostHeader);
}

function isLoopbackOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients send no Origin
  try {
    return isLoopbackHost(new URL(origin).host);
  } catch {
    return false;
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
}

export async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

/**
 * Serve one stateless Streamable HTTP POST: bounded body, fresh server + transport per request (no session to hijack),
 * safe errors. Callers have already authenticated the request and validated Host/Origin.
 */
export async function serveMcpPost(config: McpConfig, req: IncomingMessage, res: ServerResponse, opts: { hosted?: { resourceMetadataUrl: string }; background?: BackgroundJobs } = {}): Promise<void> {
  let body: unknown;
  try {
    body = await readBody(req);
  } catch {
    return sendJson(res, 400, { jsonrpc: '2.0', error: { code: -32700, message: 'invalid request body' }, id: null });
  }
  const mcp = createMcpServer(config, opts);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    void transport.close();
    void mcp.close();
  });
  await mcp.connect(transport);
  await transport.handleRequest(req, res, body);
}

/**
 * Streamable HTTP listener on 127.0.0.1 at `/mcp`. Stateless: each POST gets a fresh server+transport,
 * so there is no session to hijack. Anyone who can reach this port acts as the configured gateway
 * customer, which is why it binds to loopback only and checks Host/Origin.
 */
export async function startMcpHttpServer(config: McpConfig, port: number): Promise<{ server: Server; url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    void (async () => {
      if (!isLoopbackHost(req.headers.host) || !isLoopbackOrigin(req.headers.origin)) {
        return sendJson(res, 403, { jsonrpc: '2.0', error: { code: -32000, message: 'forbidden host or origin' }, id: null });
      }
      if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/mcp') return sendJson(res, 404, { error: 'not found' });
      if (req.method !== 'POST') {
        // Stateless mode has no server-initiated stream and no session to delete.
        res.setHeader('allow', 'POST');
        return sendJson(res, 405, { jsonrpc: '2.0', error: { code: -32000, message: 'method not allowed' }, id: null });
      }
      await serveMcpPost(config, req, res);
    })().catch(() => {
      if (!res.headersSent) sendJson(res, 500, { jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const actual = (server.address() as AddressInfo).port;
  return {
    server,
    url: `http://127.0.0.1:${actual}/mcp`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
