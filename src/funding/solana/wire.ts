import { createHash, createPublicKey, verify } from 'node:crypto';
import { decompileTransactionMessage, getCompiledTransactionMessageDecoder, getAddressEncoder, getBase58Decoder } from '@solana/kit';
import { decodeTransactionFromPayload, SOLANA_DEVNET_CAIP2, USDC_DEVNET_ADDRESS, TOKEN_PROGRAM_ADDRESS, MEMO_PROGRAM_ADDRESS, COMPUTE_BUDGET_PROGRAM_ADDRESS } from '@x402/svm';
import { decodePaymentSignatureHeader } from '@x402/core/http';
import { deepEqual } from '@x402/core/utils';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { validateSettlement } from '../../contracts/settlement.js';
import type { FundingRequirementInput } from '../../contracts/ports.js';
export const NETWORK = SOLANA_DEVNET_CAIP2;
export const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const TOKEN_PROGRAM = TOKEN_PROGRAM_ADDRESS;
export const TEST_MINT = USDC_DEVNET_ADDRESS;
export function commitment(input: FundingRequirementInput, tokenAccount: string): string {
  if (!/^[1-9][0-9]*$/.test(input.amount.amountBaseUnits) || BigInt(input.amount.amountBaseUnits) > 18446744073709551615n ||
      !Number.isFinite(Date.parse(input.expiresAt)) || !input.purchaseId || !input.quoteId || !input.quoteDigest || !input.resourceUrl) throw new Error('invalid requirement');
  const settlement = input.settlement ? validateSettlement(input.settlement, input.amount.decimals) : null;
  if (settlement && settlement.totalBaseUnits !== input.amount.amountBaseUnits) throw new Error('invalid settlement total');
  return 't2o:' + createHash('sha256').update(JSON.stringify({ network: input.amount.network,
    mint: input.amount.assetId, decimals: input.amount.decimals, payee: input.payTo, tokenAccount,
    amount: input.amount.amountBaseUnits, purchase: input.purchaseId, quote: input.quoteId, digest: input.quoteDigest,
    resource: input.resourceUrl, expiresAt: input.expiresAt, settlement })).digest('base64url');
}
export interface Transfer { signature: string | null; payer: string; sponsor: string; source: string; destination: string; mint: string; amount: string; decimals: number; memo: string; message: Uint8Array; accounts: readonly string[]; }
/** Official SDK decoder plus a stricter application policy; no unknown instructions or lookup tables. */
export function decodeTransaction(base64: string, requireSponsor = true): Transfer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 1644 || Buffer.from(base64, 'base64').toString('base64') !== base64) throw new Error('invalid transaction encoding');
  const tx = decodeTransactionFromPayload({ transaction: base64 });
  const compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (compiled.version !== 0 || compiled.header.numSignerAccounts !== 2 || ('addressTableLookups' in compiled && compiled.addressTableLookups?.length)) throw new Error('unsupported transaction');
  const d = decompileTransactionMessage(compiled);
  const ix = d.instructions;
  if (ix.length !== 4 || ix[0]?.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS || ix[1]?.programAddress !== COMPUTE_BUDGET_PROGRAM_ADDRESS ||
      ix[2]?.programAddress !== TOKEN_PROGRAM || ix[3]?.programAddress !== MEMO_PROGRAM_ADDRESS) throw new Error('unexpected programs');
  const limit = Buffer.from(ix[0]?.data ?? []), price = Buffer.from(ix[1]?.data ?? []);
  if (limit.length !== 5 || limit[0] !== 2 || limit.readUInt32LE(1) > 20_000 || limit.readUInt32LE(1) < 1 ||
      price.length !== 9 || price[0] !== 3 || price.readBigUInt64LE(1) > 1n) throw new Error('excessive compute fee');
  const transfer = ix[2]!, accounts = transfer.accounts ?? [], data = Buffer.from(transfer.data ?? []);
  const memo = Buffer.from(ix[3]?.data ?? []).toString('utf8');
  if (accounts.length !== 4 || data.length !== 10 || data[0] !== 12 || !/^t2o:[A-Za-z0-9_-]{43}$/.test(memo) || ix[3]?.accounts?.length) throw new Error('invalid transfer or memo');
  const sponsor = compiled.staticAccounts[0]!, payer = accounts[3]!.address;
  const allowedAccounts=new Set([sponsor,payer,accounts[0]!.address,accounts[1]!.address,accounts[2]!.address,COMPUTE_BUDGET_PROGRAM_ADDRESS,TOKEN_PROGRAM,MEMO_PROGRAM_ADDRESS]);
  if(allowedAccounts.size!==8||compiled.staticAccounts.length!==8||compiled.staticAccounts.some(a=>!allowedAccounts.has(a)))throw new Error('unexpected transaction accounts');
  if (compiled.staticAccounts[1] !== payer || sponsor === payer || ix.some(i => i.accounts?.some(a => a.address === sponsor))) throw new Error('sponsor isolation failed');
  for (const signer of [payer, ...(requireSponsor ? [sponsor] : [])]) {
    const signature = tx.signatures[signer];
    if (!signature) throw new Error('missing signature');
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(getAddressEncoder().encode(signer))]), format: 'der', type: 'spki' });
    if (!verify(null, Buffer.from(tx.messageBytes), key, Buffer.from(signature))) throw new Error('invalid signature');
  }
  const sig = tx.signatures[sponsor];
  return { signature: sig ? getBase58Decoder().decode(sig) : null, sponsor, payer, source: accounts[0]!.address, mint: accounts[1]!.address, destination: accounts[2]!.address,
    amount: data.readBigUInt64LE(1).toString(), decimals: data[9]!, memo, message: Uint8Array.from(tx.messageBytes), accounts: compiled.staticAccounts };
}
export function readHeader(header: string, requirements: PaymentRequirements, resourceUrl: string): { payload: PaymentPayload; transaction: string; transfer: Transfer } {
  if (header.length > 10000) throw new Error('payment header too large');
  const payload = decodePaymentSignatureHeader(header);
  if (payload.x402Version !== 2 || payload.resource?.url !== resourceUrl || !deepEqual(payload.accepted, requirements)) throw new Error('payment requirement mismatch');
  const transaction = (payload.payload as { transaction?: unknown }).transaction;
  if (typeof transaction !== 'string') throw new Error('transaction required');
  return { payload, transaction, transfer: decodeTransaction(transaction) };
}
export function assertTransfer(transfer: Transfer, requirements: PaymentRequirements): void {
  if (transfer.mint !== requirements.asset || transfer.destination !== requirements.extra.tokenAccount || transfer.sponsor !== requirements.extra.feePayer ||
      transfer.amount !== requirements.amount || transfer.decimals !== 6 || transfer.memo !== requirements.extra.memo) throw new Error('transfer does not bind exact requirement');
}
