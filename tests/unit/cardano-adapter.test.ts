/**
 * Offline tests for the Cardano funding adapter. Everything external is fake: the facilitator is an
 * object with spies, Blockfrost is a routed `fetch`, and transactions are synthetic (the adapter's
 * `decodeTransaction` seam maps a string to the outputs it "contains"). Addresses are synthetic.
 */
import { describe, expect, it } from 'vitest';
import { USDM_PREPROD_ASSET } from '@x402/cardano';
import { ExactCardanoScheme as ExactCardanoClientScheme } from '@x402/cardano/exact/client';
import { x402Client } from '@x402/core/client';
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentRequiredHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import { SettleError, VerifyError } from '@x402/core/types';
import type { PaymentPayload, PaymentRequired, PaymentRequirements, SettleResponse, SupportedResponse, VerifyResponse } from '@x402/core/types';
import { createCardanoFundingAdapter, type CardanoFacilitatorPort, type DecodedTxView } from '../../src/funding/cardano/index.js';
import type { FundingRequirementInput, FundingVerification, VerifiedFunding } from '../../src/contracts/ports.js';
import { fundingCommitment } from '../../src/funding/cardano/binding.js';
import { ManualClock } from '../../src/infrastructure/clock.js';

const TREASURY = 'addr_test1qztreasury0000000000000000000000000000000000000000000000';
const PAYER = 'addr_test1qzpayer000000000000000000000000000000000000000000000000000';
const OTHER = 'addr_test1qzother000000000000000000000000000000000000000000000000000';
const PROJECT_ID = 'preprodSECRETPROJECTIDvalue123';
const FAC_URL = 'https://facilitator.example.test';
const TX = 'a'.repeat(64);
const NONCE = `${'b'.repeat(64)}#0`;
const AMOUNT = '1500000';
const RESOURCE = 'http://127.0.0.1:8787/v1/purchases/pur_ABCDEFGHIJKLMNOP/fund';

const baseEnv = (over: Record<string, string> = {}): NodeJS.ProcessEnv => ({
  CARDANO_NETWORK: 'cardano:preprod',
  CARDANO_FACILITATOR_URL: FAC_URL,
  CARDANO_TREASURY_ADDRESS: TREASURY,
  CARDANO_ASSET_UNIT: USDM_PREPROD_ASSET,
  CARDANO_ASSET_DECIMALS: '6',
  BLOCKFROST_PROJECT_ID: PROJECT_ID,
  BLOCKFROST_BASE_URL: 'https://cardano-preprod.blockfrost.io/api/v0',
  ...over,
});

const clock = new ManualClock();

function input(over: Partial<FundingRequirementInput> = {}, asset = USDM_PREPROD_ASSET): FundingRequirementInput {
  return {
    purchaseId: 'pur_ABCDEFGHIJKLMNOP',
    quoteId: 'quo_ABCDEFGHIJKLMNOP',
    quoteDigest: 'd'.repeat(64),
    amount: { network: 'cardano:preprod', assetId: asset, decimals: 6, amountBaseUnits: AMOUNT },
    payTo: TREASURY,
    resourceUrl: RESOURCE,
    description: 'Purchase funding',
    expiresAt: new Date(clock.now().getTime() + 15 * 60_000).toISOString(),
    ...over,
  };
}

/* ---------------- fakes ---------------- */

interface FakeFacilitator extends CardanoFacilitatorPort {
  calls: string[];
  verifyImpl: (p: PaymentPayload, r: PaymentRequirements) => Promise<VerifyResponse>;
  settleImpl: (p: PaymentPayload, r: PaymentRequirements) => Promise<SettleResponse>;
  supportedImpl: () => Promise<SupportedResponse>;
  lastRequirements?: PaymentRequirements;
}

function fakeFacilitator(): FakeFacilitator {
  const f: FakeFacilitator = {
    calls: [],
    verifyImpl: async () => ({ isValid: true, payer: PAYER }),
    settleImpl: async () => ({ success: true, payer: PAYER, transaction: TX, network: 'cardano:preprod', extra: { status: 'confirmed', confirmations: 1 } }),
    supportedImpl: async () => ({
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'cardano:preprod', extra: { l1Confirmations: { minimum: 0, maximum: 20 } } }],
      extensions: [],
      signers: {},
    }),
    async verify(p, r) {
      f.calls.push('verify');
      f.lastRequirements = r;
      return f.verifyImpl(p, r);
    },
    async settle(p, r) {
      f.calls.push('settle');
      return f.settleImpl(p, r);
    },
    async getSupported() {
      f.calls.push('supported');
      return f.supportedImpl();
    },
  };
  return f;
}

/** Synthetic transactions: string -> what it "pays". */
class TxBook {
  private readonly m = new Map<string, DecodedTxView>();
  add(txString: string, hash: string, outputs: Array<{ address: string; asset: string; amount: bigint }>): string {
    this.m.set(txString, {
      txHash: hash,
      validUntilMs: Date.parse(input().expiresAt),
      commitment: fundingCommitment(RESOURCE, (rig(baseEnv({ CARDANO_ASSET_UNIT: outputs[0]?.asset ?? USDM_PREPROD_ASSET })).adapter.paymentRequirements(input({}, outputs[0]?.asset)) as unknown as PaymentRequired).accepts[0]!),
      outputs: outputs.map((o) => ({
        address: o.address,
        coin: o.asset === 'lovelace' ? o.amount : 2_000_000n,
        assets: o.asset === 'lovelace' ? {} : { [o.asset]: o.amount },
      })),
    });
    return txString;
  }
  decode = (tx: string): DecodedTxView => {
    const d = this.m.get(tx);
    if (!d) throw new Error('undecodable');
    return d;
  };
}

