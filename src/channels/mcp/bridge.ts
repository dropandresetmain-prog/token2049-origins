import { z } from 'zod';
import { PAYER_RAILS, type McpConfig, type PayerRail } from './config.js';
import { FundingSource } from '../../contracts/presentation.js';

/** Outcome of asking the payer bridge to fund a purchase. Never throws; failures are values. */
export type BridgeResult = { ok: true; transferReference: string | null } | { ok: false; code: string; message: string; retrySafe?: boolean };

const BridgeFailure = z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }), retrySafe: z.boolean().optional() });
const BridgeSuccess = z.object({
  ok: z.literal(true),
  payment: z.object({ transferReference: z.string() }).partial().optional(),
});

const DEFAULT_TIMEOUT_MS = 60_000;
type Status = { source: FundingSource; headroomBaseUnits?: bigint };
export type BridgeDiag = (event: Record<string, unknown>) => void;
const stderrDiag: BridgeDiag = (event) => { process.stderr.write(`${JSON.stringify(event)}\n`); };
const TRANSIENT_HTTP = new Set([502, 503, 504]);
const TRANSIENT_CONNECT = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET']);
function fetchOutcome(error: unknown): { outcome: string; transient: boolean; code?: string } {
  const e = error as { name?: string; cause?: { code?: unknown } };
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return { outcome: 'timeout', transient: true };
  const code = typeof e?.cause?.code === 'string' && TRANSIENT_CONNECT.has(e.cause.code) ? e.cause.code : undefined;
  return { outcome: code ? 'connect_error' : 'fetch_error', transient: !!code, ...(code ? { code } : {}) };
}

/**
 * Client for one separate bounded payer process (`POST {bridge url}/pay`), bound to exactly one rail. This process holds
 * no payer keys: it only asks the bridge to fund a purchase id. The bridge's own `purchase` echo is
 * ignored; callers re-read the purchase from the gateway, which is the source of truth.
 */
export class BridgeClient {
  private readonly f: typeof fetch;
  private pendingStatus?: Promise<Status | null>;

  constructor(readonly rail: PayerRail, private readonly cfg: { url: string; token: string; fetch?: typeof fetch; timeoutMs?: number; statusTimeoutMs?: number; diag?: BridgeDiag; wait?: (ms: number) => Promise<void> }) {
    this.f = cfg.fetch ?? fetch;
  }

  /** A consolidated bridge dispatches from the canonical purchase, never the rail argument. */
  static consolidated(config: McpConfig): BridgeClient | undefined {
    return config.consolidatedBridge ? new BridgeClient('cardano', { ...config.consolidatedBridge, ...(config.fetch ? { fetch: config.fetch } : {}), timeoutMs: config.bridgeTimeoutMs }) : undefined;
  }

  /** One client per configured rail, in a fixed order. */
  static fromConfig(config: McpConfig): BridgeClient[] {
    return PAYER_RAILS.flatMap((rail) => {
      const endpoint = config.bridges?.[rail];
      if (!endpoint) return [];
      return [new BridgeClient(rail, {
        ...endpoint,
        ...(config.fetch ? { fetch: config.fetch } : {}),
        ...(config.bridgeTimeoutMs ? { timeoutMs: config.bridgeTimeoutMs } : {}),
        ...(config.bridgeStatusTimeoutMs ? { statusTimeoutMs: config.bridgeStatusTimeoutMs } : {}),
      })];
    });
  }

  /** Coalesce concurrent probes; recovery is read-only and stays inside the existing status budget. */
  async status(): Promise<Status | null> {
    if (this.pendingStatus) return this.pendingStatus;
    const pending = this.readiness();
    this.pendingStatus = pending;
    try { return await pending; } finally { if (this.pendingStatus === pending) this.pendingStatus = undefined; }
  }

