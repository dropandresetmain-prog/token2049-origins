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

/**
 * Client for one separate bounded payer process (`POST {bridge url}/pay`), bound to exactly one rail. This process holds
 * no payer keys: it only asks the bridge to fund a purchase id. The bridge's own `purchase` echo is
 * ignored; callers re-read the purchase from the gateway, which is the source of truth.
 */
export class BridgeClient {
  private readonly f: typeof fetch;

  constructor(readonly rail: PayerRail, private readonly cfg: { url: string; token: string; fetch?: typeof fetch; timeoutMs?: number; statusTimeoutMs?: number }) {
    this.f = cfg.fetch ?? fetch;
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

  /**
   * Sanitized identity of the payer behind this bridge, plus how much it may still spend when it reports that (hosted payers do:
   * `ledger.headroomBaseUnits`, the largest single payment its caps still allow). Null if unreachable or if it is not a source of this
   * client's rail.
   */
  async status(): Promise<{ source: FundingSource; headroomBaseUnits?: bigint } | null> {
    try {
      const response = await this.f(`${this.cfg.url}/status`, {
        headers: { accept: 'application/json', authorization: `Bearer ${this.cfg.token}` },
        redirect: 'error', signal: AbortSignal.timeout(this.cfg.statusTimeoutMs ?? Math.min(this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS, 5000)),
      });
      if (!response.ok) return null;
      const body = z.object({ ok: z.literal(true), source: FundingSource.nullable(), ledger: z.record(z.string(), z.unknown()).optional() }).strict().safeParse(await response.json());
      // A bridge configured for one rail must never be accepted as another rail's payer.
      if (!body.success || body.data.source?.rail !== this.rail) return null;
      const raw = body.data.ledger?.headroomBaseUnits;
      return { source: body.data.source, ...(typeof raw === 'string' && /^[0-9]+$/.test(raw) ? { headroomBaseUnits: BigInt(raw) } : {}) };
    } catch { return null; }
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
