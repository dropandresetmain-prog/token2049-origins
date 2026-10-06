import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { FundingAdapter, FundingRequirementInput, FundingVerification } from '../../contracts/ports.js';
import type { Readiness } from '../../contracts/common.js';
import { MasumiClient, type FeePayment } from '../../integrations/masumi/client.js';

export function obligationHash(input: FundingRequirementInput): string {
  return createHash('sha256').update(JSON.stringify({ purchaseId: input.purchaseId, quoteId: input.quoteId, quoteDigest: input.quoteDigest, amount: input.amount, payTo: input.payTo, resourceUrl: input.resourceUrl, expiresAt: input.expiresAt, purpose: 'purchase_principal' })).digest('hex');
}
export interface FeeBinding { inputHash: string; identifier: string; payBy: number; submitBy: number; unlockAt: number; disputeUntil: number; nonce: string; expectedPayerVkey?: string; }
export type FeeObservation = { status: 'pending' | 'escrow_locked' | 'result_submitted' | 'released'; purpose: 'service_fee'; payment: FeePayment; transferReference: string | null; withdrawalAccounting?: 'unreported' | 'matched'; };
const Amount = z.object({ unit: z.string(), quantity: z.string().regex(/^[0-9]+$/) });
const Output = z.object({ tx_hash: z.string().optional(), output_index: z.number().int(), address: z.string(), amount: z.array(Amount), data_hash: z.string().nullable(), inline_datum: z.string().nullable() });
const Utxos = z.object({ outputs: z.array(Output), inputs: z.array(z.object({ tx_hash: z.string(), output_index: z.number().int(), reference: z.boolean(), collateral: z.boolean() })).optional() });
const Datum = z.object({ json_value: z.object({ constructor: z.literal(0), fields: z.array(z.unknown()).length(19) }) });
const Recipient = z.union([z.object({ constructor: z.literal(1), fields: z.tuple([]) }).strict(), z.object({ constructor: z.literal(0), fields: z.tuple([z.unknown()]) }).strict()]);
const ReferenceTag = z.object({ json_value: z.object({ constructor: z.literal(0), fields: z.tuple([z.object({bytes:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),z.object({int:z.number().int().nonnegative().safe()}).strict()]) }).strict() });
const Tx = z.object({ hash: z.string(), block: z.string(), block_height: z.number().int(), valid_contract: z.boolean() });
const Tip = z.object({ height: z.number().int() });
const Address = z.object({ constructor: z.literal(0), fields: z.tuple([z.object({ constructor: z.literal(0), fields: z.tuple([z.object({ bytes: z.string().regex(/^[a-f0-9]{56}$/) }).strict()]) }).strict(), z.unknown()]) }).strict();
const paymentKey = (value: unknown) => Address.parse(value).fields[0].fields[0].bytes;
const bytes = (v: unknown): string => z.object({ bytes: z.string() }).parse(v).bytes;
const integer = (v: unknown): bigint => BigInt(z.object({ int: z.union([z.number().int().safe(), z.string().regex(/^[0-9]+$/)]) }).parse(v).int);
export function assertFeeBinding(p: FeePayment, c: MasumiClient['config'], b: FeeBinding): void {
  if (p.blockchainIdentifier !== b.identifier || p.agentIdentifier !== c.agentIdentifier || p.inputHash !== b.inputHash ||
      p.PaymentSource.smartContractAddress !== c.contractAddress || p.SmartContractWallet?.walletVkey !== c.sellerVkey || p.SmartContractWallet?.walletAddress !== c.sellerAddress || (p.sellerReturnAddress !== null && p.sellerReturnAddress !== c.sellerAddress) ||
      p.RequestedFunds.length !== 1 || p.RequestedFunds[0]!.unit !== c.assetUnit || BigInt(p.RequestedFunds[0]!.amount) !== BigInt(c.feeBaseUnits) ||
      BigInt(p.payByTime) !== BigInt(b.payBy) || BigInt(p.submitResultTime) !== BigInt(b.submitBy) ||
      BigInt(p.unlockTime) !== BigInt(b.unlockAt) || BigInt(p.externalDisputeUnlockTime) !== BigInt(b.disputeUntil) ||
      (b.expectedPayerVkey && p.onChainState && p.BuyerWallet?.walletVkey !== b.expectedPayerVkey)) throw new Error('Masumi payment does not match the stored service-fee obligation');
}
/** Verify positions from the native V2 datum, not coincidental bytes elsewhere in a provider body. */
async function exactOutput(client: MasumiClient, hash: string, b: FeeBinding, p: FeePayment, state: number) {
  const c = client.config;
  const tx = Tx.parse(await client.chain('/txs/' + hash));
  const tip = Tip.parse(await client.chain('/blocks/latest'));
  if (tx.hash !== hash || !tx.valid_contract || tip.height - tx.block_height + 1 < 20) throw new Error('Fee transaction is not independently final');
  const u = Utxos.parse(await client.chain('/txs/' + hash + '/utxos'));
  const matches = [];
  for (const output of u.outputs) {
    if (output.address !== c.contractAddress || output.amount.filter(a => a.unit === c.assetUnit).length !== 1 || !output.amount.some(a => a.unit === c.assetUnit && a.quantity === c.feeBaseUnits) || !output.data_hash) continue;
    const d = Datum.parse(await client.chain('/scripts/datum/' + output.data_hash)).json_value.fields;
    const recipient = Recipient.parse(d[3]);
    // Some binds the complete native address, including stake credentials. It is unsupported until fully decoded.
    if (recipient.constructor === 0 || p.sellerReturnAddress !== null) continue;
    if (!p.BuyerWallet?.walletVkey || paymentKey(d[0]) !== p.BuyerWallet.walletVkey || paymentKey(d[2]) !== c.sellerVkey ||
        bytes(d[7]) !== b.nonce || bytes(d[8]) !== c.agentIdentifier || bytes(d[10]) !== b.inputHash ||
        integer(d[12]) !== BigInt(b.payBy) || integer(d[13]) !== BigInt(b.submitBy) || integer(d[14]) !== BigInt(b.unlockAt) || integer(d[15]) !== BigInt(b.disputeUntil) ||
        z.object({ constructor: z.number() }).parse(d[18]).constructor !== state || (state === 1 && bytes(d[11]) !== p.resultHash)) continue;
    matches.push(output);
  }
  if (matches.length !== 1) throw new Error('No unique exactly bound native fee escrow output');
  return matches[0]!;
}
/** Task escrow is independently observed and never presented as merchant purchase principal. */
export async function observeServiceFee(client: MasumiClient, binding: FeeBinding): Promise<FeeObservation> {
  const p = await client.payment(binding.identifier), c = client.config;
  assertFeeBinding(p, c, binding);
  if (!p.onChainState) return { status: 'pending', purpose: 'service_fee', payment: p, transferReference: null };
  // Withdrawal requires an independently final exact payout that consumes the bound result escrow.
  if (!['FundsLocked', 'ResultSubmitted', 'Withdrawn'].includes(p.onChainState)) throw new Error('Fee state requires refund, dispute, or payout reconciliation');
  const history = [...(p.TransactionHistory ?? []), ...(p.CurrentTransaction ? [p.CurrentTransaction] : [])];
  const confirmed = history.filter(t => t.txHash && t.status === 'Confirmed' && (t.layer === 'L1' || (t.layer === undefined && p.forceLayer === 'L1')));
  const locks = [...new Set(confirmed.filter(t => t.newOnChainState === 'FundsLocked' && t.previousOnChainState === null).map(t => t.txHash!))];
  if (locks.length !== 1) throw new Error('Exactly one confirmed native fee lock is required');
  const lock = await exactOutput(client, locks[0]!, binding, p, 0);
  const stateTx = p.onChainState === 'FundsLocked' ? locks[0]! : confirmed.find(t => t.newOnChainState === 'ResultSubmitted')?.txHash;
  if (!stateTx && p.onChainState === 'Withdrawn') throw new Error('Native payout requires a confirmed result witness');
  if (!stateTx) return { status: 'pending', purpose: 'service_fee', payment: p, transferReference: null };
  const active = stateTx === locks[0] ? lock : await exactOutput(client, stateTx, binding, p, 1);
  if (stateTx !== locks[0]) {
    const transition = Utxos.parse(await client.chain('/txs/' + stateTx + '/utxos'));
    if (!transition.inputs?.some(i => i.tx_hash === locks[0] && i.output_index === lock.output_index && i.reference === false && i.collateral === false)) throw new Error('Result transition does not consume the bound fee lock');
  }
  if (p.onChainState === 'Withdrawn') {
    const withdrawal = confirmed.find(t => t.newOnChainState === 'Withdrawn' && t.previousOnChainState === 'ResultSubmitted')?.txHash;
    if (!withdrawal || stateTx === locks[0] || !p.resultHash) throw new Error('Native payout requires a confirmed result-to-withdrawal transaction');
    const tx = Tx.parse(await client.chain('/txs/' + withdrawal));
    const tip = Tip.parse(await client.chain('/blocks/latest'));
    if (tx.hash !== withdrawal || !tx.valid_contract || tip.height - tx.block_height + 1 < 20) throw new Error('Native fee payout is not independently final');
    const payout = Utxos.parse(await client.chain('/txs/' + withdrawal + '/utxos'));
    if (!payout.inputs?.some(i => i.tx_hash === stateTx && i.output_index === active.output_index && i.reference === false && i.collateral === false)) throw new Error('Native payout did not consume the bound result escrow');
    let taggedAmount = 0n;
    for (const output of payout.outputs) {
      if (output.address !== c.sellerAddress || !output.inline_datum || !output.data_hash) continue;
      const tag = ReferenceTag.safeParse(await client.chain('/scripts/datum/' + output.data_hash));
      if (!tag.success || tag.data.json_value.fields[0].bytes !== stateTx || tag.data.json_value.fields[1].int !== active.output_index) continue;
      const amounts = output.amount.filter(a => a.unit === c.assetUnit);
      if (amounts.length > 1) throw new Error('Duplicate fee asset in tagged payout');
      taggedAmount += BigInt(amounts[0]?.quantity ?? '0');
    }
    if (taggedAmount !== BigInt(c.feeBaseUnits)) throw new Error('Native payout does not pay the exact frozen seller through the bound output-reference tag');
    // This native V2 producer fills amount summaries only for disputed withdrawals. Empty is unreported,
    // not zero cash: the exact final tagged chain output above is authoritative. Conflicting data still rejects.
    const reported = p.WithdrawnForSeller.filter(f => f.unit === c.assetUnit);
    if (p.WithdrawnForSeller.length && (reported.length !== 1 || reported[0]!.amount !== c.feeBaseUnits)) throw new Error('Native withdrawal amount summary conflicts with the independently proved payout');
    return { status: 'released', purpose: 'service_fee', withdrawalAccounting: p.WithdrawnForSeller.length ? 'matched' : 'unreported', payment: p, transferReference: locks[0] + '#' + lock.output_index };
  }
  // An old transaction can remain confirmed after its output is spent. Independently prove current escrow.
  let unspent = false;
  for (let page = 1; page <= 20; page++) {
    const items = z.array(Output).parse(await client.chain('/addresses/' + c.contractAddress + '/utxos/' + c.assetUnit + '?order=desc&count=100&page=' + page));
    if (items.some(o => o.tx_hash === stateTx && o.output_index === active.output_index)) { unspent = true; break; }
    if (items.length < 100) break;
  }
  if (!unspent) throw new Error('Native service state is stale or escrow is no longer unspent');
  return { status: p.onChainState === 'FundsLocked' ? 'escrow_locked' : 'result_submitted', purpose: 'service_fee', payment: p, transferReference: locks[0] + '#' + lock.output_index };
}
/** Current Masumi protocol remunerates tasks; it cannot fund dynamic merchant principal before work. */
export function createMasumiFundingAdapter(env: NodeJS.ProcessEnv): FundingAdapter {
  const configured = Boolean(env.MASUMI_PAYMENT_SERVICE_URL && env.MASUMI_PAYMENT_API_KEY);
  const reject = async (): Promise<FundingVerification> => ({ ok: false, code: 'payment_invalid', reason: 'Masumi task fees and escrow are not verified purchase principal; select a direct funding rail', settlementAttempted: false });
  return {
    rail: 'masumi', network: 'cardano:preprod', paymentHeaderName: 'Masumi-Payment',
    acceptedAsset: () => null,
    readiness: async (): Promise<Readiness> => ({ component: 'masumi', status: configured ? 'ACCESS_BLOCKED' : 'MISSING_CONFIG', environment: 'sandbox', missing: configured ? [] : ['MASUMI_PAYMENT_SERVICE_URL', 'MASUMI_PAYMENT_API_KEY'], detail: 'Service-fee verifier is separate; purchase-principal funding is disabled until independently proven', checkedAt: new Date().toISOString() }),
    paymentRequirements: () => ({ rail: 'masumi', enabled: false, reason: 'service_fee_is_not_purchase_principal' }),
    verify: reject, recover: reject,
    prepare: () => ({ ok: false, code: 'payment_invalid', reason: 'Masumi task payments cannot authorize a merchant purchase', settlementAttempted: false }),
  };
}
