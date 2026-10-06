/**
 * Cardano (Preprod) funding adapter, x402 v2 `exact` scheme.
 *
 * Ordering contract (see docs/evidence/cardano-protocol.md): this adapter does BOTH facilitator verify and
 * settle inside `verify()`. The SDK's express middleware runs the handler before settlement; we do
 * not use it, so the core only persists evidence after the chain has accepted the payment and the
 * worker later executes commerce from confirmed evidence, never from a promise to pay.
 *
 *   header -> decode -> exact requirement match -> local tx pre-check -> facilitator /verify
 *          -> facilitator /settle -> independent Blockfrost output check -> VerifiedFunding
 *
 * Trust model: the facilitator receipt is a claim. `confirmed` is only returned when Blockfrost,
 * an independent index, shows an output paying the treasury at least the required quantity of the
 * exact asset. Anything we cannot independently see yet is `submitted` and finished by `confirm()`.
 *
 * Secrets: the Blockfrost project id and raw facilitator bodies never enter logs, reasons or
 * evidence details. Reasons contain only whitelisted SDK error codes or fixed phrases.
 */
import {
  CANONICAL_CARDANO_ASSET_REGEX,
  CARDANO_ADDRESS_REGEX,
  ERR_DUPLICATE_SETTLEMENT,
  ERR_SETTLEMENT_PENDING,
  LOVELACE_ASSET,
  POSITIVE_CANONICAL_AMOUNT_REGEX,
  decodeCardanoTransaction,
  slotToPosixMs,
} from '@x402/cardano';
import { HTTPFacilitatorClient, decodePaymentSignatureHeader, encodePaymentResponseHeader } from '@x402/core/http';
import type { FacilitatorClient } from '@x402/core/http';
import { SettleError, VerifyError } from '@x402/core/types';
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse, VerifyResponse } from '@x402/core/types';
import { deepEqual } from '@x402/core/utils';
import { z } from 'zod';
import { validateSettlement } from '../../contracts/settlement.js';
import { fundingCommitment, readFundingCommitment } from './binding.js';
import type { FundingAdapter, FundingRequirementInput, FundingVerification, VerifiedFunding } from '../../contracts/ports.js';
import type { PaymentState } from '../../contracts/commerce.js';
import type { Readiness } from '../../contracts/common.js';
import { redact } from '../../infrastructure/redact.js';
import { systemClock, type Clock } from '../../infrastructure/clock.js';
import { BlockfrostClient, BlockfrostError, PREPROD_NETWORK_MAGIC, sumPaidTo, type OnChainTx } from './blockfrost.js';
import { CARDANO_NETWORK, REQUIRED_ENV, REQUIRED_L1_CONFIRMATIONS, parseCardanoConfig, type CardanoConfig } from './config.js';

/** The slice of the SDK facilitator client the adapter uses; inject a fake in tests. */
export type CardanoFacilitatorPort = Pick<FacilitatorClient, 'verify' | 'settle' | 'getSupported'>;

/** Structural subset of the SDK's DecodedCardanoTransaction we rely on. */
export interface DecodedTxView {
  txHash: string;
  commitment: string | null;
  validUntilMs: number | null;
  outputs: Array<{ address: string; coin: bigint; assets: Record<string, bigint> }>;
}

export type FundingPreparation = { ok: true; transferReference: string } | Extract<FundingVerification, { ok: false }>;
/** Recovery is available only for a core attempt persisted before any settlement side effect. */
export interface CardanoRecoveryAdapter extends FundingAdapter {
  prepare(paymentHeaderValue: string, input: FundingRequirementInput): FundingPreparation;
  recover(transferReference: string, input: FundingRequirementInput): Promise<FundingVerification>;
}
type PreparedPayment = { ok: true; payload: PaymentPayload; requirement: PaymentRequirements; nonce: string; localTx: string; localReceived: bigint };

export interface CardanoAdapterOptions {
  /** Used for Blockfrost. (The SDK's HTTPFacilitatorClient uses global fetch; inject `facilitator` to replace it.) */
  fetchImpl?: typeof fetch;
  clock?: Clock;
  facilitator?: CardanoFacilitatorPort;
  /** Override local transaction decoding (tests use synthetic transactions). Defaults to the SDK decoder. */
  decodeTransaction?: (transactionBase64: string) => DecodedTxView;
  /** Sanitized structured events only. Passed through `redact` again before emission. */
  log?: (entry: Record<string, unknown>) => void;
}