type BfTx = { hash: string; height: number | null; outputs: Array<{ address: string; unit: string; quantity: string }>; validContract?: boolean };

class FakeBlockfrost {
  txs = new Map<string, BfTx>();
  tip = 1010;
  magic = 1;
  metadataOverride: string | null = null;
  status: number | null = null; // force an HTTP status for every route
  throwTransport = false;
  requests: Array<{ path: string; projectId: string | null }> = [];
  fetch: typeof fetch = async (url, init) => {
    const u = new URL(String(url));
    const path = u.pathname.replace('/api/v0', '');
    const headers = new Headers(init?.headers);
    this.requests.push({ path, projectId: headers.get('project_id') });
    if (this.throwTransport) throw new Error('ECONNRESET');
    if (this.status !== null) return new Response('{}', { status: this.status });
    const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
    if (path === '/blocks/latest') return json({ height: this.tip });
    if (path === '/genesis') return json({ network_magic: this.magic });
    const m = /^\/txs\/([0-9a-f]{64})(\/(?:utxos|metadata))?$/.exec(path);
    if (m) {
      const tx = this.txs.get(m[1]!);
      if (!tx || tx.height === null) return json({ message: 'not found' }, 404);
      if (m[2] === '/metadata') return json([{ label: '2049', json_metadata: this.metadataOverride ?? fundingCommitment(RESOURCE, (rig(baseEnv({ CARDANO_ASSET_UNIT: tx.outputs[0]!.unit === 'lovelace' ? 'lovelace' : USDM_PREPROD_ASSET })).adapter.paymentRequirements(input({}, tx.outputs[0]!.unit === 'lovelace' ? 'lovelace' : USDM_PREPROD_ASSET)) as unknown as PaymentRequired).accepts[0]!) }]);
      if (m[2]) {
        return json({
          hash: tx.hash,
          inputs: [{ address: PAYER, tx_hash: 'c'.repeat(64), output_index: 0 }],
          outputs: tx.outputs.map((o, i) => ({ address: o.address, amount: [{ unit: o.unit, quantity: o.quantity }], output_index: i })),
        });
      }
      return json({ hash: tx.hash, block_height: tx.height, block_time: 1_790_000_000, valid_contract: tx.validContract ?? true });
    }
    return json({}, 404);
  };
  /** Chain shows the exact payment. */
  pay(hash = TX, to = TREASURY, unit = USDM_PREPROD_ASSET.replace('.', ''), quantity = AMOUNT, height: number | null = 1005) {
    this.txs.set(hash, { hash, height, outputs: [{ address: to, unit, quantity }] });
  }
}

interface Rig {
  adapter: ReturnType<typeof createCardanoFundingAdapter>;
  fac: FakeFacilitator;
  bf: FakeBlockfrost;
  book: TxBook;
  logs: Array<Record<string, unknown>>;
}

function rig(env: NodeJS.ProcessEnv = baseEnv()): Rig {
  const fac = fakeFacilitator();
  const bf = new FakeBlockfrost();
  const book = new TxBook();
  const logs: Array<Record<string, unknown>> = [];
  const adapter = createCardanoFundingAdapter(env, { facilitator: fac, fetchImpl: bf.fetch, clock, decodeTransaction: book.decode, log: (l) => logs.push(l) });
  return { adapter, fac, bf, book, logs };
}

/** Build a PAYMENT-SIGNATURE header the way an honest client would, optionally tampering. */
function header(r: Rig, over: { accepted?: Partial<PaymentRequirements>; extra?: Record<string, unknown>; tx?: string; version?: number; resourceUrl?: string } = {}, inp = input()): string {
  const challenge = r.adapter.paymentRequirements(inp) as unknown as PaymentRequired;
  const accepts = challenge.accepts[0]!;
  const payload = {
    x402Version: over.version ?? 2,
    resource: { url: over.resourceUrl ?? RESOURCE },
    accepted: { ...accepts, ...(over.accepted ?? {}), ...(over.extra ? { extra: { ...accepts.extra, ...over.extra } } : {}) },
    payload: { transaction: over.tx ?? 'tx-ok', nonce: NONCE },
  };
  return encodePaymentSignatureHeader(payload as unknown as PaymentPayload);
}

function okRig(): Rig {
  const r = rig();
  r.book.add('tx-ok', TX, [{ address: TREASURY, asset: USDM_PREPROD_ASSET, amount: BigInt(AMOUNT) }]);
  r.bf.pay();
  return r;
}

function expectOk(v: FundingVerification): VerifiedFunding {
  if (!v.ok) throw new Error(`expected ok, got ${v.code}: ${v.reason}`);
  return v.funding;
}

/* ---------------- tests ---------------- */

