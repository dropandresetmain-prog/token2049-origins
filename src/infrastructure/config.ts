import { z } from 'zod';
import type { CoreConfig } from '../core/service.js';

/**
 * Core configuration. Provider/rail configuration is parsed by each adapter from the same env,
 * so missing provider secrets never prevent startup; the route simply reports MISSING_CONFIG.
 */
const CoreEnv = z.object({
  APP_ENV: z.enum(['development', 'test', 'sandbox', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8787),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.url().refine(value => /^postgres(?:ql)?:\/\//.test(value), 'PostgreSQL URL required'),
  PUBLIC_BASE_URL: z.url().default('http://127.0.0.1:8787'),
  QUOTE_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  OFFER_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(1800),
  /** Approved demo spend limit per purchase in USD minor units (cents). */
  DEMO_PER_PURCHASE_LIMIT_USD_MINOR: z.coerce.bigint().default(50000n),
  /** Synthetic sandbox card capacity in USD minor units. Explicitly simulated; never OCBC cash. */
  SIMULATED_CARD_CAPACITY_USD_MINOR: z.coerce.bigint().default(200000n),
  SERVICE_FEE_BPS: z.coerce.number().int().min(0).max(1000).default(0),
  WORKER_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
});
export type CoreEnv = z.infer<typeof CoreEnv>;

export function loadCoreEnv(env: NodeJS.ProcessEnv = process.env): CoreEnv {
  const parsed = CoreEnv.safeParse(env);
  if (!parsed.success) {
    // Report variable names only, never values.
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))].join(', ');
    throw new Error(`invalid core configuration: ${names}`);
  }
  if (parsed.data.APP_ENV === 'production') {
    throw new Error('APP_ENV=production is not authorized for this launch (sandbox/testnet only)');
  }
  return parsed.data;
}

export function toCoreConfig(e: CoreEnv): CoreConfig {
  return {
    appEnv: e.APP_ENV,
    publicBaseUrl: e.PUBLIC_BASE_URL.replace(/\/$/, ''),
    quoteTtlSeconds: e.QUOTE_TTL_SECONDS,
    offerTtlSeconds: e.OFFER_TTL_SECONDS,
    perPurchaseLimitMinor: { USD: e.DEMO_PER_PURCHASE_LIMIT_USD_MINOR },
    serviceFeeBps: e.SERVICE_FEE_BPS,
  };
}

/** Helper for adapters: which of these env names are missing/empty. Never returns values. */
export function missingEnv(env: NodeJS.ProcessEnv, names: string[]): string[] {
  return names.filter((n) => !env[n] || String(env[n]).trim() === '');
}
