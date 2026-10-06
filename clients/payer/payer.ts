/**
 * Bounded payer: pays ONE gateway purchase from a local test wallet, within hard caps, over x402 v2.
 *
 * This is a separate process from the commerce gateway (the gateway never imports clients/). It is the
 * only place a mnemonic is read, and only when a payment passes every policy check.
 *
 * Flow:  GET purchase -> POST /fund (expect 402) -> policy checks (BEFORE any signing) -> reserve in the
 *        durable ledger -> sign with the SDK (x402Client + ExactCardanoScheme) -> POST /fund with
 *        PAYMENT-SIGNATURE. Retries always resend the IDENTICAL header; a second transaction is never built.
 *
 * The signed header is a spend instruction. It is kept in memory and in the 0600 ledger, never logged,
 * and never returned to callers (bridge responses carry only the purchase and the transaction id).
 */
import type { ClientCardanoSigner } from '@x402/cardano';
import { ExactCardanoScheme as ExactCardanoClientScheme } from '@x402/cardano/exact/client';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { decodePaymentRequiredHeader, decodePaymentResponseHeader, decodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentRequired, PaymentRequirements } from '@x402/core/types';
import { deepEqual } from '@x402/core/utils';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { readSecretFile, type PayerConfig } from './config.js';
import { SettlementBreakdown, validateSettlement } from '../../src/contracts/settlement.js';
import { fundingCommitment } from '../../src/funding/cardano/binding.js';
import { createBoundSigner } from './signer.js';
import { PayerLedger } from './ledger.js';

export type PayerErrorCode =
  | 'invalid_request'
  | 'policy_violation'
  | 'not_found'
  | 'unauthenticated'
  | 'conflict'
  | 'payment_rejected'
  | 'gateway_unreachable'
  | 'internal';

/** Safe-to-return failure: messages are written here, never copied from gateway bodies or wallet code. */
export class PayerError extends Error {
  constructor(
    readonly code: PayerErrorCode,
    message: string,
    /** Latest purchase view when we fetched one (useful after a 409). */
    readonly purchase?: unknown,
  ) {
    super(message);
    this.name = 'PayerError';
  }
}

export interface PayResult {
  purchase: unknown;
  transferReference: string | null;
  /** True when a previous run of this payer had already paid; nothing new was signed or sent. */
  resumed: boolean;
}

export interface PayerDeps {
  config: PayerConfig;
  fetchImpl?: typeof fetch;
  /** Build the signer lazily, only after policy passes. Tests inject a mock; production reads the mnemonic file. */
  createSigner?: () => ClientCardanoSigner;
  ledger?: PayerLedger;
  /** Gateway bearer token source. Default reads PAYER_GATEWAY_TOKEN_FILE on each payment. */
  readGatewayToken?: () => string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  /** Sanitized events only (no headers, no tokens, no mnemonic). */
  log?: (entry: Record<string, unknown>) => void;
  maxAttempts?: number;
  /** Per-request timeout for POST /fund; the gateway may hold the call while the facilitator settles (~75s). */
  fundTimeoutMs?: number;
}

const PURCHASE_ID = /^pur_[0-9A-Za-z]{10,40}$/;
const CANON_AMOUNT = /^[1-9][0-9]*$/;
const RETRY_DELAYS_MS = [500, 1_500, 4_000, 8_000];
const SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';

/** What we need from the purchase view; unknown fields are ignored. */
const PurchaseLite = z
  .object({
    purchaseId: z.string(),
    quoteId: z.string(),
    state: z.string(),
    paymentState: z.string(),
    fundingInstructions: z
      .object({
        expiresAt: z.iso.datetime(),
        options: z.array(
          z
            .object({
              rail: z.string(),
              amount: z.object({ network: z.string(), assetId: z.string(), amountBaseUnits: z.string(), decimals: z.number().int() }).loose(),
              payTo: z.string(),
              settlement: SettlementBreakdown,
            })
            .loose(),
        ),
      })
      .loose()
      .nullable(),
    funding: z.array(z.object({ transferReference: z.string() }).loose()).default([]),
  })
  .loose();
type PurchaseLite = z.infer<typeof PurchaseLite>;