describe('cardano adapter: asset and requirements', () => {
  it('acceptedAsset is null when unconfigured and claims USD parity only for the exact Preprod tUSDM unit', () => {
    expect(createCardanoFundingAdapter({}).acceptedAsset()).toBeNull();

    const tusdm = rig().adapter.acceptedAsset();
    expect(tusdm).toEqual({ assetId: USDM_PREPROD_ASSET, decimals: 6, symbol: 'tUSDM', payTo: TREASURY, usdParity: true });

    // tADA is never valued at USD parity and gets no ticker.
    const ada = createCardanoFundingAdapter(baseEnv({ CARDANO_ASSET_UNIT: 'lovelace' })).acceptedAsset();
    expect(ada).toEqual({ assetId: 'lovelace', decimals: 6, payTo: TREASURY, usdParity: false });

    // Same policy, different asset name; and a different policy with the real name: neither is tUSDM.
    const [policy, name] = USDM_PREPROD_ASSET.split('.');
    const wrongName = createCardanoFundingAdapter(baseEnv({ CARDANO_ASSET_UNIT: `${policy}.0014df105553444d` })).acceptedAsset();
    const wrongPolicy = createCardanoFundingAdapter(baseEnv({ CARDANO_ASSET_UNIT: `${'0'.repeat(56)}.${name}` })).acceptedAsset();
    expect(wrongName?.usdParity).toBe(false);
    expect(wrongName).not.toHaveProperty('symbol');
    expect(wrongPolicy?.usdParity).toBe(false);
    expect(wrongPolicy).not.toHaveProperty('symbol');

    // Hex case is normalized, so an upper-case spelling of the same unit is still the same asset.
    const upper = createCardanoFundingAdapter(baseEnv({ CARDANO_ASSET_UNIT: USDM_PREPROD_ASSET.toUpperCase() })).acceptedAsset();
    expect(upper?.assetId).toBe(USDM_PREPROD_ASSET);
    expect(upper?.usdParity).toBe(true);
  });

  it('exports the rail identity', () => {
    const a = rig().adapter;
    expect(a.rail).toBe('cardano');
    expect(a.network).toBe('cardano:preprod');
    expect(a.paymentHeaderName).toBe('payment-signature');
  });

  it('emits an x402 v2 PaymentRequired that survives the SDK header encoding', () => {
    const r = rig();
    const req = r.adapter.paymentRequirements(input()) as unknown as PaymentRequired;
    expect(req.x402Version).toBe(2);
    expect(req.resource).toEqual({ url: RESOURCE, description: 'Purchase funding', mimeType: 'application/json' });
    expect(req.accepts).toHaveLength(1);
    const a = req.accepts[0]!;
    expect(a).toMatchObject({ scheme: 'exact', network: 'cardano:preprod', amount: AMOUNT, asset: USDM_PREPROD_ASSET, payTo: TREASURY });
    expect(a.maxTimeoutSeconds).toBe(600); // 15 min left, capped at 600
    expect(a.extra).toMatchObject({ confirmationPolicy: { l1Confirmations: 1 }, areFeesSponsored: false, purchaseId: 'pur_ABCDEFGHIJKLMNOP' });
    // Round trip through the official header helpers.
    expect(decodePaymentRequiredHeader(encodePaymentRequiredHeader(req))).toEqual(req);
  });

  it('clamps maxTimeoutSeconds to [60, 600] from the time left', () => {
    const r = rig();
    const left = (secs: number) =>
      (r.adapter.paymentRequirements(input({ expiresAt: new Date(clock.now().getTime() + secs * 1000).toISOString() })) as unknown as PaymentRequired).accepts[0]!.maxTimeoutSeconds;
    expect(left(5)).toBe(60);
    expect(left(200)).toBe(200);
    expect(left(100_000)).toBe(600);
  });

  it('refuses to issue a challenge for a requirement that is not its own treasury/asset/network', () => {
    const r = rig();
    expect(() => r.adapter.paymentRequirements(input({ payTo: OTHER }))).toThrow();
    expect(() => r.adapter.paymentRequirements(input({}, 'lovelace'))).toThrow();
    expect(() => r.adapter.paymentRequirements(input({ amount: { network: 'cardano:mainnet', assetId: USDM_PREPROD_ASSET, decimals: 6, amountBaseUnits: AMOUNT } }))).toThrow();
    expect(() => r.adapter.paymentRequirements(input({ amount: { network: 'cardano:preprod', assetId: USDM_PREPROD_ASSET, decimals: 6, amountBaseUnits: '0' } }))).toThrow();
  });
});

