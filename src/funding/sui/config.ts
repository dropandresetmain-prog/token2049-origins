import { z } from 'zod';
import { SUI_TESTNET_NETWORK, SUI_TESTNET_USDC_TYPE } from '../../contracts/presentation.js';

export const NETWORK = SUI_TESTNET_NETWORK;
export const USDC_TYPE = SUI_TESTNET_USDC_TYPE;
// Full genesis checkpoint digest read from the official Testnet fullnode, 8 October 2026.
export const TESTNET_GENESIS = '69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD';
export const RPC_URL = 'https://fullnode.testnet.sui.io:443';
export const SUI_TYPE = '0x2::sui::SUI';
export const Address = z.string().regex(/^0x[0-9a-f]{64}$/);
export const PositiveUnits = z.string().regex(/^[1-9][0-9]{0,19}$/).refine(v => BigInt(v) <= 18446744073709551615n);
const Config = z.object({
  SUI_NETWORK: z.enum(['testnet', NETWORK]), SUI_RPC_URL: z.literal(RPC_URL),
  SUI_USDC_TYPE: z.literal(USDC_TYPE), SUI_ASSET_DECIMALS: z.literal('6'),
  SUI_TREASURY_ADDRESS: Address.refine(v => v !== '0x' + '0'.repeat(64)),
  SUI_MAX_PAYMENT_BASE_UNITS: PositiveUnits.refine(v => BigInt(v) <= 1000000n),
  SUI_MAX_GAS_BUDGET_MIST: PositiveUnits.refine(v => BigInt(v) <= 50000000n),
});
export function parseSuiConfig(env: NodeJS.ProcessEnv) {
  const p = Config.safeParse(env);
  if (!p.success) return { ok: false as const, missing: [...new Set(p.error.issues.map(i => String(i.path[0])))] };
  return { ok: true as const, config: { rpcUrl: p.data.SUI_RPC_URL, payee: p.data.SUI_TREASURY_ADDRESS,
    maxAmount: BigInt(p.data.SUI_MAX_PAYMENT_BASE_UNITS), maxGasBudget: BigInt(p.data.SUI_MAX_GAS_BUDGET_MIST) } };
}
export type SuiConfig = Extract<ReturnType<typeof parseSuiConfig>, { ok: true }>['config'];
