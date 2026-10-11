const DESTINATION = 'https://t2o-cardano-payer.onrender.com/health';
const PUBLIC_HOST = 'capsule-payer-wake-experiment.dropandreset-main.workers.dev';
// This diagnostic must finish before its independent caller's 110-second deadline.
// It does not change the deployed gateway's payment-preparation budget.
export const WAKE_UPSTREAM_TIMEOUT_MS = 90_000;
export interface WakeEnv {
  CAPSULE_WAKE_SECRET?: string;
  WAKE_RATE_LIMITER?: { limit(input: { key: string }): Promise<{ success: boolean }> };
}
type WakeResult = { ok: boolean; category: string; upstreamStatus?: number; contentType?: string; renderRouting?: string; durationMs?: number; paymentAttempted: false };
type Dependencies = { fetch?: typeof fetch; now?: () => number; log?: (event: Record<string, unknown>) => void };
function sameSecret(received: string, expected: string): boolean {
  if (received.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= received.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}
function reply(value: WakeResult, status: number): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}
/** Workerd supplies a stream even for Content-Length:0. Read at most one chunk, after authentication. */
async function emptyBody(request: Request): Promise<boolean> {
  const length = request.headers.get('content-length');
  if (length !== null && length !== '0') return false;
  if (request.body === null) return true;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('body_timeout')), 1000); }),
    ]);
    return first.done === true;
  } catch { return false; }
  finally { if (timer !== undefined) clearTimeout(timer); void reader.cancel().catch(() => undefined); }
}
/** Only transport availability is tested. A 2xx health response never authorizes a payment. */
export function createWakeHandler(deps: Dependencies = {}) {
  const f = deps.fetch ?? fetch, now = deps.now ?? Date.now;
  const log = deps.log ?? (event => console.log(JSON.stringify(event)));
  let pending: Promise<WakeResult> | undefined;
  const report = (event: Record<string, unknown>) => { try { log({ type: 'capsule_payer_wake', ...event }); } catch { /* Logs cannot affect availability. */ } };
  const probe = async (): Promise<WakeResult> => {
    const started = now();
    try {
      // No caller headers, body, credentials or destination are forwarded. One GET, with no redirects or retries.
      const response = await f(DESTINATION, {
        method: 'GET', redirect: 'manual', credentials: 'omit',
        headers: { accept: 'application/json', 'user-agent': 'Capsule-Wake/0.1', 'cache-control': 'no-store' },
        signal: AbortSignal.timeout(WAKE_UPSTREAM_TIMEOUT_MS),
      });
      void response.body?.cancel().catch(() => undefined);
      const mime = response.headers.get('content-type') ?? '';
      const contentType = mime.includes('application/json') ? 'json' : mime.includes('text/html') ? 'html' : 'other';
      const rawRouting = response.headers.get('x-render-routing');
      const renderRouting = rawRouting === 'hibernate-rate-limited' ? rawRouting : rawRouting ? 'other' : 'none';
      const category = response.ok ? 'upstream_2xx' : response.status >= 300 && response.status < 400 ? 'redirect_refused' : 'upstream_refused';
      const result: WakeResult = { ok: response.ok, category, upstreamStatus: response.status, contentType, renderRouting, durationMs: Math.max(0, now() - started), paymentAttempted: false };
      report(result); return result;
    } catch (error) {
      const name = (error as { name?: string })?.name;
      const result: WakeResult = { ok: false, category: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'transport_error', durationMs: Math.max(0, now() - started), paymentAttempted: false };
      report(result); return result;
    }
  };
  return {
    async fetch(request: Request, env: WakeEnv): Promise<Response> {
      const url = new URL(request.url);
      if (url.protocol !== 'https:' || url.host !== PUBLIC_HOST || url.pathname !== '/wake' || url.search || request.method !== 'POST') return reply({ ok: false, category: 'invalid_request', paymentAttempted: false }, 404);
      // This endpoint is server-only. Reject browser-origin requests and any request body before contacting Render.
      if (request.headers.has('origin')) return reply({ ok: false, category: 'invalid_request', paymentAttempted: false }, 400);
      if (!env.CAPSULE_WAKE_SECRET || !/^[a-f0-9]{64}$/.test(env.CAPSULE_WAKE_SECRET) || !env.WAKE_RATE_LIMITER) return reply({ ok: false, category: 'not_configured', paymentAttempted: false }, 503);
      if (!sameSecret(request.headers.get('authorization') ?? '', 'Bearer ' + env.CAPSULE_WAKE_SECRET)) return reply({ ok: false, category: 'unauthenticated', paymentAttempted: false }, 401);
      if (!await emptyBody(request)) return reply({ ok: false, category: 'invalid_request', paymentAttempted: false }, 400);
      try {
        const limited = await env.WAKE_RATE_LIMITER.limit({ key: 'capsule-payer-health' });
        if (!limited.success) return reply({ ok: false, category: 'rate_limited', paymentAttempted: false }, 429);
      } catch { return reply({ ok: false, category: 'rate_limit_unavailable', paymentAttempted: false }, 503); }
      // Isolate-local coalescing saves duplicate GETs, but is never a global lock or payment fence.
      let operation = pending;
      if (!operation) { operation = probe(); pending = operation; }
      try { const result = await operation; return reply(result, result.ok ? 200 : 503); }
      finally { if (pending === operation) pending = undefined; }
    },
  };
}
export default createWakeHandler();