describe('cardano adapter: verify and settle', () => {
  it('confirms a valid payment: verify then settle, independent chain check, safe evidence', async () => {
    const r = okRig();
    const f = expectOk(await r.adapter.verify(header(r), input()));
    expect(r.fac.calls).toEqual(['verify', 'settle']);
    expect(f).toMatchObject({
      rail: 'cardano',
      network: 'cardano:preprod',
      assetId: USDM_PREPROD_ASSET,
      decimals: 6,
      amountBaseUnits: AMOUNT,
      payer: PAYER,
      payee: TREASURY,
      transferReference: TX,
      paymentState: 'confirmed',
      purpose: 'purchase_principal',
      evidenceMode: 'fresh_external',
    });
    expect(f.confirmations).toBeGreaterThanOrEqual(1);
    expect(f.details).toMatchObject({ txHash: TX, nonce: NONCE, blockfrostVerified: true, facilitatorHost: 'facilitator.example.test', blockHeight: 1005 });
    expect(f.settlementResponseHeader?.name).toBe('PAYMENT-RESPONSE');
    const receipt = decodePaymentResponseHeader(f.settlementResponseHeader!.value);
    expect(receipt).toMatchObject({ success: true, transaction: TX, network: 'cardano:preprod' });
    // The independent check really used the project id, and it never leaks into evidence.
    expect(r.bf.requests.every((q) => q.projectId === PROJECT_ID)).toBe(true);
    expect(JSON.stringify(f)).not.toContain(PROJECT_ID);
    expect(JSON.stringify(r.logs)).not.toContain(PROJECT_ID);
  });

  it('never echoes arbitrary facilitator payloads in the settlement header', async () => {
    const r = okRig();
    r.fac.settleImpl = async () => ({ success: true, payer: PAYER, transaction: TX, network: 'cardano:preprod',
      errorMessage: PROJECT_ID, extra: { status: 'confirmed', confirmations: 1, privatePayload: PROJECT_ID } });
    const f = expectOk(await r.adapter.verify(header(r), input()));
    expect(JSON.stringify(decodePaymentResponseHeader(f.settlementResponseHeader!.value))).not.toContain(PROJECT_ID);
  });

  it('passes the facilitator exactly our requirement (not client-supplied fields)', async () => {
    const r = okRig();
    expectOk(await r.adapter.verify(header(r), input()));
    expect(r.fac.lastRequirements).toMatchObject({ scheme: 'exact', network: 'cardano:preprod', amount: AMOUNT, asset: USDM_PREPROD_ASSET, payTo: TREASURY });
    expect(r.fac.lastRequirements?.extra).toMatchObject({ confirmationPolicy: { l1Confirmations: 1 } });
  });

  const tampers: Array<[string, Parameters<typeof header>[1]]> = [
    ['amount', { accepted: { amount: '1' } }],
    ['asset', { accepted: { asset: 'lovelace' } }],
    ['payTo', { accepted: { payTo: OTHER } }],
    ['network', { accepted: { network: 'cardano:preview' } }],
    ['scheme', { accepted: { scheme: 'upto' } }],
    ['extra', { extra: { confirmationPolicy: { l1Confirmations: -1 } } }],
    ['resource', { resourceUrl: 'http://127.0.0.1:8787/v1/purchases/pur_SOMEONEELSEXXXX/fund' }],
    ['maxTimeoutSeconds', { accepted: { maxTimeoutSeconds: 86_400 } }],
  ];
  for (const [field, over] of tampers) {
    it(`rejects an accepted-requirement mismatch on ${field} without calling the facilitator`, async () => {
      const r = okRig();
      const v = await r.adapter.verify(header(r, over), input());
      expect(v).toMatchObject({ ok: false, code: 'payment_invalid' });
      expect(r.fac.calls).toEqual([]);
      if (!v.ok) expect(v.reason).toContain(field);
    });
  }

  it('rejects an x402 v1 payload, a malformed header and an undecodable transaction without settling', async () => {
    const r = okRig();
    expect(await r.adapter.verify(header(r, { version: 1 }), input())).toMatchObject({ ok: false, code: 'payment_invalid' });
    expect(await r.adapter.verify('!!not-base64-json!!', input())).toMatchObject({ ok: false, code: 'payment_invalid' });
    expect(await r.adapter.verify(header(r, { tx: 'tx-undecodable' }), input())).toMatchObject({ ok: false, code: 'payment_invalid' });
    expect(r.fac.calls).toEqual([]);
  });

  it('rejects a transaction that does not pay the treasury enough before any facilitator call', async () => {
    const r = rig();
    r.book.add('tx-low', TX, [{ address: TREASURY, asset: USDM_PREPROD_ASSET, amount: 1n }]);
    r.book.add('tx-wrong-addr', TX, [{ address: OTHER, asset: USDM_PREPROD_ASSET, amount: BigInt(AMOUNT) }]);
    r.book.add('tx-wrong-asset', TX, [{ address: TREASURY, asset: 'lovelace', amount: BigInt(AMOUNT) }]);
    // lovelace output of 2 ADA exists in the synthetic tx for token payments, but tUSDM quantity is absent here.
    for (const tx of ['tx-low', 'tx-wrong-addr']) {
      expect(await r.adapter.verify(header(r, { tx }), input())).toMatchObject({ ok: false, code: 'payment_invalid' });
    }
    expect(r.fac.calls).toEqual([]);
  });

  it('maps a facilitator verify failure to payment_invalid, never calls settle, never echoes raw bodies', async () => {
    const r = okRig();
    r.fac.verifyImpl = async () => ({ isValid: false, invalidReason: 'invalid_exact_cardano_payload_amount_insufficient', invalidMessage: `secret ${PROJECT_ID} detail`, payer: PAYER });
    const v = await r.adapter.verify(header(r), input());
    expect(v).toMatchObject({ ok: false, code: 'payment_invalid' });
    if (!v.ok) {
      expect(v.reason).toContain('invalid_exact_cardano_payload_amount_insufficient');
      expect(v.reason).not.toContain(PROJECT_ID);
    }
    expect(r.fac.calls).toEqual(['verify']);

    // Thrown VerifyError (HTTP non-2xx with an isValid body) behaves the same; unusual reason strings collapse.
    const r2 = okRig();
    r2.fac.verifyImpl = async () => {
      throw new VerifyError(400, { isValid: false, invalidReason: `Bad Reason With ${PROJECT_ID}!` });
    };
    const v2 = await r2.adapter.verify(header(r2), input());
    expect(v2).toMatchObject({ ok: false, code: 'payment_invalid' });
    if (!v2.ok) expect(v2.reason).not.toContain(PROJECT_ID);
    expect(r2.fac.calls).toEqual(['verify']);
  });

  it('treats a facilitator outage during verify as retryable payment_invalid without settling', async () => {
    const r = okRig();
    r.fac.verifyImpl = async () => {
      throw new Error(`connect ECONNREFUSED ${FAC_URL}`);
    };
    const v = await r.adapter.verify(header(r), input());
    expect(v).toMatchObject({ ok: false, code: 'payment_invalid' });
    if (!v.ok) {
      expect(v.reason).toContain('facilitator_unavailable');
      expect(v.reason).not.toContain('ECONNREFUSED');
    }
    expect(r.fac.calls).toEqual(['verify']);
  });

  it('maps settlement_pending (returned or thrown) to submitted, not confirmed', async () => {
    const pending: SettleResponse = { success: false, errorReason: 'settlement_pending', payer: PAYER, transaction: TX, network: 'cardano:preprod', extra: { status: 'pending', transactionId: TX } };
    const r = okRig();
    r.fac.settleImpl = async () => pending;
    const f = expectOk(await r.adapter.verify(header(r), input()));
    expect(f.paymentState).toBe('submitted');
    expect(f.transferReference).toBe(TX);
    expect(decodePaymentResponseHeader(f.settlementResponseHeader!.value)).toMatchObject({ success: false, errorReason: 'settlement_pending' });

    const r2 = okRig();
    r2.fac.settleImpl = async () => {
      throw new SettleError(502, pending);
    };
    expect(expectOk(await r2.adapter.verify(header(r2), input())).paymentState).toBe('submitted');

    // Mempool-only success from a facilitator is also not confirmed.
    const r3 = okRig();
    r3.fac.settleImpl = async () => ({ success: true, payer: PAYER, transaction: TX, network: 'cardano:preprod', extra: { status: 'mempool', confirmations: -1 } });
    expect(expectOk(await r3.adapter.verify(header(r3), input())).paymentState).toBe('submitted');
  });

  it('maps duplicate settlement to payment_replayed', async () => {
    const dup: SettleResponse = { success: false, errorReason: 'duplicate_settlement', transaction: TX, network: 'cardano:preprod' };
    const r = okRig();
    r.fac.settleImpl = async () => dup;
    expect(await r.adapter.verify(header(r), input())).toMatchObject({ ok: false, code: 'payment_replayed' });

    const r2 = okRig();
    r2.fac.settleImpl = async () => {
      throw new SettleError(409, dup);
    };
    expect(await r2.adapter.verify(header(r2), input())).toMatchObject({ ok: false, code: 'payment_replayed' });
  });

  it('maps any other settle failure to payment_invalid with a sanitized code', async () => {
    const r = okRig();
    r.bf.txs.clear(); // chain does not show it either
    r.fac.settleImpl = async () => ({ success: false, errorReason: 'exact_cardano_settlement_definitively_rejected', errorMessage: `x ${PROJECT_ID}`, transaction: TX, network: 'cardano:preprod' });
    const v = await r.adapter.verify(header(r), input());
    expect(v).toMatchObject({ ok: false, code: 'payment_invalid' });
    if (!v.ok) {
      expect(v.reason).toContain('exact_cardano_settlement_definitively_rejected');
      expect(v.reason).not.toContain(PROJECT_ID);
    }
  });

  it('rejects a receipt that names a different transaction than the one submitted', async () => {
    const r = okRig();
    r.fac.settleImpl = async () => ({ success: true, payer: PAYER, transaction: 'e'.repeat(64), network: 'cardano:preprod', extra: { status: 'confirmed', confirmations: 1 } });
    expect(await r.adapter.verify(header(r), input())).toMatchObject({ ok: false, code: 'payment_invalid' });
  });

  it('rejects when Blockfrost shows an output to the wrong address or a lower quantity, even after a confirmed receipt', async () => {
    const wrongAddr = okRig();
    wrongAddr.bf.pay(TX, OTHER);
    expect(await wrongAddr.adapter.verify(header(wrongAddr), input())).toMatchObject({ ok: false, code: 'payment_invalid' });

    const lower = okRig();
    lower.bf.pay(TX, TREASURY, USDM_PREPROD_ASSET.replace('.', ''), '1499999');
    expect(await lower.adapter.verify(header(lower), input())).toMatchObject({ ok: false, code: 'payment_invalid' });

    const wrongUnit = okRig();
    wrongUnit.bf.pay(TX, TREASURY, 'lovelace', AMOUNT);
    expect(await wrongUnit.adapter.verify(header(wrongUnit), input())).toMatchObject({ ok: false, code: 'payment_invalid' });

    const failedScript = okRig();
    failedScript.bf.txs.get(TX)!.validContract = false;
    expect(await failedScript.adapter.verify(header(failedScript), input())).toMatchObject({ ok: false, code: 'payment_invalid' });
    // The sanitized event is logged without the secret.
    expect(wrongAddr.logs.some((l) => l.type === 'chain.mismatch')).toBe(true);
    expect(JSON.stringify(wrongAddr.logs)).not.toContain(PROJECT_ID);
  });

  it('refuses mismatched independent metadata, response hash, and network', async () => {
    const metadata = okRig(); metadata.bf.metadataOverride = 'e'.repeat(64);
    expect(await metadata.adapter.verify(header(metadata), input())).toMatchObject({ ok: false });
    const hash = okRig(); hash.bf.txs.get(TX)!.hash = 'e'.repeat(64);
    expect(expectOk(await hash.adapter.verify(header(hash), input())).paymentState).toBe('submitted');
    const network = okRig(); network.bf.magic = 764824073;
    expect(expectOk(await network.adapter.verify(header(network), input())).paymentState).toBe('submitted');
  });

  it('sums several outputs to the treasury and reports the real received amount', async () => {
    const r = okRig();
    r.book.add('tx-ok', TX, [
      { address: TREASURY, asset: USDM_PREPROD_ASSET, amount: 1_000_000n },
      { address: TREASURY, asset: USDM_PREPROD_ASSET, amount: 700_000n },
    ]);
    r.bf.txs.set(TX, { hash: TX, height: 1005, outputs: [
      { address: TREASURY, unit: USDM_PREPROD_ASSET.replace('.', ''), quantity: '1000000' },
      { address: TREASURY, unit: USDM_PREPROD_ASSET.replace('.', ''), quantity: '700000' },
    ] });
    const f = expectOk(await r.adapter.verify(header(r), input()));
    expect(f.amountBaseUnits).toBe('1700000');
    expect(f.paymentState).toBe('confirmed');
  });

  it('keeps lovelace payments exact: output coin counts, token quantities do not', async () => {
    const env = baseEnv({ CARDANO_ASSET_UNIT: 'lovelace' });
    const r = rig(env);
    r.book.add('tx-ok', TX, [{ address: TREASURY, asset: 'lovelace', amount: BigInt(AMOUNT) }]);
    r.bf.pay(TX, TREASURY, 'lovelace', AMOUNT);
    const inp = input({}, 'lovelace');
    const f = expectOk(await r.adapter.verify(header(r, {}, inp), inp));
    expect(f).toMatchObject({ assetId: 'lovelace', amountBaseUnits: AMOUNT, paymentState: 'confirmed' });
  });

  it('returns submitted (not confirmed) when Blockfrost has not seen the transaction yet or is down', async () => {
    const notYet = okRig();
    notYet.bf.txs.clear();
    const a = expectOk(await notYet.adapter.verify(header(notYet), input()));
    expect(a.paymentState).toBe('submitted');
    expect(a.details).toMatchObject({ blockfrostVerified: false });
    expect(a.amountBaseUnits).toBe(AMOUNT);

    const down = okRig();
    down.bf.status = 503;
    const b = expectOk(await down.adapter.verify(header(down), input()));
    expect(b.paymentState).toBe('submitted');
    expect(b.details).toMatchObject({ blockfrostVerified: false });
    expect(down.logs.some((l) => l.type === 'blockfrost.error')).toBe(true);
  });

  it('on an indeterminate settle, adopts the payment if the chain shows it, else asks for an identical retry', async () => {
    const lands = okRig();
    lands.fac.settleImpl = async () => {
      throw new Error('timeout');
    };
    const f = expectOk(await lands.adapter.verify(header(lands), input()));
    expect(f).toMatchObject({ paymentState: 'confirmed', transferReference: TX });
    expect(f.details).toMatchObject({ settlementStatus: 'recovered_from_chain', blockfrostVerified: true });

    const unseen = okRig();
    unseen.bf.txs.clear();
    unseen.fac.settleImpl = async () => {
      throw new Error('timeout');
    };
    const v = await unseen.adapter.verify(header(unseen), input());
    expect(v).toMatchObject({ ok: false, code: 'payment_invalid' });
    if (!v.ok) expect(v.reason).toContain('settlement_indeterminate');
  });

  it('refuses an invalid SDK verification even when an old payment appears on chain', async () => {
    const r = okRig();
    r.fac.verifyImpl = async () => ({ isValid: false, invalidReason: 'invalid_exact_cardano_payload_input_not_available' });
    expect(await r.adapter.verify(header(r), input())).toMatchObject({ ok: false, code: 'payment_invalid' });
    expect(r.fac.calls).toEqual(['verify']);
  });

  it('requires independent depth even if the facilitator claims deep confirmation', async () => {
    const r = okRig(); r.bf.tip = 1005;
    expect(expectOk(await r.adapter.verify(header(r), input()))).toMatchObject({ paymentState: 'submitted', confirmations: 0 });
  });

  it('rejects a rewrapped transaction for another equal-price quote and missing resource', async () => {
    const r = okRig();
    const changed = input({ quoteId: 'quo_DIFFERENTQUOTE', quoteDigest: 'e'.repeat(64) });
    expect(await r.adapter.verify(header(r, {}, changed), changed)).toMatchObject({ ok: false, code: 'payment_invalid' });
    expect(r.fac.calls).toEqual([]);
    const challenge = r.adapter.paymentRequirements(input()) as unknown as PaymentRequired;
    const payload = { x402Version: 2, accepted: challenge.accepts[0]!, payload: { transaction: 'tx-ok', nonce: NONCE } };
    expect(await r.adapter.verify(encodePaymentSignatureHeader(payload as PaymentPayload), input())).toMatchObject({ ok: false });
  });

  it('rejects expired requirements and wrong decimal scaling before external calls', async () => {
    const r = okRig(); const h = header(r);
    expect(await r.adapter.verify(h, input({ expiresAt: clock.now().toISOString() }))).toMatchObject({ ok: false });
    expect(await r.adapter.verify(h, input({ amount: { ...input().amount, decimals: 5 } }))).toMatchObject({ ok: false });
    expect(r.fac.calls).toEqual([]);
  });

  it('returns submitted from recovery when the chain shows the output but below the required depth', async () => {
    const r = okRig();
    r.bf.tip = 1005; // in the tip block: 0 newer blocks
    r.fac.settleImpl = async () => {
      throw new Error('timeout');
    };
    expect(expectOk(await r.adapter.verify(header(r), input())).paymentState).toBe('submitted');
  });
});

