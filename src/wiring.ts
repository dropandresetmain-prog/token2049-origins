import type { GatewayParts } from './composition.js';

/**
 * Real adapter wiring for the runnable gateway. Each adapter reads its own env and reports
 * MISSING_CONFIG when unconfigured; none falls back to fixtures.
 * Adapters are registered here as they land (Shopify, Atlas, Nuitée, Cardano, OCBC).
 */
export function realParts(_env: NodeJS.ProcessEnv, _log: (l: Record<string, unknown>) => void): GatewayParts {
  return { executors: [], fundingAdapters: [], bankAdapters: [] };
}
