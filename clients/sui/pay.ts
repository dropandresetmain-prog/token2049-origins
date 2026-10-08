import { z } from 'zod';
import { Transaction, TransactionDataBuilder } from '@mysten/sui/transactions';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { pathToFileURL } from 'node:url';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { assertRequirement, bindingMessage, encodeCandidate, readCandidate } from '../../src/funding/sui/wire.js';
import { NETWORK, USDC_TYPE, SUI_TYPE, Address, PositiveUnits, TESTNET_GENESIS } from '../../src/funding/sui/config.js';
import { SuiRpc, suiClient } from '../../src/funding/sui/rpc.js';
import { validateSettlement } from '../../src/contracts/settlement.js';
import { readSecretFile } from '../payer/config.js';
import { SuiLedger } from './ledger.js';
import { loadSigner } from './signer.js';
import { loadSuiPayerConfig, type SuiPayerConfig } from './config.js';

const Requirement = z.object({ purchaseId: z.string().regex(/^pur_[A-Za-z0-9]{10,40}$/), quoteId: z.string().regex(/^quo_[A-Za-z0-9]{10,40}$/),
  quoteDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/), amount: z.object({ network: z.literal(NETWORK), assetId: z.literal(USDC_TYPE),
    decimals: z.literal(6), amountBaseUnits: PositiveUnits, symbol: z.string().optional() }).strict(), payTo: Address,
  resourceUrl: z.url(), description: z.string(), expiresAt: z.iso.datetime({ offset: true }), settlement: z.unknown() }).strict();
export function validateChallenge(raw: unknown, cfg: SuiPayerConfig, purchaseId: string, now = new Date()): FundingRequirementInput {
  const c = z.object({ protocol: z.literal('sui-usdc-transfer'), version: z.literal(1), paymentHeader: z.literal('sui-payment'),
    requirement: Requirement, maxGasBudgetMist: PositiveUnits, binding: z.literal('payer_signed_application_candidate'), onChainPurchaseCommitment: z.literal(false), purchase: z.unknown().optional() }).strict().parse(raw);
  const s = validateSettlement(c.requirement.settlement, 6);
  const input: FundingRequirementInput = { ...c.requirement, settlement: s };
  assertRequirement(input, cfg, now);
  if (input.purchaseId !== purchaseId || input.resourceUrl !== `${cfg.gatewayUrl}/v1/purchases/${purchaseId}/fund` ||
      Date.parse(input.expiresAt) > now.getTime() + 3600000 || BigInt(c.maxGasBudgetMist) !== cfg.maxGasBudget ||
      BigInt(s.commercialTotal.amountMinor) > cfg.maxCommercial) throw new Error('Sui purchase binding or commercial cap mismatch');
  return input;
}

/** Coin selection is bounded; owned objects and gas are resolved before signing. No SDK automatic broadcast. */
export async function buildPayment(cfg: SuiPayerConfig, input: FundingRequirementInput, client: SuiGrpcClient | undefined, nonce: number): Promise<string> {
  if (!Number.isInteger(nonce) || nonce < 1 || nonce > 0xffffffff) throw new Error('durable Sui reservation sequence required');
  client ??= suiClient();
  const rpc = new SuiRpc(client);
  await rpc.assertNetwork(); await rpc.assertAsset();
  const amount = BigInt(input.amount.amountBaseUnits);
  const { balance: tokenBalance } = await client.getBalance({ owner: cfg.payer, coinType: USDC_TYPE, signal: AbortSignal.timeout(15000) });
  const { balance: gasBalance } = await client.getBalance({ owner: cfg.payer, coinType: SUI_TYPE, signal: AbortSignal.timeout(15000) });
  const useTokenBalance = BigInt(tokenBalance.addressBalance) >= amount, useGasBalance = BigInt(gasBalance.addressBalance) >= cfg.maxGasBudget;
  if ((!useTokenBalance && BigInt(tokenBalance.coinBalance) < amount) || (!useGasBalance && BigInt(gasBalance.coinBalance) < cfg.maxGasBudget)) throw new Error('insufficient Sui USDC or gas balance');
  const { objects } = await client.listCoins({ owner: cfg.payer, coinType: USDC_TYPE, limit: 32, signal: AbortSignal.timeout(15000) });
  const chosen: typeof objects = []; let total = 0n;
  for (const coin of objects) { if (total >= amount) break; chosen.push(coin); total += BigInt(coin.balance); }
  if (!useTokenBalance && (total < amount || !chosen.length)) throw new Error('USDC coin selection exceeds bounded object policy');
  const gas = await client.listCoins({ owner: cfg.payer, coinType: SUI_TYPE, limit: 32, signal: AbortSignal.timeout(15000) });
  const gasCoins: typeof gas.objects = []; let gasTotal = 0n;
  for (const coin of gas.objects) { if (gasTotal >= cfg.maxGasBudget) break; gasCoins.push(coin); gasTotal += BigInt(coin.balance); }
  if (!useGasBalance && gasTotal < cfg.maxGasBudget) throw new Error('gas coin selection exceeds bounded object policy');
  const [{ referenceGasPrice }, { systemState }] = await Promise.all([
    client.getReferenceGasPrice({ signal: AbortSignal.timeout(15000) }), client.getCurrentSystemState({ signal: AbortSignal.timeout(15000) }),
  ]);
  const tx = new Transaction(); tx.setSender(cfg.payer); tx.setGasOwner(cfg.payer);
  tx.setGasBudget(cfg.maxGasBudget); tx.setGasPrice(referenceGasPrice); tx.setGasPayment(useGasBalance ? [] : gasCoins);
  // Nonce is the durable reservation sequence, unique across restarts; chain and expiry are also signed on-chain.
  tx.setExpiration({ ValidDuring: { minEpoch: systemState.epoch, maxEpoch: String(BigInt(systemState.epoch) + 1n),
    minTimestamp: null, maxTimestamp: String(Date.parse(input.expiresAt)), chain: TESTNET_GENESIS, nonce } });
  if (useTokenBalance) {
    const payment = tx.moveCall({ target: '0x2::coin::redeem_funds', typeArguments: [USDC_TYPE], arguments: [tx.withdrawal({ amount, type: USDC_TYPE })] });
    tx.transferObjects([payment], tx.pure.address(cfg.payee));
  } else {
    const root = tx.objectRef(chosen[0]!);
    if (chosen.length > 1) tx.mergeCoins(root, chosen.slice(1).map(c => tx.objectRef(c)));
    const [payment] = tx.splitCoins(root, [tx.pure.u64(amount)]); tx.transferObjects([payment!], tx.pure.address(cfg.payee));
  }
  const bytes = await tx.build(), digest = TransactionDataBuilder.getDigestFromBytes(bytes), key = loadSigner(cfg.keyFile, cfg.payer);
  assertRequirement(input, cfg, new Date());
  const signed = await key.signTransaction(bytes), binding = await key.signPersonalMessage(bindingMessage(input, digest));
  const header = encodeCandidate({ version: 1, protocol: 'sui-usdc-transfer', transaction: Buffer.from(bytes).toString('base64'),
    signature: signed.signature, bindingSignature: binding.signature, digest });
  await readCandidate(header, input, cfg);
  return header;
}

