import { z } from 'zod';
import { keccak256, type Hex } from 'viem';
import { pathToFileURL } from 'node:url';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { PROTOCOL, assertRequirement, bindingMessage, encodeCandidate, readCandidate, transferCalldata } from '../../src/funding/xlayer/wire.js';
import { CHAIN_ID, NETWORK, TOKEN, TOKEN_DECIMALS, EvmAddress, PositiveUnits } from '../../src/funding/xlayer/config.js';
import { XLayerRpc, type XLayerRpcPort } from '../../src/funding/xlayer/rpc.js';
import { validateSettlement } from '../../src/contracts/settlement.js';
import { readSecretFile } from '../payer/config.js';
import { XLayerLedger, nextNonce, type XLayerLedgerEntry, type XLayerLedgerPort } from './ledger.js';
import { loadSigner } from './signer.js';
import { loadXLayerPayerConfig, type XLayerPayerConfig } from './config.js';

const Requirement = z.object({ purchaseId: z.string().regex(/^pur_[A-Za-z0-9]{10,40}$/), quoteId: z.string().regex(/^quo_[A-Za-z0-9]{10,40}$/),
  quoteDigest: z.string().regex(/^sha256:[0-9a-f]{64}$/), amount: z.object({ network: z.literal(NETWORK), assetId: z.literal(TOKEN),
    decimals: z.literal(TOKEN_DECIMALS), amountBaseUnits: PositiveUnits, symbol: z.string().optional() }).strict(), payTo: EvmAddress,
  resourceUrl: z.url(), description: z.string(), expiresAt: z.iso.datetime({ offset: true }), settlement: z.unknown() }).strict();
export function validateChallenge(raw: unknown, cfg: XLayerPayerConfig, purchaseId: string, now = new Date()): FundingRequirementInput {
  const c = z.object({ protocol: z.literal(PROTOCOL), version: z.literal(1), paymentHeader: z.literal('xlayer-payment'),
    requirement: Requirement, maxGasBudgetWei: PositiveUnits, binding: z.literal('payer_signed_application_candidate'), onChainPurchaseCommitment: z.literal(false), purchase: z.unknown().optional() }).strict().parse(raw);
  const s = validateSettlement(c.requirement.settlement, TOKEN_DECIMALS);
  const input: FundingRequirementInput = { ...c.requirement, settlement: s };
  assertRequirement(input, cfg, now);
  if (input.purchaseId !== purchaseId || input.resourceUrl !== `${cfg.gatewayUrl}/v1/purchases/${purchaseId}/fund` ||
      Date.parse(input.expiresAt) > now.getTime() + 3600000 || BigInt(c.maxGasBudgetWei) !== cfg.maxGasBudget ||
      BigInt(s.commercialTotal.amountMinor) > cfg.maxCommercial) throw new Error('X Layer purchase binding or commercial cap mismatch');
  return input;
}

export interface BuiltPayment { header: string; nonce: number; hash: string; gasBudget: bigint }
/**
 * One EIP-1559 USD₮0 transfer with a bounded gas budget. Nonce comes from the chain's pending count and the durable
 * ledger (never a local counter), and nothing is broadcast here: the gateway submits only after durable preparation.
 */
