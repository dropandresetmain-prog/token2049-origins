import { z } from 'zod';
import { encodeFunctionData, keccak256, parseAbi, parseTransaction, recoverMessageAddress, recoverTransactionAddress, type Hex } from 'viem';
import type { FundingRequirementInput } from '../../contracts/ports.js';
import { canonicalJson } from '../../infrastructure/ids.js';
import { validateSettlement } from '../../contracts/settlement.js';
import { CHAIN_ID, NETWORK, TOKEN, TOKEN_DECIMALS, type XLayerConfig } from './config.js';

export const PROTOCOL = 'xlayer-usdt0-transfer' as const;
export const TX_HASH = /^0x[0-9a-f]{64}$/;
export const ERC20_ABI = parseAbi(['function transfer(address to, uint256 value) returns (bool)']);
export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

export const Candidate = z.object({ version: z.literal(1), protocol: z.literal(PROTOCOL),
  rawTransaction: z.string().regex(/^0x[0-9a-f]{2,6000}$/), bindingSignature: z.string().regex(/^0x[0-9a-f]{130}$/),
  hash: z.string().regex(TX_HASH),
}).strict();
export type XLayerCandidate = z.infer<typeof Candidate>;

export function transferCalldata(payTo: string, amount: bigint): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [payTo as Hex, amount] });
}
export function bindingMessage(input: FundingRequirementInput, hash: string): string {
  return canonicalJson({ domain: 'capsule-xlayer-purchase-v1', hash,
    purchaseId: input.purchaseId, quoteId: input.quoteId, quoteDigest: input.quoteDigest,
    network: input.amount.network, asset: input.amount.assetId, decimals: input.amount.decimals,
    amount: input.amount.amountBaseUnits, payTo: input.payTo, resourceUrl: input.resourceUrl,
    expiresAt: input.expiresAt, settlement: input.settlement ?? null });
}
export function assertRequirement(input: FundingRequirementInput, cfg: XLayerConfig, now: Date, allowExpired = false): void {
  if (input.amount.network !== NETWORK || input.amount.assetId !== TOKEN || input.amount.decimals !== TOKEN_DECIMALS || input.payTo !== cfg.payee ||
      !/^[1-9][0-9]*$/.test(input.amount.amountBaseUnits) || BigInt(input.amount.amountBaseUnits) > cfg.maxAmount ||
      !Number.isFinite(Date.parse(input.expiresAt)) || (!allowExpired && Date.parse(input.expiresAt) <= now.getTime())) throw new Error('X Layer funding requirement unavailable, expired or outside policy');
  if (input.settlement) {
    const s = validateSettlement(input.settlement, TOKEN_DECIMALS);
    if (s.policy.mode !== 'scaled_testnet' || s.totalBaseUnits !== input.amount.amountBaseUnits) throw new Error('X Layer settlement mismatch');
  }
}

/** Accept only one bounded EIP-1559 ERC-20 transfer(payTo, amount) to the pinned token on the pinned chain. */
export async function assertTransaction(raw: Hex, input: FundingRequirementInput, maxGasBudget: bigint) {
  const tx = parseTransaction(raw);
  if (tx.type !== 'eip1559' || tx.chainId !== CHAIN_ID || tx.to?.toLowerCase() !== TOKEN || (tx.value ?? 0n) !== 0n ||
      (tx.accessList?.length ?? 0) !== 0 || tx.nonce === undefined || !Number.isSafeInteger(tx.nonce) || tx.nonce < 0) throw new Error('X Layer transaction type, chain, target or value mismatch');
  if (tx.data !== transferCalldata(input.payTo, BigInt(input.amount.amountBaseUnits))) throw new Error('X Layer transfer recipient or amount mismatch');
  if (!tx.gas || tx.gas <= 0n || !tx.maxFeePerGas || tx.maxFeePerGas <= 0n || tx.maxPriorityFeePerGas === undefined ||
      tx.maxPriorityFeePerGas > tx.maxFeePerGas || tx.gas * tx.maxFeePerGas > maxGasBudget) throw new Error('X Layer gas policy mismatch');
  const payer = (await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` })).toLowerCase();
  if (payer === input.payTo) throw new Error('X Layer payer equals recipient');
  return { payer, hash: keccak256(raw), nonce: tx.nonce, gasBudget: tx.gas * tx.maxFeePerGas };
}
export function encodeCandidate(c: XLayerCandidate): string { return Buffer.from(JSON.stringify(Candidate.parse(c))).toString('base64'); }
export async function readCandidate(header: string, input: FundingRequirementInput, cfg: XLayerConfig) {
  if (header.length > 12000) throw new Error('X Layer candidate too large');
  const raw = Buffer.from(header, 'base64');
  if (raw.toString('base64') !== header) throw new Error('invalid X Layer header encoding');
  const candidate = Candidate.parse(JSON.parse(raw.toString('utf8')));
  const transfer = await assertTransaction(candidate.rawTransaction as Hex, input, cfg.maxGasBudget);
  if (transfer.hash !== candidate.hash) throw new Error('X Layer transaction hash mismatch');
  // Separate signature binds the exact candidate to this approval; an ordinary ERC-20 transfer carries no order identifier.
  const signer = await recoverMessageAddress({ message: bindingMessage(input, candidate.hash), signature: candidate.bindingSignature as Hex });
  if (signer.toLowerCase() !== transfer.payer) throw new Error('X Layer binding signature signer mismatch');
  return { candidate, transfer };
}