export interface SuiPaymentDeps { fetchImpl?: typeof fetch; ledger?: SuiLedger; build?: (input: FundingRequirementInput) => Promise<string>; }
export async function paySuiPurchase(cfg: SuiPayerConfig, purchaseId: string, deps: SuiPaymentDeps = {}): Promise<{ status: number; digest: string; resumed: boolean }> {
  if (!/^pur_[A-Za-z0-9]{10,40}$/.test(purchaseId)) throw new Error('invalid purchase id');
  const ledger = deps.ledger ?? new SuiLedger(cfg.ledger, cfg.payer), request = deps.fetchImpl ?? fetch;
  const resource = `${cfg.gatewayUrl}/v1/purchases/${purchaseId}/fund`, token = readSecretFile(cfg.tokenFile, 'SUI_GATEWAY_TOKEN_FILE');
  return ledger.exclusive(async () => {
    let entry = ledger.read().find(e => e.id === purchaseId);
    const resumed = !!entry;
    if (!entry) {
      const challenge = await request(resource, { method: 'POST', headers: { authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (challenge.status !== 402) throw new Error('gateway did not issue Sui payment requirements');
      const input = validateChallenge(await challenge.json(), cfg, purchaseId);
      ledger.assertCaps(BigInt(input.amount.amountBaseUnits), cfg.maxGasBudget, cfg.policy, new Date());
      entry = { id: purchaseId, amount: input.amount.amountBaseUnits, gasBudget: cfg.maxGasBudget.toString(), header: null, digest: null, createdAt: new Date().toISOString(), status: 'reserved' };
      ledger.upsert(entry);
      const nonce = ledger.read().length;
      const header = await (deps.build ?? (i => buildPayment(cfg, i, undefined, nonce)))(input), decoded = await readCandidate(header, input, cfg);
      if (decoded.transfer.payer !== cfg.payer || decoded.transfer.gasBudget !== entry.gasBudget) throw new Error('Sui payer identity or reserved gas mismatch');
      entry = { ...entry, header, digest: decoded.candidate.digest, status: 'signed' }; ledger.upsert(entry);
    }
    if (!entry.header || !entry.digest) throw new Error('reserved Sui payment has no signed candidate; operator recovery required');
    // Repeated requests first read purchase state. A missing response never causes a new candidate or new reservation.
    const view = await request(`${cfg.gatewayUrl}/v1/purchases/${purchaseId}`, { headers: { authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!view.ok) throw new Error('purchase readback unavailable; signed Sui candidate retained');
    const body = await view.json() as { purchase?: { paymentState?: string; state?: string; funding?: Array<{ transferReference?: string }> } };
    const purchase = body.purchase;
    if (!purchase || typeof purchase.paymentState !== 'string' || typeof purchase.state !== 'string') throw new Error('invalid purchase readback');
    if (purchase.paymentState !== 'not_received' || purchase.state !== 'awaiting_funding') return { status: 202, digest: entry.digest, resumed: true };
    if (entry.status === 'accepted') throw new Error('accepted Sui candidate requires reconciliation');
    const response = await request(resource, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'sui-payment': entry.header }, redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (response.status === 202) ledger.upsert({ ...entry, status: 'accepted' });
    return { status: response.status, digest: entry.digest, resumed };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await paySuiPurchase(loadSuiPayerConfig(process.env), process.argv[2] ?? ''))); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Sui payer failed'); process.exitCode = 1; }
}
