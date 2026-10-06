import { z } from 'zod';
import { address } from '@solana/kit';
import { NETWORK, TEST_MINT } from './wire.js';
const Address = z.string().refine(v => { try { address(v); return true; } catch { return false; } });
export const trustedRpc = (v: string) => v === 'https://api.devnet.solana.com';
export const trustedFacilitator = (v: string) => { try { const u = new URL(v); return u.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) && !u.username && !u.password && !u.search && !u.hash && u.pathname === '/'; } catch { return false; } };
const Config = z.object({
  SOLANA_NETWORK: z.enum(['devnet', NETWORK]), SOLANA_RPC_URL: z.string().refine(trustedRpc),
  SOLANA_USDC_MINT: z.literal(TEST_MINT), SOLANA_ASSET_DECIMALS: z.literal('6'),
  SOLANA_TREASURY_ADDRESS: Address, SOLANA_TREASURY_TOKEN_ACCOUNT: Address,
  SOLANA_FACILITATOR_TOKEN_FILE: z.string().min(1), SOLANA_FEE_PAYER_ADDRESS: Address, SOLANA_FACILITATOR_URL: z.string().refine(trustedFacilitator),
  SOLANA_MAX_PAYMENT_BASE_UNITS: z.string().regex(/^[1-9][0-9]*$/),
});
export function parseSolanaConfig(env: NodeJS.ProcessEnv) {
  const p = Config.safeParse(env);
  if (!p.success) return { ok: false as const, missing: [...new Set(p.error.issues.map(i => String(i.path[0])))] };
  if (BigInt(p.data.SOLANA_MAX_PAYMENT_BASE_UNITS) > 1000000n) return { ok: false as const, missing: ['SOLANA_MAX_PAYMENT_BASE_UNITS'] };
  return { ok: true as const, config: { rpcUrl: p.data.SOLANA_RPC_URL, mint: p.data.SOLANA_USDC_MINT, payee: p.data.SOLANA_TREASURY_ADDRESS,
    tokenAccount: p.data.SOLANA_TREASURY_TOKEN_ACCOUNT, sponsor: p.data.SOLANA_FEE_PAYER_ADDRESS,
    facilitatorTokenFile: p.data.SOLANA_FACILITATOR_TOKEN_FILE, facilitatorUrl: p.data.SOLANA_FACILITATOR_URL.replace(/\/$/, ''), maxAmount: BigInt(p.data.SOLANA_MAX_PAYMENT_BASE_UNITS) } };
}
export type SolanaConfig = Extract<ReturnType<typeof parseSolanaConfig>, { ok: true }>['config'];