const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';
const MIN_TIMEOUT_SECONDS = 60;
const MAX_TIMEOUT_SECONDS = 600;
const READINESS_PASS_TTL_MS = 5 * 60_000;
const READINESS_FAIL_TTL_MS = 60_000;
const PROBE_TIMEOUT_MS = 10_000;
/** Facilitator settle can wait ~75s for confirmations; the SDK client default (90s) must exceed that. */
const FACILITATOR_TIMEOUT_MS = 90_000;
const TX_HASH = /^[0-9a-f]{64}$/;
const SAFE_CODE = /^[a-z][a-z0-9_]{2,90}$/;

/** Defensive shape of the client's `PAYMENT-SIGNATURE` payload. Unknown keys are tolerated, not trusted. */
const PaymentPayloadShape = z
  .object({
    x402Version: z.literal(2),
    resource: z.object({ url: z.string() }).loose(),
    accepted: z
      .object({
        scheme: z.string(),
        network: z.string(),
        amount: z.string(),
        asset: z.string(),
        payTo: z.string(),
        maxTimeoutSeconds: z.number(),
        extra: z.record(z.string(), z.unknown()).default({}),
      })
      .loose(),
    payload: z.object({ transaction: z.string().min(1), nonce: z.string() }).loose(),
  })
  .loose();

const invalid = (reason: string): Extract<FundingVerification, { ok: false }> => ({ ok: false, code: 'payment_invalid', reason });

/** Only machine-style SDK reason codes pass through; anything else collapses to a fixed word. */
function safeCode(c: unknown, fallback: string): string {
  return typeof c === 'string' && SAFE_CODE.test(c) ? c : fallback;
}

function defaultDecode(tx: string): DecodedTxView {
  const d = decodeCardanoTransaction(tx);
  return { txHash: d.txHash.toLowerCase(), commitment: readFundingCommitment(tx), validUntilMs: d.ttlSlot === undefined ? null : slotToPosixMs(CARDANO_NETWORK,d.ttlSlot), outputs: d.outputs.map((o) => ({ address: o.address, coin: o.coin, assets: o.assets })) };
}

/** Exact bigint sum a decoded transaction pays to `address` in `assetId`. */
function localPaidTo(d: DecodedTxView, address: string, assetId: string): bigint {
  const want = address.toLowerCase();
  let total = 0n;
  for (const o of d.outputs) {
    if (o.address.toLowerCase() !== want) continue;
    total += assetId === LOVELACE_ASSET ? o.coin : (o.assets[assetId] ?? 0n);
  }
  return total;
}

type ChainCheck =
  | { state: 'match'; tx: OnChainTx; received: bigint }
  | { state: 'mismatch'; detail: string }
  | { state: 'not_found' }
  | { state: 'error' };

type ReadinessProbe = { status: 'ok' | 'blocked' | 'unverified'; detail?: string };

export function createCardanoFundingAdapter(env: NodeJS.ProcessEnv, opts: CardanoAdapterOptions = {}): CardanoRecoveryAdapter {
  return new CardanoFundingAdapter(env, opts);
}

class CardanoFundingAdapter implements CardanoRecoveryAdapter {
  readonly rail = 'cardano' as const;
  readonly network = CARDANO_NETWORK;
  readonly paymentHeaderName = 'payment-signature';

  private readonly parsed: ReturnType<typeof parseCardanoConfig>;
  private readonly clock: Clock;
  private readonly facilitator: CardanoFacilitatorPort | null;
  private readonly blockfrost: BlockfrostClient | null;
  private readonly decodeTx: (tx: string) => DecodedTxView;
  private readonly log: (entry: Record<string, unknown>) => void;
  private readinessCache: { until: number; value: Readiness } | null = null;
  private readinessInflight: Promise<Readiness> | null = null;

