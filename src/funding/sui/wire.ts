import { z } from 'zod';
import { bcs } from '@mysten/sui/bcs';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import { parseSerializedSignature } from '@mysten/sui/cryptography';
import { normalizeStructTag, normalizeSuiAddress } from '@mysten/sui/utils';
import { verifyPersonalMessageSignature, verifyTransactionSignature } from '@mysten/sui/verify';
import type { FundingRequirementInput } from '../../contracts/ports.js';
import { canonicalJson } from '../../infrastructure/ids.js';
import { validateSettlement } from '../../contracts/settlement.js';
import { Address, NETWORK, USDC_TYPE, TESTNET_GENESIS, type SuiConfig } from './config.js';

export const Candidate = z.object({ version: z.literal(1), protocol: z.literal('sui-usdc-transfer'),
  transaction: z.string().min(1).max(20000), signature: z.string().min(1).max(200),
  bindingSignature: z.string().min(1).max(200), digest: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{43,44}$/),
}).strict();
export type SuiCandidate = z.infer<typeof Candidate>;
export function bindingMessage(input: FundingRequirementInput, digest: string): Uint8Array {
  return new TextEncoder().encode(canonicalJson({ domain: 'capsule-sui-purchase-v1', digest,
    purchaseId: input.purchaseId, quoteId: input.quoteId, quoteDigest: input.quoteDigest,
    network: input.amount.network, asset: input.amount.assetId, decimals: input.amount.decimals,
    amount: input.amount.amountBaseUnits, payTo: input.payTo, resourceUrl: input.resourceUrl,
    expiresAt: input.expiresAt, settlement: input.settlement ?? null }));
}
export function assertRequirement(input: FundingRequirementInput, cfg: SuiConfig, now: Date, allowExpired = false): void {
  if (input.amount.network !== NETWORK || input.amount.assetId !== USDC_TYPE || input.amount.decimals !== 6 || input.payTo !== cfg.payee ||
      !/^[1-9][0-9]*$/.test(input.amount.amountBaseUnits) || BigInt(input.amount.amountBaseUnits) > cfg.maxAmount ||
      !Number.isFinite(Date.parse(input.expiresAt)) || (!allowExpired && Date.parse(input.expiresAt) <= now.getTime())) throw new Error('Sui funding requirement unavailable, expired or outside policy');
  if (input.settlement) {
    const s = validateSettlement(input.settlement, 6);
    if (s.policy.mode !== 'scaled_testnet' || s.totalBaseUnits !== input.amount.amountBaseUnits) throw new Error('Sui settlement mismatch');
  }
}
export function decodeBytes(base64: string): Uint8Array {
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 15000 || bytes.toString('base64') !== base64) throw new Error('invalid Sui transaction encoding');
  return bytes;
}