const ChallengeShape = z.object({
  x402Version: z.literal(2),
  resource: z.object({ url: z.string() }).loose(),
  accepts: z.array(z.object({ scheme: z.string(), network: z.string(), asset: z.string(), amount: z.string(),
    payTo: z.string(), maxTimeoutSeconds: z.number(), extra: z.record(z.string(), z.unknown()) }).loose()).min(1),
}).loose();

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Payer {
  private readonly f: typeof fetch;
  private readonly ledger: PayerLedger;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;
  private readonly log: (e: Record<string, unknown>) => void;

  constructor(private readonly d: PayerDeps) {
    this.f = d.fetchImpl ?? fetch;
    this.ledger = d.ledger ?? new PayerLedger(d.config.ledgerFile);
    if (!d.ledger) this.ledger.assertReady();
    this.sleep = d.sleep ?? sleepReal;
    this.now = d.now ?? (() => new Date());
    this.log = d.log ?? (() => undefined);
  }

  /* ---------------- gateway I/O ---------------- */

  private token(): string {
    try {
      return (this.d.readGatewayToken ?? (() => readSecretFile(this.d.config.gatewayTokenFile, 'PAYER_GATEWAY_TOKEN_FILE')))();
    } catch {
      throw new PayerError('unauthenticated', 'gateway token is not readable');
    }
  }

  private url(path: string): string {
    return `${this.d.config.gatewayUrl}${path}`;
  }

  private async call(method: 'GET' | 'POST', path: string, extra: Record<string, string> = {}, timeoutMs = 30_000): Promise<Response> {
    try {
      return await this.f(this.url(path), {
        method,
        headers: { authorization: `Bearer ${this.token()}`, accept: 'application/json', ...extra },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'error',
      });
    } catch (e) {
      if (e instanceof PayerError) throw e;
      throw new TransportError();
    }
  }

  private async getPurchase(id: string): Promise<{ raw: unknown; lite: PurchaseLite }> {
    let res: Response;
    try {
      res = await this.call('GET', `/v1/purchases/${id}`);
    } catch (e) {
      if (e instanceof TransportError) throw new PayerError('gateway_unreachable', 'gateway did not respond');
      throw e;
    }
    if (res.status === 401 || res.status === 403) throw new PayerError('unauthenticated', 'gateway rejected the payer token');
    if (res.status === 404) throw new PayerError('not_found', 'purchase not found');
    if (!res.ok) throw new PayerError('gateway_unreachable', `gateway returned HTTP ${res.status}`);
    const body = (await res.json().catch(() => null)) as { purchase?: unknown } | null;
    const parsed = PurchaseLite.safeParse(body?.purchase);
    if (!parsed.success) throw new PayerError('internal', 'gateway returned an unexpected purchase shape');
    if (parsed.data.purchaseId !== id) throw new PayerError('policy_violation', 'gateway returned a different purchase');
    return { raw: body!.purchase, lite: parsed.data };
  }

  /* ---------------- policy ---------------- */

  /**
   * Hard checks that run BEFORE any key is touched. Returns problems as fixed phrases; nothing from the
   * gateway response is echoed except short field names.
   */
  private policyProblems(entry: PaymentRequirements, purchase: PurchaseLite, id: string, resourceUrl: string | undefined): string[] {
    const c = this.d.config;
    const p: string[] = [];
    if (entry.scheme !== 'exact') p.push('scheme');
    if (entry.network !== c.network) p.push('network');
    if (entry.asset !== c.allowedAsset) p.push('asset');
    if (!CANON_AMOUNT.test(entry.amount)) p.push('amount_format');
    // Masumi escrow / script methods lock funds in a contract. This payer only ever makes plain transfers.
    const method = (entry.extra as { assetTransferMethod?: unknown } | undefined)?.assetTransferMethod;
    if (method !== undefined && method !== 'default') p.push('transfer_method');
    if (!/^addr_test1[0-9a-z]+$/.test(entry.payTo)) p.push('payTo_format');
    if (c.expectedPayTo && entry.payTo !== c.expectedPayTo) p.push('payTo');
    // The 402 must be about this purchase.
    if (resourceUrl !== this.url(`/v1/purchases/${id}/fund`)) p.push('resource');
    if (!purchase.fundingInstructions || Date.parse(purchase.fundingInstructions.expiresAt) <= this.now().getTime()) p.push('expiry');
    if (entry.extra?.purchaseId !== id || entry.extra?.quoteId !== purchase.quoteId ||
      entry.extra?.expiresAt !== purchase.fundingInstructions?.expiresAt || !/^[0-9a-f]{64}$/.test(String(entry.extra?.quoteDigest))) p.push('quote_binding');
    if (!Number.isInteger(entry.maxTimeoutSeconds) || entry.maxTimeoutSeconds < 60 || entry.maxTimeoutSeconds > 600) p.push('timeout');
    if (entry.extra?.areFeesSponsored !== false || !deepEqual(entry.extra?.confirmationPolicy, { l1Confirmations: 1 })) p.push('confirmation_policy');
    // The challenge must agree with what the purchase view told the customer to pay.
    const opt = purchase.fundingInstructions?.options.find((o) => o.rail === 'cardano');
    if (!opt) p.push('no_cardano_funding_option');
    else {
      if (opt.amount.amountBaseUnits !== entry.amount) p.push('amount_vs_purchase');
      if (opt.amount.assetId !== entry.asset) p.push('asset_vs_purchase');
      if (opt.amount.network !== entry.network) p.push('network_vs_purchase');
      if (opt.payTo !== entry.payTo) p.push('payTo_vs_purchase');
      try {
        const settlement = validateSettlement(opt.settlement, opt.amount.decimals);
        if (settlement.policy.mode !== 'scaled_testnet' || settlement.totalBaseUnits !== entry.amount ||
            entry.extra?.chainDecimals !== opt.amount.decimals || !deepEqual(settlement, entry.extra?.settlement)) p.push('settlement_policy');
      } catch { p.push('settlement_policy'); }
    }
    if (p.includes('amount_format')) return p;
    const amount = BigInt(entry.amount);
    if (amount > c.maxPerPayment) p.push('per_payment_cap');
    return p;
  }

  /* ---------------- main flow ---------------- */

  async pay(purchaseId: string): Promise<PayResult> {
    return this.ledger.exclusive(() => this.payLocked(purchaseId));
  }

  private async payLocked(purchaseId: string): Promise<PayResult> {
    if (!PURCHASE_ID.test(purchaseId)) throw new PayerError('invalid_request', 'purchaseId is not a valid purchase id');
    const c = this.d.config;

    // 1. Current purchase. If we already paid it in an earlier run, report instead of paying again.
    const { raw: purchaseRaw, lite: purchase } = await this.getPurchase(purchaseId);
    const prior = this.ledger.find(purchaseId);
    if (purchase.state !== 'awaiting_funding' || purchase.paymentState === 'submitted') {
      if (prior && (prior.status === 'signed' || prior.status === 'accepted') && purchase.funding.length > 0) {
        this.ledger.upsert({ ...prior, status: 'accepted', transferReference: prior.transferReference ?? purchase.funding[0]!.transferReference, updatedAt: this.now().toISOString() });
        return { purchase: purchaseRaw, transferReference: purchase.funding[0]!.transferReference, resumed: true };
      }
      throw new PayerError('conflict', 'purchase does not accept funding', purchaseRaw);
    }

    // 2. Obtain the challenge (no payment header => 402).
    const challenge = await this.fetchChallenge(purchaseId);

    // 3. Policy BEFORE signing.
    const entries = challenge.accepts.filter((a) => a.scheme === 'exact' && a.network === c.network && a.asset === c.allowedAsset);
    const entry = entries[0];
    if (!entry) throw new PayerError('policy_violation', 'challenge offers no payment option allowed by payer policy (network/asset)');
    const problems = this.policyProblems(entry, purchase, purchaseId, challenge.resource?.url);
    if (problems.length) throw new PayerError('policy_violation', `payment refused by payer policy: ${problems.join(', ')}`);
    if (challenge.x402Version !== 2) throw new PayerError('policy_violation', 'payment refused by payer policy: x402Version');

    const amount = BigInt(entry.amount);
    let header: string;
    if (prior && prior.status !== 'signing' && prior.header) {
      // Resume: resend the transaction we already built. Never build a second one for this purchase.
      if (prior.amountBaseUnits !== entry.amount || prior.payTo !== entry.payTo || prior.asset !== entry.asset || prior.network !== entry.network) {
        throw new PayerError('conflict', 'a previously signed payment for this purchase no longer matches the requirement');
      }
      try {
        const previous = decodePaymentSignatureHeader(prior.header);
        if (previous.resource?.url !== challenge.resource!.url || !deepEqual(previous.accepted.extra, entry.extra)) throw new Error('binding changed');
      } catch { throw new PayerError('conflict', 'previous payment quote binding no longer matches the requirement'); }
      header = prior.header;
      this.log({ type: 'payer.resume', purchaseId });
    } else {
      // Cumulative cap, counting this payment, enforced before signing. An earlier 'signing' reservation
      // for this same purchase is replaced, not double counted (the ledger holds one row per purchase).
      const already = this.ledger.committed(c.network, c.allowedAsset) - (prior ? BigInt(prior.amountBaseUnits) : 0n);
      if (already + amount > c.maxCumulative) throw new PayerError('policy_violation', 'payment refused by payer policy: cumulative_cap');

      const now = this.now();
      const dailyPrior = prior && (prior.status !== 'accepted' || prior.updatedAt.slice(0, 10) === now.toISOString().slice(0, 10)) ? BigInt(prior.amountBaseUnits) : 0n;
      if (this.ledger.daily(c.network, c.allowedAsset, now) - dailyPrior + amount > c.maxDaily) {
        throw new PayerError('policy_violation', 'payment refused by payer policy: daily_cap');
      }
      const ts = now.toISOString();
      // Reserve first: if we crash after signing, the cap already reflects it.
      this.ledger.upsert({ purchaseId, network: c.network, asset: c.allowedAsset, amountBaseUnits: entry.amount, payTo: entry.payTo, status: 'signing', header: null, transferReference: null, createdAt: ts, updatedAt: ts });
      header = await this.sign(challenge, entry);
      this.ledger.upsert({ purchaseId, network: c.network, asset: c.allowedAsset, amountBaseUnits: entry.amount, payTo: entry.payTo, status: 'signed', header, transferReference: null, createdAt: ts, updatedAt: this.now().toISOString() });
      this.log({ type: 'payer.signed', purchaseId, amountBaseUnits: amount.toString() });
    }

    if (this.ledger.daily(c.network, c.allowedAsset, this.now()) > c.maxDaily) {
      throw new PayerError('policy_violation', 'payment refused by payer policy: daily_cap');
    }

    // 4. Send with retries (identical header every time).
    return this.sendFunding(purchaseId, header);
  }

  private async fetchChallenge(purchaseId: string): Promise<PaymentRequired> {
    let res: Response;
    try {
      res = await this.call('POST', `/v1/purchases/${purchaseId}/fund`);
    } catch (e) {
      if (e instanceof TransportError) throw new PayerError('gateway_unreachable', 'gateway did not respond');
      throw e;
    }
    if (res.status === 401 || res.status === 403) throw new PayerError('unauthenticated', 'gateway rejected the payer token');
    if (res.status === 404) throw new PayerError('not_found', 'purchase not found');
    if (res.status === 409) {
      const { raw } = await this.getPurchase(purchaseId).catch(() => ({ raw: undefined }));
      throw new PayerError('conflict', 'purchase does not accept funding', raw);
    }
    if (res.status !== 402) throw new PayerError('gateway_unreachable', `unexpected HTTP ${res.status} when requesting payment terms`);
    const headerValue = res.headers.get('payment-required');
    try {
      const decoded: unknown = headerValue ? decodePaymentRequiredHeader(headerValue) : await res.json();
      const parsed = ChallengeShape.safeParse(decoded);
      if (!parsed.success) throw new Error('invalid challenge');
      return parsed.data as PaymentRequired;
    } catch {
      throw new PayerError('internal', 'payment terms could not be decoded');
    }
  }

  /** Sign through the SDK with its own spend controls as a second guard behind our policy. */
  private async sign(challenge: PaymentRequired, entry: PaymentRequirements): Promise<string> {
    const c = this.d.config;
    let signer: ClientCardanoSigner;
    try {
      signer = (this.d.createSigner ?? (() => this.defaultSigner(fundingCommitment(challenge.resource!.url, entry))))();
    } catch {
      throw new PayerError('internal', 'payer wallet could not be loaded');
    }
    const client = new x402Client();
    client.register(c.network, new ExactCardanoClientScheme(signer));
    client.setSpendControls({
      maxAmountPerPayment: false,
      allowedAssets: [{ network: c.network, asset: c.allowedAsset, maxAmountPerPayment: c.maxPerPayment.toString() }],
    });
    try {
      // Only the one vetted option goes to the SDK; it cannot pick another.
      const payload = await client.createPaymentPayload({ ...challenge, accepts: [entry] });
      if (!deepEqual(payload.accepted, entry)) throw new Error('accepted drift');
      const headers = new x402HTTPClient(client).encodePaymentSignatureHeader(payload);
      const value = Object.entries(headers).find(([k]) => k.toLowerCase() === SIGNATURE_HEADER.toLowerCase())?.[1];
      if (!value) throw new Error('no header');
      return value;
    } catch {
      // The SDK's message may describe wallet state; keep it out of the surface.
      throw new PayerError('internal', 'payment could not be signed (check wallet funds and Blockfrost access)');
    }
  }

  private defaultSigner(commitment: string): ClientCardanoSigner {
    const c = this.d.config;
    const mnemonic = readFileSync(c.mnemonicFile, 'utf8');
    return createBoundSigner(c, mnemonic, commitment);
  }

  private async sendFunding(purchaseId: string, header: string): Promise<PayResult> {
    const max = this.d.maxAttempts ?? RETRY_DELAYS_MS.length + 1;
    let lastNote = 'no response';
    for (let attempt = 0; attempt < max; attempt++) {
      if (attempt > 0) await this.sleep(RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)]!);
      let res: Response;
      try {
        res = await this.call('POST', `/v1/purchases/${purchaseId}/fund`, { [SIGNATURE_HEADER]: header }, this.d.fundTimeoutMs ?? 120_000);
      } catch (e) {
        if (e instanceof PayerError) throw e;
        lastNote = 'network error or timeout';
        this.log({ type: 'payer.retry', purchaseId, attempt, why: 'transport' });
        continue;
      }

      if (res.status === 202 || res.status === 200) {
        const body = (await res.json().catch(() => null)) as { purchase?: unknown } | null;
        const receipt = res.headers.get('payment-response');
        let tx: string | null = null;
        try {
          if (receipt) tx = decodePaymentResponseHeader(receipt).transaction || null;
        } catch {
          tx = null;
        }
        const lite = PurchaseLite.safeParse(body?.purchase);
        if (!lite.success || lite.data.purchaseId !== purchaseId || lite.data.funding.length === 0) {
          throw new PayerError('gateway_unreachable', 'payment response did not confirm this purchase; retry the identical payment');
        }
        tx ??= lite.data.funding[0]!.transferReference;
        this.markAccepted(purchaseId, tx);
        return { purchase: body?.purchase ?? null, transferReference: tx, resumed: false };
      }

      const errBody = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      const code = errBody?.error?.code;
      const message = errBody?.error?.message ?? '';

      if (res.status === 401 || res.status === 403) throw new PayerError('unauthenticated', 'gateway rejected the payer token');

      // Transient on the gateway side: the same payload may still succeed.
      const retryable =
        res.status >= 500 ||
        res.status === 429 ||
        (code === 'payment_invalid' && /facilitator_unavailable|settlement_indeterminate/.test(message));
      if (retryable) {
        lastNote = `gateway HTTP ${res.status}`;
        this.log({ type: 'payer.retry', purchaseId, attempt, why: `http_${res.status}` });
        continue;
      }

      if (res.status === 409) {
        // Our earlier attempt may have landed with the response lost. Look before reporting a conflict.
        const got = await this.getPurchase(purchaseId).catch(() => null);
        if (got && got.lite.state !== 'awaiting_funding' && got.lite.funding.length > 0 && code !== 'payment_replayed') {
          const tx = got.lite.funding[0]!.transferReference;
          this.markAccepted(purchaseId, tx);
          return { purchase: got.raw, transferReference: tx, resumed: true };
        }
        throw new PayerError('conflict', code === 'payment_replayed' ? 'gateway reports this payment was already used' : 'purchase does not accept this payment', got?.raw);
      }

      if (res.status === 404) throw new PayerError('not_found', 'purchase not found');
      // Definitive rejection (payment_invalid, quote_expired, ...). The reason is the gateway's sanitized code.
      throw new PayerError('payment_rejected', `gateway rejected the payment${code ? ` (${/^[a-z_]{3,40}$/.test(code) ? code : 'error'})` : ''}`);
    }
    throw new PayerError('gateway_unreachable', `payment sent but no confirmed answer (${lastNote}); re-run to resend the identical payment`);
  }

  private markAccepted(purchaseId: string, tx: string | null): void {
    const e = this.ledger.find(purchaseId);
    if (e) this.ledger.upsert({ ...e, status: 'accepted', transferReference: tx ?? e.transferReference, updatedAt: this.now().toISOString() });
  }
}

class TransportError extends Error {}
