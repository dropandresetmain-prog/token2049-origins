import { z } from 'zod';
import { isAbsolute, join } from 'node:path';
import { Address, PositiveUnits, parseSuiConfig } from '../../src/funding/sui/config.js';

const SafeOrigin = z.string().refine(v => {
  try {
    const u = new URL(v);
    return !u.username && !u.password && !u.search && !u.hash && u.pathname === '/' &&
      (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)));
  } catch { return false; }
});
export function loadSuiPayerConfig(env: NodeJS.ProcessEnv, opts: { ledger?: 'external' } = {}) {
  const gateway = parseSuiConfig(env);
  if (!gateway.ok) throw new Error('invalid Sui configuration: ' + gateway.missing.join(','));
  const payerFields = z.object({
    SUI_PAYER_ADDRESS: Address, SUI_PAYER_KEY_FILE: z.string().refine(isAbsolute),
    SUI_GATEWAY_URL: SafeOrigin,
    SUI_GATEWAY_TOKEN_FILE: z.string().refine(isAbsolute),
    SUI_PAYER_MAX_PAYMENT_BASE_UNITS: PositiveUnits, SUI_PAYER_MAX_DAILY_BASE_UNITS: PositiveUnits,
    SUI_PAYER_MAX_TOTAL_BASE_UNITS: PositiveUnits, SUI_PAYER_MAX_TOTAL_GAS_MIST: PositiveUnits,
    SUI_PAYER_MAX_COMMERCIAL_USD_MINOR: PositiveUnits,
  });
  const parsed = payerFields.extend({ SUI_LEDGER_DIRECTORY: z.string().refine(isAbsolute).optional() }).safeParse(env);
  if (!parsed.success) throw new Error('invalid Sui payer configuration: ' + [...new Set(parsed.error.issues.map(i => String(i.path[0])))].join(','));
  const e = parsed.data, cfg = gateway.config;
  if (opts.ledger !== 'external' && !e.SUI_LEDGER_DIRECTORY) throw new Error('invalid Sui payer configuration: SUI_LEDGER_DIRECTORY');
  const policy = { maxPerPayment: BigInt(e.SUI_PAYER_MAX_PAYMENT_BASE_UNITS), maxDaily: BigInt(e.SUI_PAYER_MAX_DAILY_BASE_UNITS),
    maxTotal: BigInt(e.SUI_PAYER_MAX_TOTAL_BASE_UNITS), maxGasPerPayment: cfg.maxGasBudget, maxGasTotal: BigInt(e.SUI_PAYER_MAX_TOTAL_GAS_MIST) };
  const maxCommercial = BigInt(e.SUI_PAYER_MAX_COMMERCIAL_USD_MINOR);
  if (e.SUI_PAYER_ADDRESS === cfg.payee || policy.maxPerPayment > cfg.maxAmount || policy.maxPerPayment > policy.maxDaily ||
      policy.maxDaily > policy.maxTotal || policy.maxTotal > 1000000n || policy.maxGasTotal > 500000000n ||
      policy.maxGasPerPayment > policy.maxGasTotal || maxCommercial > 50000n) throw new Error('Sui signer isolation or spending caps invalid');
  return { ...cfg, policy, maxCommercial, payer: e.SUI_PAYER_ADDRESS, keyFile: e.SUI_PAYER_KEY_FILE,
    ledger: opts.ledger === 'external' ? '' : join(e.SUI_LEDGER_DIRECTORY!, 'sui-ledger.json'),
    gatewayUrl: e.SUI_GATEWAY_URL.replace(/\/$/, ''), tokenFile: e.SUI_GATEWAY_TOKEN_FILE };
}
export type SuiPayerConfig = ReturnType<typeof loadSuiPayerConfig>;
