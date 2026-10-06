/**
 * Local payer bridge: lets a separate process (MCP `buy` tool, ChatGPT action relay, Sokosumi worker) request
 * a bounded payment WITHOUT holding keys. It is not a signing oracle: it only pays an existing gateway
 * purchase, through the same policy as the CLI (asset/network/payTo/amount caps, cumulative ledger).
 *
 *   POST /pay  { "purchaseId": "pur_..." }   Authorization: Bearer <contents of PAYER_BRIDGE_TOKEN_FILE>
 *     200 { ok:true, purchase, payment:{ transferReference } }
 *     4xx { ok:false, error:{ code, message } }
 *
 * Listens on 127.0.0.1 only by default. The hosted deployment opts into `access.mode = 'private'`: bound to the platform's
 * private network, accepting only private-range peers and an exact Host allowlist (never a public name, never a browser).
 * One payment at a time (mutex). Responses never include signed payloads.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadBridgeConfig, loadPayerConfig, readSecretFile } from './config.js';
import { redact } from '../../src/infrastructure/redact.js';
import { Payer, PayerError, type PayerErrorCode } from './payer.js';
import { FundingSource } from '../../src/contracts/presentation.js';

const STATUS: Record<PayerErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  policy_violation: 403,
  not_found: 404,
  conflict: 409,
  payment_rejected: 422,
  gateway_unreachable: 502,
  internal: 500,
};

/** What a bridge needs from a payer: pay one existing gateway purchase. `purchase` is optional (callers re-read the gateway). */
export interface BridgePayer {
  pay(purchaseId: string): Promise<{ purchase?: unknown; transferReference: string | null; resumed: boolean }>;
}

/** Where a bridge may be reached from. Loopback is the default; `private` is for a private-network-only hosted service. */
export type BridgeAccess = { mode: 'loopback' } | { mode: 'private'; allowedHosts: string[] };

export interface BridgeDeps {
  payer: BridgePayer;
  access?: BridgeAccess;
  source?: () => Promise<FundingSource>;
  /** Bearer token callers must present. */
  token: string;
  log?: (e: Record<string, unknown>) => void;
}

/** Loopback or RFC 1918 / ULA peers only; used in private mode as defence in depth behind the platform's network isolation. */
export function isPrivatePeer(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.replace(/^::ffff:/i, '').toLowerCase();
  if (a === '127.0.0.1' || a === '::1') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const [x, y] = [Number(v4[1]), Number(v4[2])];
    return x === 10 || (x === 172 && y >= 16 && y <= 31) || (x === 192 && y === 168);
  }
  return /^f[cd][0-9a-f]{2}:/.test(a);
}

function sameToken(presented: string, expected: string): boolean {
  // Compare digests so length differences leak nothing and the comparison is constant time.
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

function fail(res: ServerResponse, code: PayerErrorCode, message: string): void {
  send(res, STATUS[code], { ok: false, error: { code, message } });
}

async function readBody(req: IncomingMessage, limit = 4096): Promise<string> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req) {
    n += (c as Buffer).length;
    if (n > limit) throw new PayerError('invalid_request', 'request body too large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function createBridge(deps: BridgeDeps): Server {
  if (deps.token.length < 24) throw new Error('bridge token must contain at least 24 characters');
  const log = deps.log ?? (() => undefined);
  // Serialize payments: a promise chain is a sufficient mutex for a single process.
  let tail: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const remote = req.socket.remoteAddress;
        const access = deps.access ?? { mode: 'loopback' };
        if (access.mode === 'private') {
          if (!isPrivatePeer(remote)) return fail(res, 'unauthenticated', 'bridge is private-network only');
          if (!access.allowedHosts.includes((req.headers.host ?? '').toLowerCase()) || req.headers.origin) {
            return fail(res, 'unauthenticated', 'bridge requires a private non-browser caller');
          }
        } else {
          if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') return fail(res, 'unauthenticated', 'bridge is local only');
          if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(req.headers.host ?? '') || req.headers.origin) {
            return fail(res, 'unauthenticated', 'bridge requires a local non-browser caller');
          }
        }
        const path = req.url ?? '';
        if (req.method === 'GET' && path === '/health') return send(res, 200, { ok: true });
        if (path !== '/pay' && path !== '/status') return fail(res, 'not_found', 'no such route');

        const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? '');
        if (!m || !sameToken(m[1]!.trim(), deps.token)) return fail(res, 'unauthenticated', 'missing or invalid bridge token');
        if (path === '/status') {
          if (req.method !== 'GET') return fail(res, 'invalid_request', 'use GET');
          if (!deps.source) return send(res, 200, { ok: true, source: null });
          // Strict allowlist rejects accidental secret/config fields rather than echoing the signer object.
          return send(res, 200, { ok: true, source: FundingSource.parse(await deps.source()) });
        }
        if (req.method !== 'POST') return fail(res, 'invalid_request', 'use POST');

        let purchaseId: unknown;
        try {
          const body: unknown = JSON.parse(await readBody(req));
          if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => k !== 'purchaseId')) {
            return fail(res, 'invalid_request', 'body must contain only purchaseId');
          }
          purchaseId = (body as { purchaseId?: unknown }).purchaseId;
        } catch (e) {
          if (e instanceof PayerError) return fail(res, e.code, e.message);
          return fail(res, 'invalid_request', 'body must be JSON');
        }
        if (typeof purchaseId !== 'string') return fail(res, 'invalid_request', 'purchaseId is required');

        const r = await exclusive(() => deps.payer.pay(purchaseId as string));
        log({ type: 'bridge.paid', purchaseId, resumed: r.resumed });
        return send(res, 200, { ok: true, ...(r.purchase !== undefined ? { purchase: redact(r.purchase) } : {}), payment: { transferReference: r.transferReference } });
      } catch (e) {
        if (e instanceof PayerError) {
          log({ type: 'bridge.refused', code: e.code });
          return fail(res, e.code, e.message);
        }
        log({ type: 'bridge.error' });
        return fail(res, 'internal', 'payer error');
      }
    })();
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 32;
  return server;
}

/** Bind a private-network bridge on all interfaces; reachability is restricted by the platform plus isPrivatePeer/Host checks. */
export async function listenPrivate(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
}

/** 127.0.0.1 only: a bridge can cause spending and must not be reachable off-host. */
export async function listenLoopback(server: Server, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

export async function startBridge(env: NodeJS.ProcessEnv): Promise<Server> {
  const b = loadBridgeConfig(env);
  const token = readSecretFile(b.tokenFile, 'PAYER_BRIDGE_TOKEN_FILE');
  if (token.length < 24) throw new Error('PAYER_BRIDGE_TOKEN_FILE must hold a token of at least 24 characters');
  const payer = new Payer({ config: loadPayerConfig(env), log: (e) => process.stdout.write(`${JSON.stringify(e)}\n`) });
  const server = createBridge({ payer, token, source: () => payer.source(), log: (e) => process.stdout.write(`${JSON.stringify(e)}\n`) });
  await listenLoopback(server, b.port);
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startBridge(process.env)
    .then((s) => {
      const a = s.address();
      process.stdout.write(`payer bridge listening on 127.0.0.1:${typeof a === 'object' && a ? a.port : '?'}\n`);
    })
    .catch((e) => {
      process.stderr.write(`${e instanceof Error ? e.message : 'bridge failed to start'}\n`);
      process.exitCode = 1;
    });
}
