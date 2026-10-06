import { missingEnv } from '../../infrastructure/config.js';

/**
 * Nuitee (liteAPI) configuration. Parsed from env by the adapter itself so a missing key never
 * prevents gateway startup; the route simply reports MISSING_CONFIG.
 *
 * Hosts are validated rather than trusted: the API key is sent as a header on every request, so a
 * mis-set base URL must never be able to send it to a non-liteAPI host.
 */
export const DEFAULT_SEARCH_BASE_URL = 'https://api.liteapi.travel/v3.0';
export const DEFAULT_BOOKING_BASE_URL = 'https://book.liteapi.travel/v3.0';

export const REQUIRED_ENV = ['NUITEE_API_KEY'] as const;

export interface NuiteeConfig {
  apiKey: string;
  searchBaseUrl: string;
  bookingBaseUrl: string;
}

export type ConfigResult =
  | { ok: true; config: NuiteeConfig }
  | { ok: false; kind: 'missing'; missing: string[] }
  | { ok: false; kind: 'invalid'; reason: string };

/** Accept only https URLs on liteapi.travel (or a subdomain), without credentials or query. */
export function validateBaseUrl(name: string, raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`${name} is not a valid URL`);
  }
  const hostOk = u.hostname === 'liteapi.travel' || u.hostname.endsWith('.liteapi.travel');
  if (u.protocol !== 'https:' || !hostOk || u.username || u.password || u.search || u.hash) {
    throw new Error(`${name} must be an https liteapi.travel URL`);
  }
  return raw.replace(/\/+$/, '');
}

export function loadNuiteeConfig(env: NodeJS.ProcessEnv): ConfigResult {
  const missing = missingEnv(env, [...REQUIRED_ENV]);
  if (missing.length > 0) return { ok: false, kind: 'missing', missing };
  try {
    const searchBaseUrl = validateBaseUrl('NUITEE_SEARCH_BASE_URL', env.NUITEE_SEARCH_BASE_URL?.trim() || DEFAULT_SEARCH_BASE_URL);
    const bookingBaseUrl = validateBaseUrl('NUITEE_BOOKING_BASE_URL', env.NUITEE_BOOKING_BASE_URL?.trim() || DEFAULT_BOOKING_BASE_URL);
    return { ok: true, config: { apiKey: env.NUITEE_API_KEY!.trim(), searchBaseUrl, bookingBaseUrl } };
  } catch (e) {
    // The message names the variable only; it never contains the offending value.
    return { ok: false, kind: 'invalid', reason: (e as Error).message };
  }
}

/**
 * liteAPI keys are prefixed by environment (`sand_...` / `prod_...`; prefix convention is observed,
 * not documented). This is only a hint: it never reveals the key, and `prod`/`live` prefixes make
 * execute() refuse, because ACC_CREDIT_CARD on a production key may place a real booking.
 */
export function keyEnvironmentHint(apiKey: string): 'sandbox' | 'production' | 'unknown' {
  const k = apiKey.toLowerCase();
  if (k.startsWith('sand')) return 'sandbox';
  if (k.startsWith('prod') || k.startsWith('live')) return 'production';
  return 'unknown';
}
