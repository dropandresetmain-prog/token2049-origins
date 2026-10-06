/**
 * OCBC developer-sandbox HTTP client: application token, per-minute call budget, timeouts and
 * honest failure mapping. READ ONLY: it exposes GET resource calls and the token mint, nothing else.
 *
 * Provenance: written fresh for this gateway. The wire facts (client-credentials token at /token with HTTP
 * Basic, 403 + gateway fault 900908 for an unsubscribed API, optional `sessionToken` customer header) were
 * taken from read-only inspection of tencent-hackathon@d02f7ba68ba1c7c3ef881fa4d5a235b6e8941ebd,
 * src/server/bank/providers/ocbc/client.ts. No code was copied.
 *
 * Secrets and tokens live in memory only. Failure messages are built from constants, HTTP status and the
 * numeric gateway fault code; upstream response text is never echoed, so nothing sensitive can leak through it.
 */
import { z } from 'zod';
import type { Clock } from '../../infrastructure/clock.js';

const REQUEST_TIMEOUT_MS = 12_000;
const TOKEN_REFRESH_MARGIN_MS = 30_000;
const MAX_BODY_CHARS = 1_000_000;

/** Hosts the client may talk to. A configured base URL outside this set is refused, not followed. */
const DEFAULT_ALLOWED_BASE_URLS: readonly string[] = ['https://api.ocbc.com'];

/** Environment variable names. Values are never logged or returned. */
export const OCBC_ENV = {
  clientId: 'OCBC_API_CLIENT_ID',
  clientSecret: 'OCBC_API_CLIENT_SECRET',
  baseUrl: 'OCBC_API_BASE_URL',
  callsPerMinute: 'OCBC_API_CALLS_PER_MINUTE',
  sessionToken: 'OCBC_SANDBOX_SESSION_TOKEN',
} as const;

/** Documented sandbox resources (public Swagger). Documentation is not proof of entitlement. */
export const OCBC_APIS = {
  accountListing: { label: 'corporateAccountListing/1.0', path: '/transactional/corporateAccountListing/1.0' },
  accountTransactions: { label: 'corpTransHistory/1.0', path: '/transactional/corpTransHistory/1.0' },
  creditCardList: { label: 'creditcardlisting/1.0', path: '/transactional/creditcardlisting/1.0/retrieveCreditCardList' },
  creditCardUnbilled: { label: 'creditcardhistory/1.0', path: '/transactional/creditcardhistory/1.0/retrieveCreditCardTranHistory' },
} as const;
export type OcbcApi = (typeof OCBC_APIS)[keyof typeof OCBC_APIS];

export type OcbcFailureKind =
  /** Credentials rejected (token endpoint 400/401, or resource 401). */
  | 'auth'
  /** 403 / gateway fault 900908: the application is not subscribed to, or is refused by, this API. */
  | 'forbidden'
  | 'rate_limited'
  | 'unavailable'
  /** The call succeeded but the payload was not a shape this adapter can interpret. */
  | 'unusable';

export interface OcbcFailure {
  ok: false;
  kind: OcbcFailureKind;
  /** Which API (or "token") failed. */
  api: string;
  status?: number;
  /** Numeric/alphanumeric gateway fault code, when present. */
  faultCode?: string;
  /** Safe, constant-derived message. */
  message: string;
}
export type OcbcResult = { ok: true; json: unknown; observedAt: string } | OcbcFailure;

const EnvSchema = z.object({
  OCBC_API_CLIENT_ID: z.string().trim().min(1),
  OCBC_API_CLIENT_SECRET: z.string().trim().min(1),
  OCBC_API_BASE_URL: z.string().trim().default('https://api.ocbc.com'),
  OCBC_API_CALLS_PER_MINUTE: z.coerce.number().int().min(1).max(60).default(8),
  OCBC_SANDBOX_SESSION_TOKEN: z.string().trim().optional(),
});

export interface OcbcClientConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  callsPerMinute: number;
}

export type ConfigResult =
  | { ok: true; config: OcbcClientConfig }
  | { ok: false; reason: 'missing'; missing: string[] }
  | { ok: false; reason: 'invalid'; invalid: string[] };

/** Parse configuration from env without ever returning a value in an error. */
export function parseOcbcConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const missing = [OCBC_ENV.clientId, OCBC_ENV.clientSecret].filter((n) => !env[n] || String(env[n]).trim() === '');
  if (missing.length) return { ok: false, reason: 'missing', missing };
  const parsed = EnvSchema.safeParse({
    OCBC_API_CLIENT_ID: env.OCBC_API_CLIENT_ID,
    OCBC_API_CLIENT_SECRET: env.OCBC_API_CLIENT_SECRET,
    // Empty string means "unset" so a blank line in .env falls back to the defaults.
    ...(env.OCBC_API_BASE_URL?.trim() ? { OCBC_API_BASE_URL: env.OCBC_API_BASE_URL } : {}),
    ...(env.OCBC_API_CALLS_PER_MINUTE?.trim() ? { OCBC_API_CALLS_PER_MINUTE: env.OCBC_API_CALLS_PER_MINUTE } : {}),
  });
  if (!parsed.success) return { ok: false, reason: 'invalid', invalid: [...new Set(parsed.error.issues.map((i) => String(i.path[0])))] };
  const base = normalizeBaseUrl(parsed.data.OCBC_API_BASE_URL);
  if (!base || !DEFAULT_ALLOWED_BASE_URLS.includes(base)) return { ok: false, reason: 'invalid', invalid: [OCBC_ENV.baseUrl] };
  return {
    ok: true,
    config: {
      clientId: parsed.data.OCBC_API_CLIENT_ID,
      clientSecret: parsed.data.OCBC_API_CLIENT_SECRET,
      baseUrl: base,
      callsPerMinute: parsed.data.OCBC_API_CALLS_PER_MINUTE,
    },
  };
}

