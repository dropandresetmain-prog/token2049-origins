import { z } from 'zod';
import { ErrorBody } from '../../contracts/common.js';
import { SearchOffersResponse, CreateQuoteResponse, PurchaseResponse, PurchaseEventsResponse } from '../../contracts/api.js';
import type { McpConfig } from './config.js';

/**
 * A failure talking to the gateway (or a malformed gateway reply). Carries the canonical ErrorBody
 * fields so tools can surface code + message + requestId. Never contains the bearer token.
 */
export class GatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly requestId: string | null,
    readonly httpStatus: number | null,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Thin typed client for the canonical HTTP gateway. It is the ONLY way this channel reaches core:
 * one authenticated client, no DB, no shared code beyond the zod contracts.
 */
export class GatewayClient {
  private readonly f: typeof fetch;

  constructor(private readonly cfg: Pick<McpConfig, 'gatewayUrl' | 'gatewayToken' | 'fetch' | 'gatewayTimeoutMs'>) {
    this.f = cfg.fetch ?? fetch;
  }

  private async call(method: 'GET' | 'POST', path: string, opts: { body?: unknown; headers?: Record<string, string> } = {}): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json', authorization: `Bearer ${this.cfg.gatewayToken}`, ...(opts.headers ?? {}) };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await this.f(this.cfg.gatewayUrl + path, {
        method,
        headers,
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
        // Never follow redirects: that would forward the bearer token to another origin.
        redirect: 'error',
        signal: AbortSignal.timeout(this.cfg.gatewayTimeoutMs ?? DEFAULT_TIMEOUT_MS),
      });
    } catch (e) {
      // Do not include e.message verbatim: some runtimes echo request details.
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
      throw new GatewayError(timedOut ? 'gateway_timeout' : 'gateway_unreachable', timedOut ? 'gateway request timed out' : 'gateway is unreachable', null, null);
    }
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const parsed = ErrorBody.safeParse(json);
      if (parsed.success) {
        const { code, message, requestId, details } = parsed.data.error;
        throw new GatewayError(code, message, requestId, res.status, details);
      }
      throw new GatewayError('gateway_error', `gateway returned HTTP ${res.status}`, res.headers.get('x-request-id'), res.status);
    }
    return json;
  }

  /** Parse a success body against its contract; drift is reported, never passed through. */
  private static parse<T>(schema: z.ZodType<T>, json: unknown): T {
    const r = schema.safeParse(json);
    if (!r.success) throw new GatewayError('gateway_contract_violation', 'gateway response did not match the v1 contract', null, null);
    return r.data;
  }

  async searchOffers(intent: unknown) {
    return GatewayClient.parse(SearchOffersResponse, await this.call('POST', '/v1/offers/search', { body: { intent } }));
  }

  async createQuote(offerId: string, fulfillment: unknown) {
    return GatewayClient.parse(CreateQuoteResponse, await this.call('POST', '/v1/quotes', { body: { offerId, fulfillment } }));
  }

  async createPurchase(body: unknown, idempotencyKey: string) {
    return GatewayClient.parse(PurchaseResponse, await this.call('POST', '/v1/purchases', { body, headers: { 'idempotency-key': idempotencyKey } }));
  }

  async getPurchase(purchaseId: string) {
    return GatewayClient.parse(PurchaseResponse, await this.call('GET', `/v1/purchases/${encodeURIComponent(purchaseId)}`));
  }

  async getEvents(purchaseId: string) {
    return GatewayClient.parse(PurchaseEventsResponse, await this.call('GET', `/v1/purchases/${encodeURIComponent(purchaseId)}/events`));
  }
}