  constructor(env: NodeJS.ProcessEnv, opts: CardanoAdapterOptions) {
    this.parsed = parseCardanoConfig(env);
    this.clock = opts.clock ?? systemClock;
    this.decodeTx = opts.decodeTransaction ?? defaultDecode;
    this.log = opts.log ?? (() => undefined);
    if (this.parsed.ok) {
      const c = this.parsed.config;
      this.facilitator = opts.facilitator ?? new HTTPFacilitatorClient({ url: c.facilitatorUrl, timeoutMs: FACILITATOR_TIMEOUT_MS });
      this.blockfrost = new BlockfrostClient({
        baseUrl: c.blockfrostBaseUrl,
        projectId: c.blockfrostProjectId,
        ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      });
    } else {
      this.facilitator = null;
      this.blockfrost = null;
    }
  }

  private get cfg(): CardanoConfig | null {
    return this.parsed.ok ? this.parsed.config : null;
  }

  private event(type: string, data: Record<string, unknown>): void {
    try {
      this.log(redact({ component: 'cardano', type, ...data }));
    } catch {
      /* logging must never affect funding */
    }
  }

  /* ---------------- asset / requirements ---------------- */

  acceptedAsset() {
    const c = this.cfg;
    if (!c) return null;
    return {
      assetId: c.assetUnit,
      decimals: c.decimals,
      // A ticker is never an identity; only the exactly recognized tUSDM unit gets a symbol.
      ...(c.isTusdm ? { symbol: 'tUSDM' } : {}),
      payTo: c.treasuryAddress,
      // Only recognized tUSDM supports the USD notional policy; this does not assert parity or redemption.
      supportsUsdNotional: c.isTusdm,
    };
  }

  /** The requirement must be one this adapter would itself issue (same network, asset and treasury). */
  private requirementMatchesConfig(input: FundingRequirementInput, allowExpired = false): boolean {
    const c = this.cfg;
    if (input.settlement) {
      try { if (validateSettlement(input.settlement, input.amount.decimals).totalBaseUnits !== input.amount.amountBaseUnits) return false; }
      catch { return false; }
    }
    return (
      !!c &&
      input.amount.network === CARDANO_NETWORK &&
      input.amount.assetId === c.assetUnit &&
      input.amount.decimals === c.decimals &&
      Number.isFinite(Date.parse(input.expiresAt)) &&
      (allowExpired || Date.parse(input.expiresAt) > this.clock.now().getTime()) &&
      input.payTo === c.treasuryAddress &&
      CANONICAL_CARDANO_ASSET_REGEX.test(input.amount.assetId) &&
      POSITIVE_CANONICAL_AMOUNT_REGEX.test(input.amount.amountBaseUnits)
    );
  }

  /** The single `accepts[0]` entry; shared by the 402 challenge and by verification (so they cannot drift). */
  private expectedAccept(input: FundingRequirementInput): PaymentRequirements {
    const secondsLeft = Math.floor((Date.parse(input.expiresAt) - this.clock.now().getTime()) / 1000);
    const maxTimeoutSeconds = Math.max(MIN_TIMEOUT_SECONDS, Math.min(MAX_TIMEOUT_SECONDS, secondsLeft));
    return {
      scheme: 'exact',
      network: CARDANO_NETWORK,
      amount: input.amount.amountBaseUnits,
      asset: input.amount.assetId,
      payTo: input.payTo,
      maxTimeoutSeconds,
      extra: {
        assetTransferMethod: 'default',
        confirmationPolicy: { l1Confirmations: REQUIRED_L1_CONFIRMATIONS },
        areFeesSponsored: false,
        // The facilitator ignores these application fields. Our adapter requires their digest in signed
        // transaction metadata, then verifies that commitment independently through Blockfrost.
        purchaseId: input.purchaseId,
        quoteId: input.quoteId,
        quoteDigest: input.quoteDigest,
        expiresAt: input.expiresAt,
        ...(input.settlement ? { settlement: input.settlement, chainDecimals: input.amount.decimals } : {}),
      },
    };
  }

  paymentRequirements(input: FundingRequirementInput): Record<string, unknown> {
    if (!this.requirementMatchesConfig(input)) {
      throw new Error('cardano requirement does not match adapter configuration');
    }
    const challenge: PaymentRequired = {
      x402Version: 2,
      error: 'payment required',
      resource: { url: input.resourceUrl, description: input.description, mimeType: 'application/json' },
      accepts: [this.expectedAccept(input)],
    };
    return challenge as unknown as Record<string, unknown>;
  }

  /* ---------------- verify + settle ---------------- */