export async function buildPayment(cfg: XLayerPayerConfig, input: FundingRequirementInput, rpc: XLayerRpcPort, entries: XLayerLedgerEntry[], purchaseId: string): Promise<BuiltPayment> {
  await rpc.assertNetwork(); await rpc.assertAsset();
  const amount = BigInt(input.amount.amountBaseUnits), data = transferCalldata(input.payTo, amount);
  const nonce = nextNonce(entries, purchaseId, await rpc.transactionCount(cfg.payer));
  const gas = (await rpc.estimateTransferGas(cfg.payer, data) * 125n) / 100n, fees = await rpc.feeCaps();
  const gasBudget = gas * fees.maxFeePerGas;
  if (gas <= 0n || fees.maxFeePerGas <= 0n || fees.maxPriorityFeePerGas > fees.maxFeePerGas) throw new Error('invalid X Layer gas estimate');
  if (gasBudget > cfg.maxGasBudget) throw new Error('X Layer gas estimate exceeds the per-payment gas cap');
  if (await rpc.tokenBalance(cfg.payer) < amount || await rpc.nativeBalance(cfg.payer) < gasBudget) throw new Error('insufficient X Layer USD₮0 or OKB gas balance');
  const key = loadSigner(cfg.keyFile, cfg.payer);
  assertRequirement(input, cfg, new Date());
  const rawTransaction = await key.signTransaction({ type: 'eip1559', chainId: CHAIN_ID, to: TOKEN as Hex, data, value: 0n, nonce, gas,
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  const hash = keccak256(rawTransaction), bindingSignature = await key.signMessage({ message: bindingMessage(input, hash) });
  const header = encodeCandidate({ version: 1, protocol: PROTOCOL, rawTransaction, bindingSignature, hash });
  await readCandidate(header, input, cfg);
  return { header, nonce, hash, gasBudget };
}

export interface XLayerPaymentDeps { fetchImpl?: typeof fetch; ledger?: XLayerLedgerPort; rpc?: XLayerRpcPort; build?: (input: FundingRequirementInput, entries: XLayerLedgerEntry[]) => Promise<BuiltPayment>; }
export async function payXLayerPurchase(cfg: XLayerPayerConfig, purchaseId: string, deps: XLayerPaymentDeps = {}): Promise<{ status: number; hash: string; resumed: boolean }> {
  if (!/^pur_[A-Za-z0-9]{10,40}$/.test(purchaseId)) throw new Error('invalid purchase id');
  const ledger = deps.ledger ?? (cfg.ledger ? new XLayerLedger(cfg.ledger, cfg.payer) : undefined), request = deps.fetchImpl ?? fetch;
  if (!ledger) throw new Error('X Layer ledger implementation required for external ledger configuration');
  const resource = `${cfg.gatewayUrl}/v1/purchases/${purchaseId}/fund`, token = readSecretFile(cfg.tokenFile, 'XLAYER_GATEWAY_TOKEN_FILE');
  return ledger.exclusive(async () => {
    let entry = (await ledger.read()).find(e => e.id === purchaseId);
    const resumed = !!entry;
    if (!entry) {
      const challenge = await request(resource, { method: 'POST', headers: { authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
      if (challenge.status !== 402) throw new Error('gateway did not issue X Layer payment requirements');
      const input = validateChallenge(await challenge.json(), cfg, purchaseId);
      await ledger.assertCaps(BigInt(input.amount.amountBaseUnits), cfg.maxGasBudget, cfg.policy, new Date());
      entry = { id: purchaseId, amount: input.amount.amountBaseUnits, gasBudget: cfg.maxGasBudget.toString(), nonce: null, header: null, hash: null, createdAt: new Date().toISOString(), status: 'reserved' };
      await ledger.upsert(entry);
      const built = await (deps.build ?? ((i, entries) => buildPayment(cfg, i, deps.rpc ?? new XLayerRpc(), entries, purchaseId)))(input, await ledger.read());
      const decoded = await readCandidate(built.header, input, cfg);
      if (decoded.transfer.payer !== cfg.payer || decoded.transfer.gasBudget > BigInt(entry.gasBudget) || decoded.transfer.nonce !== built.nonce) throw new Error('X Layer payer identity, nonce or reserved gas mismatch');
      entry = { ...entry, header: built.header, hash: decoded.candidate.hash, nonce: decoded.transfer.nonce, status: 'signed' }; await ledger.upsert(entry);
    }
    if (!entry.header || !entry.hash) throw new Error('reserved X Layer payment has no signed candidate; operator recovery required');
    // Repeated requests first read purchase state. A missing response never causes a new candidate or new reservation.
    const view = await request(`${cfg.gatewayUrl}/v1/purchases/${purchaseId}`, { headers: { authorization: 'Bearer ' + token }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!view.ok) throw new Error('purchase readback unavailable; signed X Layer candidate retained');
    const body = await view.json() as { purchase?: { paymentState?: string; state?: string } };
    const purchase = body.purchase;
    if (!purchase || typeof purchase.paymentState !== 'string' || typeof purchase.state !== 'string') throw new Error('invalid purchase readback');
    if (purchase.paymentState !== 'not_received' || purchase.state !== 'awaiting_funding') return { status: 202, hash: entry.hash, resumed: true };
    if (entry.status === 'accepted') throw new Error('accepted X Layer candidate requires reconciliation');
    const response = await request(resource, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'xlayer-payment': entry.header }, redirect: 'error', signal: AbortSignal.timeout(60000) });
    if (response.status === 202) await ledger.upsert({ ...entry, status: 'accepted' });
    return { status: response.status, hash: entry.hash, resumed };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await payXLayerPurchase(loadXLayerPayerConfig(process.env), process.argv[2] ?? ''))); }
  catch (error) { console.error(error instanceof Error ? error.message : 'X Layer payer failed'); process.exitCode = 1; }
}
