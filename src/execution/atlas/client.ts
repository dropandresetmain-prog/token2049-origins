import type { AtlasConfig } from './config.js';

/**
 * Atlas transport. Knows only how to POST JSON and classify failures; it never interprets
 * business meaning. Secrets travel in headers only and never appear in thrown errors, and
 * provider free text (`msg`) is never surfaced anywhere.
 */

export const DEFAULT_TIMEOUT_MS = 30_000;

export type AtlasEndpoint =
  | '/search.do'
  | '/verify.do'
  | '/order.do'
  | '/pay.do'
  | '/queryOrderDetails.do'
  | '/orderList.do';

/**
 * How a transport failure should be read by a caller that may be sending something irreversible:
 * - `rejected`: provider answered with a 4xx; the request was not processed (definite no effect).
 * - `unknown`: timeout, network failure, 5xx, redirect or unparseable body; the request may have
 *   been processed.
 */
export class AtlasTransportError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'http' | 'redirect' | 'parse',
    readonly endpoint: AtlasEndpoint,
    readonly httpStatus: number | null,
  ) {
    // Fixed vocabulary only: endpoint name, failure kind and numeric status.
    super(`atlas ${endpoint} ${kind}${httpStatus === null ? '' : ` http_${httpStatus}`}`);
    this.name = 'AtlasTransportError';
  }

  /** True when the provider certainly did not process the request. */
  get definitelyNotProcessed(): boolean {
    return this.kind === 'http' && this.httpStatus !== null && this.httpStatus >= 400 && this.httpStatus < 500 && this.httpStatus !== 408;
  }

  /** 401/403 mean our credentials are not accepted. */
  get accessBlocked(): boolean {
    return this.kind === 'http' && (this.httpStatus === 401 || this.httpStatus === 403);
  }
}

export class AtlasClient {
  constructor(
    private readonly cfg: Pick<AtlasConfig, 'baseUrl' | 'clientId' | 'clientSecret'>,
    private readonly fetchImpl: typeof fetch,
    private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /** Client id sent as the `cid` field on search bodies. */
  get cid(): string {
    return this.cfg.clientId;
  }

  async post(endpoint: AtlasEndpoint, body: Record<string, unknown>): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          'x-atlas-client-id': this.cfg.clientId,
          'x-atlas-client-secret': this.cfg.clientSecret,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
        // Never follow a redirect: it could carry the credential headers to another host.
        redirect: 'error',
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      throw new AtlasTransportError(name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network', endpoint, null);
    }
    if (res.status >= 300 && res.status < 400) throw new AtlasTransportError('redirect', endpoint, res.status);
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new AtlasTransportError('network', endpoint, res.status);
    }
    if (!res.ok) throw new AtlasTransportError('http', endpoint, res.status);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AtlasTransportError('parse', endpoint, res.status);
    }
  }
}
