/**
 * Thin liteAPI HTTP client. Responsibilities: auth header, timeout, no redirects, JSON parse and
 * a classification that never leaks request bodies (guest PII) or provider message text.
 *
 * Provider error bodies are `{ error: { code: <int>, message } }`. We keep only the numeric code and
 * HTTP status; messages are dropped because they can echo request fields.
 */
export type HttpOutcome =
  | { kind: 'ok'; status: number; json: unknown }
  /** 2xx with a body that is not JSON: the request may have been processed. */
  | { kind: 'bad_body'; status: number }
  | { kind: 'provider_error'; status: number; code: number | null }
  /** No usable HTTP response (timeout, DNS, TLS, reset, blocked redirect). The request may or may not have been processed. */
  | { kind: 'transport'; reason: 'timeout' | 'network' };

export interface HttpClientOptions {
  apiKey: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}

export class NuiteeHttp {
  constructor(private readonly o: HttpClientOptions) {}

  async request(method: 'GET' | 'POST' | 'PUT', url: string, body?: Record<string, unknown>): Promise<HttpOutcome> {
    let res: Response;
    let text: string;
    try {
      res = await this.o.fetchImpl(url, {
        method,
        headers: { accept: 'application/json', 'content-type': 'application/json', 'X-API-Key': this.o.apiKey },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(this.o.timeoutMs),
        // A redirect could carry the API key to another origin; fail instead of following.
        redirect: 'error',
      });
      text = await res.text();
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      return { kind: 'transport', reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
    }
    let json: unknown = null;
    let parsed = false;
    try {
      json = JSON.parse(text);
      parsed = true;
    } catch {
      /* handled below */
    }
    // liteAPI occasionally reports failures inside a 200 envelope; honor an error object regardless of status.
    const errObj = parsed && json && typeof json === 'object' ? (json as { error?: unknown }).error : undefined;
    if (errObj && typeof errObj === 'object') {
      const c = Number((errObj as { code?: unknown }).code);
      return { kind: 'provider_error', status: res.status, code: Number.isInteger(c) ? c : null };
    }
    if (!res.ok) {
      const c = parsed && json && typeof json === 'object' ? Number((json as { code?: unknown }).code) : NaN;
      return { kind: 'provider_error', status: res.status, code: Number.isInteger(c) ? c : null };
    }
    return parsed ? { kind: 'ok', status: res.status, json } : { kind: 'bad_body', status: res.status };
  }
}

/** Short, PII-free description of a non-ok outcome for reasons and evidence. */
export function describeOutcome(o: HttpOutcome): string {
  switch (o.kind) {
    case 'transport':
      return `transport ${o.reason}`;
    case 'bad_body':
      return `non-JSON response (HTTP ${o.status})`;
    case 'provider_error':
      return `HTTP ${o.status}${o.code === null ? '' : ` code ${o.code}`}`;
    case 'ok':
      return `HTTP ${o.status}`;
  }
}