  private async readiness(): Promise<Status | null> {
    const timeoutMs = this.cfg.statusTimeoutMs ?? Math.min(this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS, 5000);
    const deadline = Date.now() + timeoutMs;
    const report = (route: string, started: number, event: Record<string, unknown>) => {
      // Fixed fields only: no response bodies, error messages, URLs, headers or identities.
      try { (this.cfg.diag ?? stderrDiag)({ type: 'payer_readiness', rail: this.rail, route, ...event, ms: Date.now() - started, timeoutMs }); } catch { /* diagnostics never change readiness */ }
    };
    const probe = async (): Promise<{ status: Status | null; transient: boolean }> => {
      const started = Date.now();
      let response: Response;
      try {
        response = await this.f(`${this.cfg.url}/status`, {
          headers: { accept: 'application/json', authorization: `Bearer ${this.cfg.token}` },
          redirect: 'error', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
        });
      } catch (e) { const outcome = fetchOutcome(e); report('status', started, outcome); return { status: null, transient: outcome.transient }; }
      if (!response.ok) {
        // Do not consume an untrusted error body merely to log a routing failure.
        void response.body?.cancel().catch(() => undefined);
        report('status', started, { outcome: 'http_error', status: response.status });
        return { status: null, transient: TRANSIENT_HTTP.has(response.status) };
      }
      let json: unknown;
      try { json = await response.json(); } catch (e) {
        const outcome = fetchOutcome(e);
        report('status', started, { outcome: outcome.outcome === 'timeout' ? 'timeout' : 'invalid_json' });
        return { status: null, transient: outcome.outcome === 'timeout' };
      }
      const body = z.object({ ok: z.literal(true), source: FundingSource.nullable(), ledger: z.record(z.string(), z.unknown()).optional() }).strict().safeParse(json);
      if (!body.success) { report('status', started, { outcome: 'schema_mismatch' }); return { status: null, transient: false }; }
      if (!body.data.source) { report('status', started, { outcome: 'missing_source' }); return { status: null, transient: false }; }
      if (body.data.source.rail !== this.rail) { report('status', started, { outcome: 'rail_mismatch' }); return { status: null, transient: false }; }
      const raw = body.data.ledger?.headroomBaseUnits;
      if (raw !== undefined && (typeof raw !== 'string' || !/^[0-9]{1,40}$/.test(raw))) {
        report('status', started, { outcome: 'schema_mismatch' }); return { status: null, transient: false };
      }
      report('status', started, { outcome: 'success' });
      return { status: { source: body.data.source, ...(typeof raw === 'string' ? { headroomBaseUnits: BigInt(raw) } : {}) }, transient: false };
    };
    let result = await probe();
    if (!result.transient || deadline - Date.now() <= 500) return result.status;
    // One awaited health request replaces unobserved fire-and-forget wakes. No authentication/payment retries.
    const started = Date.now();
    try {
      const response = await this.f(`${this.cfg.url}/health`, { redirect: 'error', signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
      void response.body?.cancel().catch(() => undefined);
      report('health', started, { outcome: response.ok ? 'success' : 'http_error', status: response.status });
      if (!response.ok && !TRANSIENT_HTTP.has(response.status)) return null;
    } catch (e) { const outcome = fetchOutcome(e); report('health', started, outcome); if (!outcome.transient) return null; }
    for (const backoff of [500, 1500]) {
      if (deadline - Date.now() <= backoff) return null;
      await (this.cfg.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(backoff);
      result = await probe();
      if (!result.transient) return result.status;
    }
    return null;
  }

  async source(): Promise<FundingSource | null> {
    return (await this.status())?.source ?? null;
  }

  async pay(purchaseId: string): Promise<BridgeResult> {
    let res: Response;
    try {
      res = await this.f(`${this.cfg.url}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${this.cfg.token}` },
        body: JSON.stringify({ purchaseId }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch {
      // Outcome is ambiguous (the bridge may have paid before the connection failed): callers must re-read.
      return { ok: false, code: 'bridge_unreachable', message: 'payer bridge did not respond' };
    }
    let json: unknown = null;
    try {
      json = JSON.parse(await res.text());
    } catch {
      json = null;
    }
    if (res.ok) {
      const s = BridgeSuccess.safeParse(json);
      if (s.success) return { ok: true, transferReference: s.data.payment?.transferReference ?? null };
      return { ok: false, code: 'bridge_bad_response', message: 'payer bridge returned an unexpected response' };
    }
    const f = BridgeFailure.safeParse(json);
    if (f.success) return { ok: false, code: f.data.error.code, message: f.data.error.message.slice(0, 300), retrySafe: f.data.retrySafe === true };
    return { ok: false, code: 'bridge_error', message: `payer bridge returned HTTP ${res.status}` };
  }
}
