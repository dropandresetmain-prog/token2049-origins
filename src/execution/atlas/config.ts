import { missingEnv } from '../../infrastructure/config.js';

/**
 * Atlas adapter configuration. Parsed from the same env as the core; a missing variable never
 * prevents startup, the route simply reports MISSING_CONFIG. Values are never returned in
 * diagnostics, only variable names.
 */

/** The only Atlas environment this adapter may talk to. Anything else is refused outright. */
export const ATLAS_SANDBOX_HOST = 'sandbox.atriptech.com';

export const REQUIRED_ENV = ['ATLAS_BASE_URL', 'ATLAS_CLIENT_ID', 'ATLAS_CLIENT_SECRET'] as const;

export interface AtlasConfig {
  /** Origin + path prefix with no trailing slash. Always https and the sandbox host. */
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /**
   * Bounded sandbox-only exception: allow `/pay.do` against the Atlas test balance. Default off.
   * Supplier prefunding is NOT an approved architecture; see docs/providers/atlas.md.
   */
  allowTestBalancePayment: boolean;
}

export type ConfigCheck =
  | { ok: true; config: AtlasConfig }
  | { ok: false; reason: 'missing'; missing: string[] }
  | { ok: false; reason: 'invalid_base_url'; detail: string };

export function missingAtlasEnv(env: NodeJS.ProcessEnv): string[] {
  return missingEnv(env, [...REQUIRED_ENV]);
}

/** Exact-match flag: anything other than the string `true` keeps the payment gate closed. */
export function paymentGateEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.ATLAS_ALLOW_TEST_BALANCE_PAYMENT === 'true';
}

export function checkAtlasConfig(env: NodeJS.ProcessEnv): ConfigCheck {
  const missing = missingAtlasEnv(env);
  if (missing.length > 0) return { ok: false, reason: 'missing', missing };

  let u: URL;
  try {
    u = new URL(String(env.ATLAS_BASE_URL).trim());
  } catch {
    return { ok: false, reason: 'invalid_base_url', detail: 'ATLAS_BASE_URL is not a valid URL' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'invalid_base_url', detail: 'ATLAS_BASE_URL must use https' };
  if (u.username || u.password) return { ok: false, reason: 'invalid_base_url', detail: 'ATLAS_BASE_URL must not embed credentials' };
  if (u.hostname !== ATLAS_SANDBOX_HOST) {
    return { ok: false, reason: 'invalid_base_url', detail: `ATLAS_BASE_URL host is not the approved sandbox host (${ATLAS_SANDBOX_HOST})` };
  }
  return {
    ok: true,
    config: {
      baseUrl: `${u.origin}${u.pathname.replace(/\/+$/, '')}`,
      clientId: String(env.ATLAS_CLIENT_ID).trim(),
      clientSecret: String(env.ATLAS_CLIENT_SECRET).trim(),
      allowTestBalancePayment: paymentGateEnabled(env),
    },
  };
}
