import { z } from 'zod';
import type { McpConfig } from './config.js';
import { FundingSource } from '../../contracts/presentation.js';

/** Outcome of asking the payer bridge to fund a purchase. Never throws; failures are values. */
export type BridgeResult = { ok: true; transferReference: string | null } | { ok: false; code: string; message: string };

const BridgeFailure = z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) });
const BridgeSuccess = z.object({
  ok: z.literal(true),
  payment: z.object({ transferReference: z.string() }).partial().optional(),
});

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Client for the separate bounded payer process (`POST {PAYER_BRIDGE_URL}/pay`). This process holds
 * no payer keys: it only asks the bridge to fund a purchase id. The bridge's own `purchase` echo is
 * ignored; callers re-read the purchase from the gateway, which is the source of truth.
 */
export class BridgeClient {
  private readonly f: typeof fetch;

  constructor(private readonly cfg: { url: string; token: string; fetch?: typeof fetch; timeoutMs?: number }) {
    this.f = cfg.fetch ?? fetch;
  }

  static from(config: McpConfig): BridgeClient | undefined {
    if (!config.bridge) return undefined;
    return new BridgeClient({
      ...config.bridge,
      ...(config.fetch ? { fetch: config.fetch } : {}),
      ...(config.bridgeTimeoutMs ? { timeoutMs: config.bridgeTimeoutMs } : {}),
    });
  }

  async source(): Promise<FundingSource | null> {
    try {
      const response = await this.f(`${this.cfg.url}/status`, {
        headers: { accept: 'application/json', authorization: `Bearer ${this.cfg.token}` },
        redirect: 'error', signal: AbortSignal.timeout(Math.min(this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS, 5000)),
      });
      if (!response.ok) return null;
      const body = z.object({ ok: z.literal(true), source: FundingSource.nullable() }).strict().safeParse(await response.json());
      return body.success ? body.data.source : null;
    } catch { return null; }
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
    if (f.success) return { ok: false, code: f.data.error.code, message: f.data.error.message.slice(0, 300) };
    return { ok: false, code: 'bridge_error', message: `payer bridge returned HTTP ${res.status}` };
  }
}
