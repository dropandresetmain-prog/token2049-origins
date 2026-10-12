import { z } from 'zod';
import { isAbsolute, join } from 'node:path';
import { EvmAddress, MAX_PAYMENT_CEILING, MAX_TOTAL_GAS_CEILING_WEI, PositiveUnits, parseXLayerConfig } from '../../src/funding/xlayer/config.js';

const SafeOrigin = z.string().refine(v => {
  try {
    const u = new URL(v);
    return !u.username && !u.password && !u.search && !u.hash && u.pathname === '/' &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)));
  } catch { return false; }
});
export function loadXLayerPayerConfig(env: NodeJS.ProcessEnv, opts: { ledger?: 'external' } = {}) {
  const gateway = parseXLayerConfig(env);
  if (!gateway.ok) throw new Error('invalid X Layer configuration: ' + gateway.missing.join(','));
  const parsed = z.object({
    XLAYER_PAYER_ADDRESS: EvmAddress, XLAYER_PAYER_KEY_FILE: z.string().refine(isAbsolute),
    XLAYER_GATEWAY_URL: SafeOrigin, XLAYER_GATEWAY_TOKEN_FILE: z.string().refine(isAbsolute),
    XLAYER_PAYER_MAX_PAYMENT_BASE_UNITS: PositiveUnits, XLAYER_PAYER_MAX_DAILY_BASE_UNITS: PositiveUnits,
    XLAYER_PAYER_MAX_TOTAL_BASE_UNITS: PositiveUnits, XLAYER_PAYER_MAX_TOTAL_GAS_WEI: PositiveUnits,
    XLAYER_PAYER_MAX_COMMERCIAL_USD_MINOR: PositiveUnits,
    XLAYER_LEDGER_DIRECTORY: z.string().refine(isAbsolute).optional(),
  }).safeParse(env);
  if (!parsed.success) throw new Error('invalid X Layer payer configuration: ' + [...new Set(parsed.error.issues.map(i => String(i.path[0])))].join(','));
  const e = parsed.data, cfg = gateway.config;
  if (opts.ledger !== 'external' && !e.XLAYER_LEDGER_DIRECTORY) throw new Error('invalid X Layer payer configuration: XLAYER_LEDGER_DIRECTORY');
  const policy = { maxPerPayment: BigInt(e.XLAYER_PAYER_MAX_PAYMENT_BASE_UNITS), maxDaily: BigInt(e.XLAYER_PAYER_MAX_DAILY_BASE_UNITS),
    maxTotal: BigInt(e.XLAYER_PAYER_MAX_TOTAL_BASE_UNITS), maxGasPerPayment: cfg.maxGasBudget, maxGasTotal: BigInt(e.XLAYER_PAYER_MAX_TOTAL_GAS_WEI) };
  const maxCommercial = BigInt(e.XLAYER_PAYER_MAX_COMMERCIAL_USD_MINOR);
  // Signer isolation and the same spending ceilings as the Sui rail (5,100,000 base units; USD 5,100.00 commercial).
  if (e.XLAYER_PAYER_ADDRESS === cfg.payee || policy.maxPerPayment > cfg.maxAmount || policy.maxPerPayment > policy.maxDaily ||
      policy.maxDaily > policy.maxTotal || policy.maxTotal > MAX_PAYMENT_CEILING || policy.maxGasTotal > MAX_TOTAL_GAS_CEILING_WEI ||
      policy.maxGasPerPayment > policy.maxGasTotal || maxCommercial > 510000n) throw new Error('X Layer signer isolation or spending caps invalid');
  return { ...cfg, policy, maxCommercial, payer: e.XLAYER_PAYER_ADDRESS, keyFile: e.XLAYER_PAYER_KEY_FILE,
    ledger: opts.ledger === 'external' ? '' : join(e.XLAYER_LEDGER_DIRECTORY!, 'xlayer-ledger.json'),
    gatewayUrl: e.XLAYER_GATEWAY_URL.replace(/\/$/, ''), tokenFile: e.XLAYER_GATEWAY_TOKEN_FILE };
}
export type XLayerPayerConfig = ReturnType<typeof loadXLayerPayerConfig>;
