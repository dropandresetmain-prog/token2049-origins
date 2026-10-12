import { z } from 'zod';
import { isAddress } from 'viem';
import { XLAYER_TESTNET_NETWORK, XLAYER_TESTNET_USDT0 } from '../../contracts/presentation.js';

export const NETWORK = XLAYER_TESTNET_NETWORK;
export const CHAIN_ID = 1952;
export const TOKEN = XLAYER_TESTNET_USDT0;
export const TOKEN_DECIMALS = 6;
/** On-chain symbol of the official X Layer Testnet USD₮0 (U+20AE), read from the contract on 13 October 2026. */
export const TOKEN_SYMBOL = 'USD₮0';
/** Official X Layer Testnet RPC endpoints (OKX network-information page, 13 October 2026). Nothing else is accepted. */
export const RPC_URLS = ['https://testrpc.xlayer.tech/terigon', 'https://xlayertestrpc.okx.com/terigon'] as const;
export const EXPLORER_TX_URL = 'https://www.okx.com/web3/explorer/xlayer-test/tx/';
export const ZERO_ADDRESS = '0x' + '0'.repeat(40);
/** Same ceilings as the Sui rail (5.1 test USD₮0 per payment); gas is OKB wei with a rail-specific ceiling. */
export const MAX_PAYMENT_CEILING = 5100000n;
export const MAX_GAS_BUDGET_CEILING_WEI = 10n ** 16n; // 0.01 OKB per payment
export const MAX_TOTAL_GAS_CEILING_WEI = 10n ** 17n; // 0.1 OKB cumulative

export const EvmAddress = z.string().refine(v => isAddress(v, { strict: false }), 'invalid EVM address').transform(v => v.toLowerCase())
  .refine(v => v !== ZERO_ADDRESS, 'zero address forbidden');
export const PositiveUnits = z.string().regex(/^[1-9][0-9]{0,29}$/);
const Config = z.object({
  XLAYER_NETWORK: z.literal(NETWORK), XLAYER_CHAIN_ID: z.literal(String(CHAIN_ID)),
  XLAYER_RPC_URL: z.enum(RPC_URLS), XLAYER_TOKEN_ADDRESS: z.string().transform(v => v.toLowerCase()).pipe(z.literal(TOKEN)),
  XLAYER_ASSET_DECIMALS: z.literal(String(TOKEN_DECIMALS)),
  XLAYER_TREASURY_ADDRESS: EvmAddress,
  XLAYER_MAX_PAYMENT_BASE_UNITS: PositiveUnits.refine(v => BigInt(v) <= MAX_PAYMENT_CEILING),
  XLAYER_MAX_GAS_BUDGET_WEI: PositiveUnits.refine(v => BigInt(v) <= MAX_GAS_BUDGET_CEILING_WEI),
  XLAYER_CONFIRMATIONS: z.string().regex(/^[1-9][0-9]?$/).refine(v => Number(v) <= 20).optional(),
});
export function parseXLayerConfig(env: NodeJS.ProcessEnv) {
  const p = Config.safeParse(env);
  if (!p.success) return { ok: false as const, missing: [...new Set(p.error.issues.map(i => String(i.path[0])))] };
  return { ok: true as const, config: { rpcUrl: p.data.XLAYER_RPC_URL as string, payee: p.data.XLAYER_TREASURY_ADDRESS,
    maxAmount: BigInt(p.data.XLAYER_MAX_PAYMENT_BASE_UNITS), maxGasBudget: BigInt(p.data.XLAYER_MAX_GAS_BUDGET_WEI),
    confirmations: Number(p.data.XLAYER_CONFIRMATIONS ?? '2') } };
}
export type XLayerConfig = Extract<ReturnType<typeof parseXLayerConfig>, { ok: true }>['config'];