  private inspectPayment(paymentHeaderValue: string, input: FundingRequirementInput): PreparedPayment | Extract<FundingVerification, { ok: false }> {
    const c = this.cfg;
    if (!c || !this.facilitator) return invalid('cardano funding rail is not configured');
    if (!this.requirementMatchesConfig(input)) return invalid('requirement does not match configured treasury or asset');

    // 1. Decode defensively. The SDK helper throws on bad base64/JSON; zod checks the shape we rely on.
    let payload: PaymentPayload;
    try {
      payload = decodePaymentSignatureHeader(paymentHeaderValue);
    } catch {
      return invalid('malformed payment header');
    }
    const shaped = PaymentPayloadShape.safeParse(payload);
    if (!shaped.success) return invalid('payment payload has an unsupported shape or x402 version');

    // 2. The client's echoed `accepted` must be exactly what we asked for. Every field that carries
    //    value or policy is compared; a client cannot lower confirmations by editing `extra`.
    const expected = this.expectedAccept(input);
    const acc = shaped.data.accepted;
    const diffs: string[] = [];
    if (acc.scheme !== expected.scheme) diffs.push('scheme');
    if (acc.network !== expected.network) diffs.push('network');
    if (acc.amount !== expected.amount) diffs.push('amount');
    if (acc.asset !== expected.asset) diffs.push('asset');
    if (acc.payTo !== expected.payTo) diffs.push('payTo');
    if (!deepEqual(acc.extra, expected.extra)) diffs.push('extra');
    if (!Number.isInteger(acc.maxTimeoutSeconds) || acc.maxTimeoutSeconds < MIN_TIMEOUT_SECONDS || acc.maxTimeoutSeconds > MAX_TIMEOUT_SECONDS) {
      diffs.push('maxTimeoutSeconds');
    }
    if (shaped.data.resource.url !== input.resourceUrl) diffs.push('resource');
    if (diffs.length) return invalid(`accepted requirement does not match: ${diffs.join(', ')}`);

    // The payload carries the time budget the client signed against; everything else is ours.
    const requirement: PaymentRequirements = { ...expected, maxTimeoutSeconds: acc.maxTimeoutSeconds };
    const nonce = shaped.data.payload.nonce;

    // 3. Local pre-check: decode the signed transaction ourselves. Gives the canonical tx id and
    //    refuses a transaction that does not even pay the treasury, before the facilitator claims it.
    let decoded: DecodedTxView;
    try {
      decoded = this.decodeTx(shaped.data.payload.transaction);
    } catch {
      return invalid('transaction could not be decoded');
    }
    if (decoded.validUntilMs === null || !Number.isFinite(decoded.validUntilMs) || decoded.validUntilMs <= this.clock.now().getTime() || decoded.validUntilMs > Date.parse(input.expiresAt)) return invalid('signed transaction validity exceeds quote expiry or is expired');
    if (decoded.commitment !== fundingCommitment(input.resourceUrl, expected)) return invalid('signed transaction does not bind this purchase and quote');
    const localTx = decoded.txHash.toLowerCase();
    if (!TX_HASH.test(localTx)) return invalid('transaction id is not canonical');
    const requiredUnits = BigInt(input.amount.amountBaseUnits);
    const localReceived = localPaidTo(decoded, input.payTo, input.amount.assetId);
    if (localReceived < requiredUnits) return invalid('transaction does not pay the required amount to the treasury');

    return { ok: true, payload, requirement, nonce, localTx, localReceived };
  }

  /** Validate the candidate locally, so core can persist its identity before facilitator broadcast. */
  prepare(paymentHeaderValue: string, input: FundingRequirementInput): FundingPreparation {
    const prepared = this.inspectPayment(paymentHeaderValue, input);
    return prepared.ok ? { ok: true, transferReference: prepared.localTx } : prepared;
  }

  /** Never settles. The caller must prove this reference was durably prepared for this exact requirement. */
  async recover(transferReference: string, input: FundingRequirementInput): Promise<FundingVerification> {
    // Recovery follows the immutable stored payee/asset, even after configuration changes.
    if (!this.cfg || input.amount.network !== CARDANO_NETWORK || !CANONICAL_CARDANO_ASSET_REGEX.test(input.amount.assetId) || !POSITIVE_CANONICAL_AMOUNT_REGEX.test(input.amount.amountBaseUnits) || !CARDANO_ADDRESS_REGEX.test(input.payTo) || !Number.isFinite(Date.parse(input.expiresAt)) || !TX_HASH.test(transferReference)) return invalid('invalid persisted funding recovery requirement');
    const recovered = await this.recoverFromChain(transferReference, input, null, null);
    return recovered ?? invalid('recovery_pending: transfer is not independently observable');
  }