describe('cardano adapter: durable funding recovery seam', () => {
  it('prepares a canonical candidate without facilitator or chain side effects', () => {
    const r = okRig();
    expect(r.adapter.prepare(header(r), input())).toEqual({ ok: true, transferReference: TX });
    expect(r.fac.calls).toEqual([]); expect(r.bf.requests).toEqual([]);
  });
  it('refuses malformed candidates before any side effect', () => {
    const r = okRig();
    expect(r.adapter.prepare(header(r, { resourceUrl: 'https://evil.example' }), input())).toMatchObject({ ok: false });
    expect(r.adapter.prepare('invalid', input())).toMatchObject({ ok: false });
    expect(r.fac.calls).toEqual([]); expect(r.bf.requests).toEqual([]);
  });
  it('retrieves a prepared reference independently without settling again', async () => {
    const r = okRig();
    const f = expectOk(await r.adapter.recover(TX, input()));
    expect(f).toMatchObject({ transferReference: TX, paymentState: 'confirmed' });
    expect(r.fac.calls).toEqual([]);
  });
  it('recovers after quote expiry as evidence for core refundable obligations', async () => {
    const r = okRig(); const requirement = input(); const h = header(r, {}, requirement);
    expect(r.adapter.prepare(h, requirement)).toMatchObject({ ok: true });
    clock.advance(16 * 60_000);
    const originalCommitment = fundingCommitment(RESOURCE, { ...(rig().adapter.paymentRequirements(input()) as unknown as PaymentRequired).accepts[0]!, extra: {
      assetTransferMethod: 'default', confirmationPolicy: { l1Confirmations: 1 }, areFeesSponsored: false,
      purchaseId: requirement.purchaseId, quoteId: requirement.quoteId, quoteDigest: requirement.quoteDigest, expiresAt: requirement.expiresAt,
    } });
    r.bf.metadataOverride = originalCommitment;
    expect(expectOk(await r.adapter.recover(TX, requirement))).toMatchObject({ paymentState: 'confirmed' });
    expect(r.fac.calls).toEqual([]);
  });
  it('fails closed or stays pending on missing, mismatched, unavailable and shallow recovery evidence', async () => {
    const missing = okRig(); missing.bf.txs.clear();
    expect(await missing.adapter.recover(TX, input())).toMatchObject({ ok: false });
    const wrong = okRig(); wrong.bf.metadataOverride = 'f'.repeat(64);
    expect(await wrong.adapter.recover(TX, input())).toMatchObject({ ok: false });
    const down = okRig(); down.bf.status = 503;
    expect(await down.adapter.recover(TX, input())).toMatchObject({ ok: false });
    const shallow = okRig(); shallow.bf.tip = 1005;
    expect(expectOk(await shallow.adapter.recover(TX, input())).paymentState).toBe('submitted');
    expect(await shallow.adapter.recover('../unsafe', input())).toMatchObject({ ok: false });
    for (const r of [missing, wrong, down, shallow]) expect(r.fac.calls).toEqual([]);
  });
});

