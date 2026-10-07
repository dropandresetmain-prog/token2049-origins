import { z } from 'zod';
import { resolve, isAbsolute, join } from 'node:path';
import { parseSolanaConfig, trustedRpc } from '../../src/funding/solana/config.js';
export function loadSolanaPayerConfig(env: NodeJS.ProcessEnv, opts: { ledger?: 'file' | 'external' } = {}) {
  const gateway = parseSolanaConfig(env); if (!gateway.ok) throw new Error('invalid Solana configuration: ' + gateway.missing.join(','));
  const p = z.object({ SOLANA_PAYER_RPC_URL: z.string().refine(trustedRpc), SOLANA_PAYER_ADDRESS: z.string(), SOLANA_PAYER_TOKEN_ACCOUNT: z.string(),
    SOLANA_PAYER_KEY_FILE: z.string(), SOLANA_LEDGER_DIRECTORY: z.string().refine(isAbsolute),
    SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS: z.string().regex(/^[1-9][0-9]*$/), SOLANA_PAYER_MAX_TOTAL_BASE_UNITS: z.string().regex(/^[1-9][0-9]*$/),
    SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR: z.string().regex(/^[1-9][0-9]*$/), SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS: z.string().regex(/^[1-9][0-9]*$/),
    SOLANA_SPONSOR_KEY_FILE: z.string(), SOLANA_GATEWAY_URL: z.string(), SOLANA_GATEWAY_TOKEN_FILE: z.string(),
  }).safeParse(opts.ledger === 'external' ? { ...env, SOLANA_LEDGER_DIRECTORY: resolve('.runtime/unused-external-ledger') } : env);
  if (!p.success) throw new Error('invalid Solana payer configuration: ' + [...new Set(p.error.issues.map(i => String(i.path[0])))].join(','));
  const e = p.data, cfg = gateway.config;
  const maxPerPayment = BigInt(e.SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS), maxTotal = BigInt(e.SOLANA_PAYER_MAX_TOTAL_BASE_UNITS), maxFees = BigInt(e.SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS);
  if (maxPerPayment > maxTotal || maxTotal > 1000000n || maxPerPayment > cfg.maxAmount || maxFees > 1000000n || BigInt(e.SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR) > 50000n || e.SOLANA_PAYER_ADDRESS === cfg.sponsor) throw new Error('Solana payer cap or signer isolation invalid');
  const u = new URL(e.SOLANA_GATEWAY_URL);
  if (u.username || u.password || u.search || u.hash || !(u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1','localhost'].includes(u.hostname)))) throw new Error('invalid gateway origin');
  return { ...cfg, payerRpcUrl: e.SOLANA_PAYER_RPC_URL, payer: e.SOLANA_PAYER_ADDRESS, source: e.SOLANA_PAYER_TOKEN_ACCOUNT,
    keyFile: e.SOLANA_PAYER_KEY_FILE, sponsorKeyFile: e.SOLANA_SPONSOR_KEY_FILE, ledgerDirectory: resolve(e.SOLANA_LEDGER_DIRECTORY),
    payerLedger: join(resolve(e.SOLANA_LEDGER_DIRECTORY), e.SOLANA_PAYER_ADDRESS + '.json'), sponsorLedger: join(resolve(e.SOLANA_LEDGER_DIRECTORY), cfg.sponsor + '.json'),
    maxPerPayment, maxTotal, maxFees, maxCommercial: BigInt(e.SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR), gatewayUrl: e.SOLANA_GATEWAY_URL.replace(/\/$/, ''), tokenFile: e.SOLANA_GATEWAY_TOKEN_FILE };
}
export type SolanaPayerConfig = ReturnType<typeof loadSolanaPayerConfig>;
