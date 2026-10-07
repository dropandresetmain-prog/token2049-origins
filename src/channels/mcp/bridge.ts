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

/** Sanitized operator diagnostic: outcome codes, HTTP status and timings only. Never tokens, headers or bodies. */
export type BridgeDiag = (event: Record<string, unknown>) => void;
// stderr, not stdout: in stdio mode stdout is the MCP protocol channel.
const stderrDiag: BridgeDiag = (e) => { process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), ...e })}\n`); };

/** Classify a rejected fetch without echoing anything that could carry a URL, header or body. */
function fetchFailure(e: unknown): { outcome: string; code?: string } {
  const err = e as { name?: string; cause?: { code?: unknown; message?: unknown } };
  if (err?.name === 'TimeoutError') return { outcome: 'timeout' };
  if (err?.name === 'AbortError') return { outcome: 'aborted' };
  const code = typeof err?.cause?.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(err.cause.code) ? err.cause.code : undefined;
  if (/redirect/i.test(String(err?.cause?.message ?? ''))) return { outcome: 'redirect_refused' };
  return { outcome: code ? 'connect_error' : 'fetch_error', ...(code ? { code } : {}) };
}

/** Platform routing hint on a non-2xx (e.g. a sleeping free instance); a short opaque value, never secret. */
function routingHint(r: Response): Record<string, string> {
  const v = r.headers.get('x-render-routing');
  return v && /^[A-Za-z0-9._-]{1,60}$/.test(v) ? { routing: v } : {};
}

/**
 * Client for one separate bounded payer process (`POST {bridge url}/pay`), bound to exactly one rail. This process holds
 * no payer keys: it only asks the bridge to fund a purchase id. The bridge's own `purchase` echo is
 * ignored; callers re-read the purchase from the gateway, which is the source of truth.
 */
export class BridgeClient {
  private readonly f: typeof fetch;
  private readonly diag: BridgeDiag;

  constructor(readonly rail: PayerRail, private readonly cfg: { url: string; token: string; fetch?: typeof fetch; timeoutMs?: number; statusTimeoutMs?: number; diag?: BridgeDiag }) {
    this.f = cfg.fetch ?? fetch;
    this.diag = cfg.diag ?? stderrDiag;
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

  /** Fire-and-forget wake-up: a sleeping free-tier payer needs ~35s to start, so it is pinged early in the flow. Its outcome is logged. */
  wake(): void {
    const started = Date.now();
    const report = (e: Record<string, unknown>) => this.diag({ type: 'payer_wake', rail: this.rail, ...e, ms: Date.now() - started });
    this.f(`${this.cfg.url}/health`, { redirect: 'error', signal: AbortSignal.timeout(90_000) })
      .then(async (r) => { await r.arrayBuffer(); report({ outcome: r.ok ? 'ok' : 'http_error', status: r.status, ...(r.ok ? {} : routingHint(r)) }); })
      .catch((e) => report(fetchFailure(e)));
  }

  /**
   * Sanitized identity of the payer behind this bridge, plus how much it may still spend when it reports that (hosted payers do:
   * `ledger.headroomBaseUnits`, the largest single payment its caps still allow). Null if unreachable or if it is not a source of this
   * client's rail.
   */
  async status(): Promise<{ source: FundingSource; headroomBaseUnits?: bigint } | null> {
    const timeoutMs = this.cfg.statusTimeoutMs ?? Math.min(this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS, 5000);
    const started = Date.now();
    // Every exit reports exactly one sanitized outcome, so "never started", "timed out" and "rejected" are distinguishable in logs.
    const report = (e: Record<string, unknown>) => this.diag({ type: 'payer_status', rail: this.rail, ...e, ms: Date.now() - started, timeoutMs });
    let response: Response;
    try {
      response = await this.f(`${this.cfg.url}/status`, {
        headers: { accept: 'application/json', authorization: `Bearer ${this.cfg.token}` },
        redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) { report(fetchFailure(e)); return null; }
    if (!response.ok) { await response.arrayBuffer().catch(() => undefined); report({ outcome: 'http_error', status: response.status, ...routingHint(response) }); return null; }
    let json: unknown;
    try { json = await response.json(); }
    catch (e) { report({ ...(fetchFailure(e).outcome === 'timeout' ? { outcome: 'timeout' } : { outcome: 'invalid_json' }), status: response.status }); return null; }
    const body = z.object({ ok: z.literal(true), source: FundingSource.nullable(), ledger: z.record(z.string(), z.unknown()).optional() }).strict().safeParse(json);
    if (!body.success) { report({ outcome: 'schema_mismatch' }); return null; }
    if (!body.data.source) { report({ outcome: 'missing_source' }); return null; }
    // A bridge configured for one rail must never be accepted as another rail's payer.
    if (body.data.source.rail !== this.rail) { report({ outcome: 'rail_mismatch' }); return null; }
    const raw = body.data.ledger?.headroomBaseUnits;
    const headroom = typeof raw === 'string' && /^[0-9]+$/.test(raw);
    report({ outcome: 'ok', headroom });
    return { source: body.data.source, ...(headroom ? { headroomBaseUnits: BigInt(raw as string) } : {}) };
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