  async verify(paymentHeaderValue: string, input: FundingRequirementInput): Promise<FundingVerification> {
    const c = this.cfg;
    if (!c || !this.facilitator) return invalid('cardano funding rail is not configured');
    const prepared = this.inspectPayment(paymentHeaderValue, input);
    if (!prepared.ok) return { ...prepared, settlementAttempted: false };
    const { payload, requirement, nonce, localTx, localReceived } = prepared;

    // 4. Facilitator verify (read-only). Settle is never reached when this fails.
    let verifyRes: VerifyResponse;
    try {
      verifyRes = await this.facilitator.verify(payload, requirement);
    } catch (e) {
      if (e instanceof VerifyError) {
        verifyRes = { isValid: false, ...(e.invalidReason ? { invalidReason: e.invalidReason } : {}), ...(e.payer ? { payer: e.payer } : {}) };
      } else {
        this.event('facilitator.verify_unavailable', { host: c.facilitatorHost });
        return { ...invalid('facilitator_unavailable: retry with the identical payment header'), settlementAttempted: false };
      }
    }
    let payer: string | null = typeof verifyRes.payer === 'string' && CARDANO_ADDRESS_REGEX.test(verifyRes.payer) ? verifyRes.payer : null;
    if (!verifyRes.isValid) {
      return { ...invalid(`facilitator rejected payment: ${safeCode(verifyRes.invalidReason, 'verification_failed')}`), settlementAttempted: false };
    }

    if (Date.parse(input.expiresAt) <= this.clock.now().getTime()) return { ...invalid('quote expired during facilitator verification'), settlementAttempted: false };

    // 5. Settle. The facilitator broadcasts and waits for l1Confirmations (may return settlement_pending).
    let receipt: SettleResponse | null = null;
    try {
      receipt = await this.facilitator.settle(payload, requirement);
    } catch (e) {
      if (e instanceof SettleError) {
        receipt = {
          success: false,
          ...(e.errorReason ? { errorReason: e.errorReason } : {}),
          ...(e.payer ? { payer: e.payer } : {}),
          transaction: e.transaction,
          network: e.network,
        };
      } else {
        // Timeout or transport failure: the outcome is indeterminate. Never assume it failed.
        this.event('facilitator.settle_indeterminate', { host: c.facilitatorHost, tx: localTx });
      }
    }
    if (typeof receipt?.payer === 'string' && CARDANO_ADDRESS_REGEX.test(receipt.payer)) payer = receipt.payer;

    if (receipt?.errorReason === ERR_DUPLICATE_SETTLEMENT) {
      return { ok: false, code: 'payment_replayed', reason: 'this transaction is already being settled or was settled' };
    }
    if (!receipt) {
      const rec = await this.recoverFromChain(localTx, input, nonce, payer);
      if (rec) return rec;
      return invalid('settlement_indeterminate: retry with the identical payment header');
    }
    if (receipt.success !== true && receipt.errorReason !== ERR_SETTLEMENT_PENDING) {
      // Definitive failure at the facilitator. Still check the chain: a restart can turn a resumed
      // settlement into a spurious failure while the payment did land.
      const rec = await this.recoverFromChain(localTx, input, nonce, payer);
      if (rec) return rec;
      return invalid(`facilitator rejected settlement: ${safeCode(receipt.errorReason, 'settlement_failed')}`);
    }

    // The facilitator names the transaction it broadcast; it must be the one we decoded.
    // (A pending receipt may omit the id while the provider cannot see it yet; the local id stands.)
    const receiptTx = (receipt.transaction ?? '').toLowerCase();
    if ((receiptTx !== '' && receiptTx !== localTx) || (receipt.network && String(receipt.network) !== CARDANO_NETWORK)) {
      this.event('receipt.mismatch', { expectedTx: localTx, host: c.facilitatorHost });
      return invalid('settlement receipt does not match the submitted transaction');
    }

    const status = typeof receipt.extra?.status === 'string' ? receipt.extra.status : undefined;
    const facilitatorConfirmed = receipt.success === true && status === 'confirmed';

    // 6. Blockfrost independently proves outputs, commitment, network and confirmation depth.
    const chain = await this.checkChain(localTx, input);
    if (chain.state === 'mismatch') {
      this.event('chain.mismatch', { tx: localTx, detail: chain.detail });
      return invalid('on-chain outputs do not pay the treasury the required amount');
    }
    const verified = chain.state === 'match';
    const confirmations = chain.state === 'match' ? chain.tx.confirmations : null;
    const resolvedPayer = payer ?? (chain.state === 'match' ? chain.tx.firstInputAddress : null) ?? 'unknown';
    return {
      ok: true,
      funding: this.fundingRecord({
        txHash: localTx,
        input,
        payer: resolvedPayer,
        state: facilitatorConfirmed && verified && (confirmations ?? 0) >= REQUIRED_L1_CONFIRMATIONS ? 'confirmed' : 'submitted',
        confirmations,
        received: chain.state === 'match' ? chain.received : localReceived,
        chain: chain.state === 'match' ? chain.tx : null,
        nonce,
        settlementStatus: status ?? 'pending',
        // Echo only protocol receipt fields we checked; provider bodies and arbitrary extra never escape.
        header: encodePaymentResponseHeader({
          success: receipt.success === true, transaction: localTx, network: CARDANO_NETWORK,
          ...(payer ? { payer } : {}),
          ...(receipt.errorReason ? { errorReason: safeCode(receipt.errorReason, 'settlement_failed') } : {}),
          extra: { status: status === 'confirmed' ? 'confirmed' : 'pending', confirmations },
        }),
      }),
    };
  }