describe('cardano adapter: confirm()', () => {
  const funding = (over: Partial<VerifiedFunding> = {}): VerifiedFunding => ({
    rail: 'cardano',
    network: 'cardano:preprod',
    assetId: USDM_PREPROD_ASSET,
    decimals: 6,
    amountBaseUnits: AMOUNT,
    payer: PAYER,
    payee: TREASURY,
    transferReference: TX,
    paymentState: 'submitted',
    confirmations: null,
    purpose: 'purchase_principal',
    evidenceMode: 'fresh_external',
    observedAt: clock.now().toISOString(),
    details: { fundingCommitment: fundingCommitment(RESOURCE, (rig().adapter.paymentRequirements(input()) as unknown as PaymentRequired).accepts[0]!) },
    ...over,
  });

  it('confirms once the output is in a block with the required depth', async () => {
    const r = rig();
    r.bf.pay();
    expect(await r.adapter.confirm!(funding())).toMatchObject({ paymentState: 'confirmed', confirmations: 5 });
  });

  it('stays submitted while the transaction is not indexed, not deep enough, or Blockfrost is unavailable', async () => {
    const r = rig();
    expect((await r.adapter.confirm!(funding())).paymentState).toBe('submitted');
    r.bf.pay(TX, TREASURY, USDM_PREPROD_ASSET.replace('.', ''), AMOUNT, 1010); // tip block => 0 confirmations
    expect(await r.adapter.confirm!(funding())).toMatchObject({ paymentState: 'submitted', confirmations: 0 });
    r.bf.status = 500;
    expect((await r.adapter.confirm!(funding())).paymentState).toBe('submitted');
    r.bf.status = null;
    r.bf.throwTransport = true;
    expect((await r.adapter.confirm!(funding())).paymentState).toBe('submitted');
  });

  it('preserves submitted proof when configuration is absent and confirms the immutable payee after rotation',async()=>{
    const stored=funding();expect((await createCardanoFundingAdapter({}).confirm!(stored)).paymentState).toBe('submitted');
    const rotated=rig(baseEnv({CARDANO_TREASURY_ADDRESS:OTHER}));rotated.bf.pay();expect((await rotated.adapter.confirm!(stored)).paymentState).toBe('confirmed');
    expect(expectOk(await rotated.adapter.recover(TX,input())).payee).toBe(TREASURY);
  });

  it('reports invalid when the on-chain output does not match what was recorded', async () => {
    const r = rig();
    r.bf.pay(TX, OTHER);
    expect((await r.adapter.confirm!(funding())).paymentState).toBe('invalid');
    const r2 = rig();
    r2.bf.pay(TX, TREASURY, USDM_PREPROD_ASSET.replace('.', ''), '1');
    expect((await r2.adapter.confirm!(funding())).paymentState).toBe('invalid');
  });
});