/** https origin only: no credentials, path, query or fragment. */
function normalizeBaseUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return null;
    if (u.pathname !== '/' && u.pathname !== '') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Gateway fault code from `{code}` / `{fault:{code}}` bodies. Only digit/letter codes are kept. */
function faultCodeOf(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const o = json as Record<string, unknown>;
  const f = (o.fault && typeof o.fault === 'object' ? o.fault : o) as Record<string, unknown>;
  const c = f.code;
  if (typeof c === 'number') return String(c);
  return typeof c === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(c) ? c : undefined;
}

const fail = (kind: OcbcFailureKind, api: string, message: string, extra: { status?: number; faultCode?: string } = {}): OcbcFailure => ({
  ok: false,
  kind,
  api,
  message,
  ...(extra.status !== undefined ? { status: extra.status } : {}),
  ...(extra.faultCode !== undefined ? { faultCode: extra.faultCode } : {}),
});

export class OcbcClient {
  private token: { value: string; expiresAtMs: number } | null = null;
  private tokenInFlight: Promise<string | OcbcFailure> | null = null;
  /** Timestamps (ms) of calls inside the sliding one-minute window. */
  private readonly calls: number[] = [];

  constructor(
    private readonly cfg: OcbcClientConfig,
    private readonly fetchImpl: typeof fetch,
    private readonly clock: Clock,
    /** Read at call time so a rotated session token is picked up without restart. */
    private readonly sessionToken: () => string | undefined,
  ) {
    if (!DEFAULT_ALLOWED_BASE_URLS.includes(cfg.baseUrl)) throw new Error('OCBC API origin is not allowlisted.');
  }

  /** Sliding-window budget shared by token mints and resource reads. */
  private claimBudget(): boolean {
    const now = this.clock.now().getTime();
    while (this.calls.length && this.calls[0]! <= now - 60_000) this.calls.shift();
    if (this.calls.length >= this.cfg.callsPerMinute) return false;
    this.calls.push(now);
    return true;
  }

  private async mintToken(): Promise<string | OcbcFailure> {
    if (!this.claimBudget()) return fail('rate_limited', 'token', 'OCBC call budget exhausted for this minute.');
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
        redirect: 'error',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return fail('unavailable', 'token', 'OCBC token endpoint could not be reached.');
    }
    if (!res.ok) {
      const kind: OcbcFailureKind = res.status === 400 || res.status === 401 || res.status === 403 ? 'auth' : res.status === 429 ? 'rate_limited' : 'unavailable';
      return fail(kind, 'token', `OCBC token endpoint did not issue a token (HTTP ${res.status}).`, { status: res.status });
    }
    const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
    if (!body || typeof body.access_token !== 'string' || body.access_token === '') {
      return fail('unavailable', 'token', 'OCBC token response was not understood.', { status: res.status });
    }
    const ttl = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 300;
    this.token = { value: body.access_token, expiresAtMs: this.clock.now().getTime() + ttl * 1000 };
    return body.access_token;
  }

  /** Cached application token; concurrent callers share one mint. */
  private appToken(): Promise<string | OcbcFailure> {
    if (this.token && this.token.expiresAtMs > this.clock.now().getTime() + TOKEN_REFRESH_MARGIN_MS) return Promise.resolve(this.token.value);
    this.tokenInFlight ??= this.mintToken().finally(() => {
      this.tokenInFlight = null;
    });
    return this.tokenInFlight;
  }

  /** One GET. Never throws. */
  async get(api: OcbcApi, query: Record<string, string> = {}): Promise<OcbcResult> {
    const token = await this.appToken();
    if (typeof token !== 'string') return token;
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
    const session = this.sessionToken();
    if (session) headers.sessionToken = session;
    if (!this.claimBudget()) return fail('rate_limited', api.label, 'OCBC call budget exhausted for this minute.');

    const url = new URL(`${this.cfg.baseUrl}${api.path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      return fail('unavailable', api.label, 'OCBC did not respond in time.');
    }
    const observedAt = this.clock.now().toISOString();
    const text = (await res.text().catch(() => '')).slice(0, MAX_BODY_CHARS);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok && json !== null) return { ok: true, json, observedAt };

    const faultCode = faultCodeOf(json);
    const extra = { status: res.status, ...(faultCode ? { faultCode } : {}) };
    const codeNote = faultCode ? `, gateway code ${faultCode}` : '';
    if (res.status === 401) {
      this.token = null; // force a fresh mint next call
      return fail('auth', api.label, `OCBC rejected the credentials (HTTP 401${codeNote}).`, extra);
    }
    if (res.status === 403) {
      const detail = faultCode === '900908' ? 'application not subscribed to this API' : 'request refused';
      return fail('forbidden', api.label, `OCBC ${detail} (HTTP 403${codeNote}).`, extra);
    }
    if (res.status === 429 || faultCode === '900800' || faultCode === '900802' || faultCode === '900803') {
      return fail('rate_limited', api.label, 'OCBC rate limit reached.', extra);
    }
    if (res.status === 404) return fail('unusable', api.label, 'OCBC has no resource at the documented path (HTTP 404).', extra);
    if (res.ok) return fail('unusable', api.label, 'OCBC returned an empty or non-JSON body.', extra);
    return fail('unavailable', api.label, `OCBC returned an unexpected response (HTTP ${res.status}).`, extra);
  }
}