  /**
   * If Blockfrost already shows this exact payment, adopt it as evidence instead of failing a
   * settlement the chain has actually accepted. Returns null when the chain does not show it.
   */
  private async recoverFromChain(
    txHash: string,
    input: FundingRequirementInput,
    nonce: string | null,
    payer: string | null,
  ): Promise<FundingVerification | null> {
    const chain = await this.checkChain(txHash, input);
    if (chain.state === 'mismatch') return invalid('on-chain outputs do not pay the treasury the required amount');
    if (chain.state !== 'match') return null;
    const confirmed = (chain.tx.confirmations ?? 0) >= REQUIRED_L1_CONFIRMATIONS;
    this.event('chain.recovered', { tx: txHash });
    const resolvedPayer = payer ?? chain.tx.firstInputAddress ?? 'unknown';
    // Synthesized receipt: no facilitator response survived, so this documents what the chain showed.
    const receipt: SettleResponse = {
      success: confirmed,
      ...(confirmed ? {} : { errorReason: ERR_SETTLEMENT_PENDING }),
      payer: resolvedPayer,
      transaction: txHash,
      network: CARDANO_NETWORK,
      extra: { status: confirmed ? 'confirmed' : 'pending', confirmations: chain.tx.confirmations ?? 0 },
    };
    return {
      ok: true,
      funding: this.fundingRecord({
        txHash,
        input,
        payer: resolvedPayer,
        state: confirmed ? 'confirmed' : 'submitted',
        confirmations: chain.tx.confirmations,
        received: chain.received,
        chain: chain.tx,
        nonce,
        settlementStatus: 'recovered_from_chain',
        header: encodePaymentResponseHeader(receipt),
      }),
    };
  }