describe('cardano adapter: readiness', () => {
  it('lists env NAMES (never values) when config is missing', async () => {
    const r = await createCardanoFundingAdapter({ BLOCKFROST_PROJECT_ID: PROJECT_ID }).readiness();
    expect(r.status).toBe('MISSING_CONFIG');
    expect(r.missing).toEqual(['CARDANO_NETWORK', 'CARDANO_FACILITATOR_URL', 'CARDANO_TREASURY_ADDRESS', 'CARDANO_ASSET_UNIT', 'CARDANO_ASSET_DECIMALS']);
    expect(JSON.stringify(r)).not.toContain(PROJECT_ID);
  });

  it('flags invalid values by name only and never contains the values', async () => {
    const env = baseEnv({ CARDANO_NETWORK: 'cardano:mainnet', CARDANO_TREASURY_ADDRESS: 'addr1qmainnetaddressvalue', CARDANO_ASSET_UNIT: 'not-a-unit', CARDANO_FACILITATOR_URL: 'ftp://nope.example', CARDANO_ASSET_DECIMALS: 'six' });
    const r = await createCardanoFundingAdapter(env, { facilitator: fakeFacilitator() }).readiness();
    expect(r.status).toBe('MISSING_CONFIG');
    expect(r.missing).toEqual(expect.arrayContaining(['CARDANO_NETWORK', 'CARDANO_TREASURY_ADDRESS', 'CARDANO_ASSET_UNIT', 'CARDANO_FACILITATOR_URL', 'CARDANO_ASSET_DECIMALS']));
    const s = JSON.stringify(r);
    for (const secret of ['cardano:mainnet', 'addr1qmainnetaddressvalue', 'not-a-unit', 'ftp://nope.example', PROJECT_ID]) expect(s).not.toContain(secret);
    expect(createCardanoFundingAdapter(env).acceptedAsset()).toBeNull();
  });

  it('rejects facilitator URLs with embedded credentials and 6-decimal assets configured with other decimals', async () => {
    const creds = await createCardanoFundingAdapter(baseEnv({ CARDANO_FACILITATOR_URL: 'https://user:pw@facilitator.example.test' })).readiness();
    expect(creds.status).toBe('MISSING_CONFIG');
    const dec = await createCardanoFundingAdapter(baseEnv({ CARDANO_ASSET_DECIMALS: '2' })).readiness();
    expect(dec.missing).toContain('CARDANO_ASSET_DECIMALS');
  });

  it('passes only after both external probes succeed, and caches the result for five minutes', async () => {
    const r = rig();
    const first = await r.adapter.readiness();
    expect(first.status).toBe('EXTERNAL_CHECK_PASSED');
    const supportedCalls = () => r.fac.calls.filter((c) => c === 'supported').length;
    expect(supportedCalls()).toBe(1);
    await r.adapter.readiness();
    expect(supportedCalls()).toBe(1);
    clock.advance(5 * 60_000 + 1);
    await r.adapter.readiness();
    expect(supportedCalls()).toBe(2);
  });

  it('reports ACCESS_BLOCKED on a Blockfrost auth failure and CONFIGURED_UNVERIFIED otherwise', async () => {
    const blocked = rig();
    blocked.bf.status = 403;
    expect((await blocked.adapter.readiness()).status).toBe('ACCESS_BLOCKED');

    const facBlocked = rig();
    facBlocked.fac.supportedImpl = async () => {
      throw new Error('Facilitator getSupported failed (401): nope');
    };
    expect((await facBlocked.adapter.readiness()).status).toBe('ACCESS_BLOCKED');

    const noKind = rig();
    noKind.fac.supportedImpl = async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {} });
    expect((await noKind.adapter.readiness()).status).toBe('CONFIGURED_UNVERIFIED');

    const outOfRange = rig();
    outOfRange.fac.supportedImpl = async () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'cardano:preprod', extra: { l1Confirmations: { minimum: 5, maximum: 20 } } }], extensions: [], signers: {} });
    expect((await outOfRange.adapter.readiness()).status).toBe('CONFIGURED_UNVERIFIED');

    const wrongNet = rig();
    wrongNet.bf.magic = 764824073;
    const w = await wrongNet.adapter.readiness();
    expect(w.status).toBe('CONFIGURED_UNVERIFIED');
    expect(w.detail).toContain('preprod');

    const down = rig();
    down.bf.throwTransport = true;
    const d = await down.adapter.readiness();
    expect(d.status).toBe('CONFIGURED_UNVERIFIED');
    expect(JSON.stringify(d)).not.toContain(PROJECT_ID);
  });

  it('never throws, whatever the probes do', async () => {
    const r = rig();
    r.fac.supportedImpl = () => {
      throw new Error('sync boom');
    };
    r.bf.throwTransport = true;
    await expect(r.adapter.readiness()).resolves.toMatchObject({ component: 'cardano' });
  });
});


describe('signed transaction expiry boundary',()=>{
  it.each([null,NaN,Date.parse(input().expiresAt)+1000])('rejects invalid or excessive validity end %s before facilitator settlement',async end=>{
    const r=okRig();r.book.decode('tx-ok').validUntilMs=end;
    expect(await r.adapter.verify(header(r),input())).toMatchObject({ok:false,settlementAttempted:false});
    expect(r.fac.calls).not.toContain('settle');
  });
  it('rechecks expiry after read-only facilitator verification before settling',async()=>{
    const r=okRig(),inp=input(),signed=header(r,{},inp),original=clock.now().toISOString();
    try {
      r.fac.verifyImpl=async()=>{clock.set(inp.expiresAt);return {isValid:true,payer:PAYER};};
      expect(await r.adapter.verify(signed,inp)).toMatchObject({ok:false,settlementAttempted:false});
      expect(r.fac.calls).toContain('verify');expect(r.fac.calls).not.toContain('settle');
    } finally {clock.set(original);}
  });
});