/** Accept only a bounded exact coin transfer, or the standard framework redemption of an exact sender balance. */
export function assertTransaction(bytes: Uint8Array, input: FundingRequirementInput, maxGasBudget: bigint) {
  const tx = Transaction.from(bytes), d = tx.getData();
  const payer = Address.parse(d.sender);
  if (payer === input.payTo || d.gasData.owner !== payer || !d.gasData.budget || BigInt(d.gasData.budget) <= 0n ||
      BigInt(d.gasData.budget) > maxGasBudget || !d.gasData.payment || d.gasData.payment.length > 32 ||
      !d.gasData.price || BigInt(d.gasData.price) <= 0n) throw new Error('Sui sender or gas policy mismatch');
  const validity = d.expiration?.ValidDuring;
  if (validity) {
    if (validity.chain !== TESTNET_GENESIS || validity.minEpoch === null || validity.maxEpoch === null ||
        BigInt(validity.maxEpoch) < BigInt(validity.minEpoch) || BigInt(validity.maxEpoch) - BigInt(validity.minEpoch) > 1n ||
        validity.minTimestamp !== null || (validity.maxTimestamp !== null && validity.maxTimestamp !== String(Date.parse(input.expiresAt)))) throw new Error('Sui validity window mismatch');
  } else if (d.expiration?.$kind !== 'Epoch' || !d.gasData.payment.length) throw new Error('Sui gas balance requires chain-bound replay protection');
  const redemption = d.commands[0]?.MoveCall;
  if (redemption) {
    const transfer = d.commands[1]?.TransferObjects;
    if (!validity || d.commands.length !== 2 || normalizeSuiAddress(redemption.package) !== normalizeSuiAddress('0x2') ||
        redemption.module !== 'coin' || redemption.function !== 'redeem_funds' || redemption.typeArguments.length !== 1 ||
        normalizeStructTag(redemption.typeArguments[0]!) !== normalizeStructTag(USDC_TYPE) || redemption.arguments.length !== 1 ||
        redemption.arguments[0]?.$kind !== 'Input' || !transfer || transfer.address.$kind !== 'Input' || transfer.objects.length !== 1 ||
        transfer.objects[0]?.$kind !== 'Result' || transfer.objects[0].Result !== 0 || d.inputs.length !== 2) throw new Error('Sui balance transfer commands mismatch');
    const withdrawalIndex = redemption.arguments[0].Input, recipientIndex = transfer.address.Input;
    const withdrawal = d.inputs[withdrawalIndex]?.FundsWithdrawal, recipient = d.inputs[recipientIndex]?.Pure;
    if (withdrawalIndex === recipientIndex || !withdrawal || !recipient || withdrawal.withdrawFrom.$kind !== 'Sender' ||
        withdrawal.reservation.$kind !== 'MaxAmountU64' || withdrawal.reservation.MaxAmountU64 !== input.amount.amountBaseUnits ||
        withdrawal.typeArg.$kind !== 'Balance' || normalizeStructTag(withdrawal.typeArg.Balance) !== normalizeStructTag(USDC_TYPE) ||
        bcs.Address.parse(Buffer.from(recipient.bytes, 'base64')) !== input.payTo) throw new Error('Sui exact sender balance withdrawal mismatch');
    return { payer, digest: TransactionDataBuilder.getDigestFromBytes(bytes), gasBudget: d.gasData.budget, objects: [] };
  }
  if (d.commands.length < 2 || d.commands.length > 3) throw new Error('unsupported Sui payment commands');
  const merge = d.commands.length === 3 ? d.commands[0]?.MergeCoins : undefined;
  const splitIndex = merge ? 1 : 0;
  if (d.commands.length === 3 && !merge) throw new Error('unexpected Sui command');
  const split = d.commands[splitIndex]?.SplitCoins, transfer = d.commands[splitIndex + 1]?.TransferObjects;
  if (!split || !transfer || split.coin.$kind !== 'Input' || split.amounts.length !== 1 || split.amounts[0]?.$kind !== 'Input' ||
      transfer.address.$kind !== 'Input' || transfer.objects.length !== 1 || transfer.objects[0]?.$kind !== 'NestedResult' ||
      transfer.objects[0].NestedResult[0] !== splitIndex || transfer.objects[0].NestedResult[1] !== 0) throw new Error('Sui exact split/transfer mismatch');
  const coins = [split.coin.Input];
  if (merge) {
    if (merge.destination.$kind !== 'Input' || merge.destination.Input !== split.coin.Input || !merge.sources.length || merge.sources.some(a => a.$kind !== 'Input')) throw new Error('Sui merge mismatch');
    coins.push(...merge.sources.map(a => (a as { Input: number }).Input));
  }
  const amountIndex = split.amounts[0].Input, recipientIndex = transfer.address.Input;
  const used = [...coins, amountIndex, recipientIndex];
  if (new Set(used).size !== used.length || used.length !== d.inputs.length || coins.length > 32) throw new Error('Sui unused or duplicated input');
  const amount = d.inputs[amountIndex]?.Pure, recipient = d.inputs[recipientIndex]?.Pure;
  if (!amount || !recipient || bcs.u64().parse(Buffer.from(amount.bytes, 'base64')) !== input.amount.amountBaseUnits ||
      bcs.Address.parse(Buffer.from(recipient.bytes, 'base64')) !== input.payTo) throw new Error('Sui amount or recipient mismatch');
  const objects = coins.map(i => d.inputs[i]?.Object?.ImmOrOwnedObject);
  if (objects.some(o => !o) || new Set(objects.map(o => o!.objectId)).size !== objects.length ||
      objects.some(o => d.gasData.payment!.some(g => g.objectId === o!.objectId))) throw new Error('Sui payment objects mismatch');
  return { payer, digest: TransactionDataBuilder.getDigestFromBytes(bytes), gasBudget: d.gasData.budget, objects: objects.map(o => o!) };
}
export function encodeCandidate(c: SuiCandidate): string { return Buffer.from(JSON.stringify(Candidate.parse(c))).toString('base64'); }
export async function readCandidate(header: string, input: FundingRequirementInput, cfg: SuiConfig) {
  if (header.length > 30000) throw new Error('Sui candidate too large');
  const raw = Buffer.from(header, 'base64');
  if (raw.toString('base64') !== header) throw new Error('invalid Sui header encoding');
  const candidate = Candidate.parse(JSON.parse(raw.toString('utf8'))), bytes = decodeBytes(candidate.transaction);
  const transfer = assertTransaction(bytes, input, cfg.maxGasBudget);
  if (transfer.digest !== candidate.digest || [candidate.signature, candidate.bindingSignature].some(s => parseSerializedSignature(s).signatureScheme !== 'ED25519')) throw new Error('Sui signature scheme or digest mismatch');
  await verifyTransactionSignature(bytes, candidate.signature, { address: transfer.payer });
  // This separate signature binds the exact candidate to approval; the ordinary transfer has no on-chain order identifier.
  await verifyPersonalMessageSignature(bindingMessage(input, candidate.digest), candidate.bindingSignature, { address: transfer.payer });
  return { candidate, bytes, transfer };
}