  private fundingRecord(a: {
    txHash: string;
    input: FundingRequirementInput;
    payer: string;
    state: PaymentState;
    confirmations: number | null;
    received: bigint;
    chain: OnChainTx | null;
    nonce: string | null;
    settlementStatus: string;
    header: string;
  }): VerifiedFunding {
    const c = this.cfg!;
    return {
      rail: 'cardano',
      network: CARDANO_NETWORK,
      assetId: a.input.amount.assetId,
      decimals: a.input.amount.decimals,
      amountBaseUnits: a.received.toString(),
      payer: a.payer,
      payee: a.input.payTo,
      transferReference: a.txHash,
      paymentState: a.state,
      confirmations: a.confirmations,
      purpose: 'purchase_principal',
      evidenceMode: 'fresh_external',
      observedAt: this.clock.now().toISOString(),
      settlementResponseHeader: { name: PAYMENT_RESPONSE_HEADER, value: a.header },
      details: {
        txHash: a.txHash,
        purchaseId: a.input.purchaseId,
        quoteId: a.input.quoteId,
        quoteDigest: a.input.quoteDigest,
        resourceUrl: a.input.resourceUrl,
        expiresAt: a.input.expiresAt,
        fundingCommitment: fundingCommitment(a.input.resourceUrl, this.expectedAccept(a.input)),
        nonce: a.nonce,
        confirmations: a.confirmations,
        blockHeight: a.chain?.blockHeight ?? null,
        blockTime: a.chain?.blockTime ? new Date(a.chain.blockTime * 1000).toISOString() : null,
        blockfrostVerified: a.chain !== null,
        // Host only. Never the full URL, never any key.
        facilitatorHost: c.facilitatorHost,
        settlementStatus: a.settlementStatus,
        confirmationPolicy: { l1Confirmations: REQUIRED_L1_CONFIRMATIONS },
      },
    };
  }

  /* ---------------- chain checks ---------------- */

  /** Read the transaction from Blockfrost and compare its outputs with the exact requirement. */
  private async checkChain(txHash: string, input: FundingRequirementInput): Promise<ChainCheck> {
    if (!this.blockfrost) return { state: 'error' };
    let tx: OnChainTx | null;
    try {
      tx = await this.blockfrost.getTransaction(txHash);
    } catch (e) {
      this.event('blockfrost.error', { kind: e instanceof BlockfrostError ? e.kind : 'unknown', status: e instanceof BlockfrostError ? e.status : null });
      return { state: 'error' };
    }
    if (!tx) return { state: 'not_found' };
    if (tx.commitment !== fundingCommitment(input.resourceUrl, this.expectedAccept(input))) return { state: 'mismatch', detail: 'on-chain funding commitment mismatch' };
    if (!tx.validContract) return { state: 'mismatch', detail: 'transaction failed phase-2 validation' };
    const received = sumPaidTo(tx.outputs, input.payTo, input.amount.assetId);
    const requiredUnits = BigInt(input.amount.amountBaseUnits);
    if (received < requiredUnits) {
      return { state: 'mismatch', detail: `treasury received ${received.toString()} of required ${requiredUnits.toString()} base units` };
    }
    return { state: 'match', tx, received };
  }

  /**
   * Re-check a previously verified but unconfirmed transfer. Never returns `invalid` because of an outage:
   * only a transaction that is on chain and does not pay the recorded amount to the recorded payee is invalid.
   */
  async confirm(funding: VerifiedFunding): Promise<{ paymentState: PaymentState; confirmations: number | null; observedAt: string }> {
    const observedAt = this.clock.now().toISOString();
    const pending = { paymentState: 'submitted' as const, confirmations: null, observedAt };
    // An outage or changed configuration is not evidence that an old transfer was invalid.
    // The persisted payee, asset and commitment govern this read-only confirmation.
    if (funding.rail !== 'cardano' || funding.network !== CARDANO_NETWORK || !CANONICAL_CARDANO_ASSET_REGEX.test(funding.assetId) || !CARDANO_ADDRESS_REGEX.test(funding.payee) || !POSITIVE_CANONICAL_AMOUNT_REGEX.test(funding.amountBaseUnits)) return pending;
    if (!this.blockfrost) return pending;
    let tx: OnChainTx | null;
    try {
      tx = await this.blockfrost.getTransaction(funding.transferReference);
    } catch {
      return pending;
    }
    if (!tx) return pending;
    const received = sumPaidTo(tx.outputs, funding.payee, funding.assetId);
    if (!tx.validContract || received < BigInt(funding.amountBaseUnits) ||
      typeof funding.details.fundingCommitment !== 'string' || tx.commitment !== funding.details.fundingCommitment) {
      this.event('chain.confirm_mismatch', { tx: funding.transferReference });
      return { paymentState: 'invalid', confirmations: tx.confirmations, observedAt };
    }
    if ((tx.confirmations ?? 0) >= REQUIRED_L1_CONFIRMATIONS) {
      return { paymentState: 'confirmed', confirmations: tx.confirmations, observedAt };
    }
    return { paymentState: 'submitted', confirmations: tx.confirmations, observedAt };
  }

  /* ---------------- readiness ---------------- */

  async readiness(): Promise<Readiness> {
    try {
      const nowMs = this.clock.now().getTime();
      if (this.readinessCache && this.readinessCache.until > nowMs) return this.readinessCache.value;
      // Share one in-flight probe between concurrent callers.
      this.readinessInflight ??= this.computeReadiness().finally(() => {
        this.readinessInflight = null;
      });
      return await this.readinessInflight;
    } catch {
      return this.readinessRecord('CONFIGURED_UNVERIFIED', [], 'readiness check failed unexpectedly');
    }
  }

  private readinessRecord(status: Readiness['status'], missing: string[], detail?: string): Readiness {
    return {
      component: 'cardano',
      status,
      environment: 'cardano-preprod',
      missing,
      ...(detail ? { detail } : {}),
      checkedAt: this.clock.now().toISOString(),
    };
  }

  private async computeReadiness(): Promise<Readiness> {
    if (!this.parsed.ok) {
      // Names only, never values.
      const names = [...new Set([...this.parsed.missing, ...this.parsed.invalid])];
      const detail = this.parsed.invalid.length ? `invalid value for: ${this.parsed.invalid.join(', ')}` : undefined;
      return this.readinessRecord('MISSING_CONFIG', names.length ? names : [...REQUIRED_ENV], detail);
    }
    const [fac, bf] = await Promise.all([this.probeFacilitator(), this.probeBlockfrost()]);
    const blocked = [fac, bf].some((p) => p.status === 'blocked');
    const unverified = [fac, bf].some((p) => p.status === 'unverified');
    const status = blocked ? 'ACCESS_BLOCKED' : unverified ? 'CONFIGURED_UNVERIFIED' : 'EXTERNAL_CHECK_PASSED';
    const detail = [fac.detail, bf.detail].filter(Boolean).join('; ');
    const value = this.readinessRecord(
      status,
      [],
      detail || (status === 'EXTERNAL_CHECK_PASSED' ? 'facilitator supports exact on cardano:preprod; blockfrost preprod reachable' : undefined),
    );
    this.readinessCache = {
      until: this.clock.now().getTime() + (status === 'EXTERNAL_CHECK_PASSED' ? READINESS_PASS_TTL_MS : READINESS_FAIL_TTL_MS),
      value,
    };
    return value;
  }

  private async probeFacilitator(): Promise<ReadinessProbe> {
    if (!this.facilitator) return { status: 'unverified', detail: 'facilitator not configured' };
    try {
      const s = await withTimeout(this.facilitator.getSupported(), PROBE_TIMEOUT_MS);
      const kind = s.kinds.find((k) => k.scheme === 'exact' && k.network === CARDANO_NETWORK && k.x402Version === 2);
      if (!kind) return { status: 'unverified', detail: 'facilitator does not list exact on cardano:preprod (x402 v2)' };
      const range = kind.extra?.l1Confirmations as { minimum?: unknown; maximum?: unknown } | undefined;
      if (range && typeof range.minimum === 'number' && typeof range.maximum === 'number') {
        if (REQUIRED_L1_CONFIRMATIONS < range.minimum || REQUIRED_L1_CONFIRMATIONS > range.maximum) {
          return { status: 'unverified', detail: `facilitator cannot settle l1Confirmations=${REQUIRED_L1_CONFIRMATIONS}` };
        }
      }
      return { status: 'ok' };
    } catch (e) {
      const m = e instanceof Error ? e.message : '';
      if (/\((401|403)\)/.test(m)) return { status: 'blocked', detail: 'facilitator rejected access' };
      return { status: 'unverified', detail: 'facilitator /supported unreachable' };
    }
  }

  private async probeBlockfrost(): Promise<ReadinessProbe> {
    if (!this.blockfrost) return { status: 'unverified', detail: 'blockfrost not configured' };
    try {
      await this.blockfrost.latestBlockHeight();
      const magic = await this.blockfrost.networkMagic();
      if (magic !== PREPROD_NETWORK_MAGIC) return { status: 'unverified', detail: 'blockfrost project is not on preprod' };
      return { status: 'ok' };
    } catch (e) {
      if (e instanceof BlockfrostError && e.isAuthFailure) return { status: 'blocked', detail: 'blockfrost rejected the project id' };
      return { status: 'unverified', detail: 'blockfrost unreachable' };
    }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const t = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error('timeout')), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}
