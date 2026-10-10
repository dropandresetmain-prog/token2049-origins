import type { FundingAdapter, FundingRequirementInput, FundingVerification, FundingPreparation } from '../../contracts/ports.js';
import { systemClock, type Clock } from '../../infrastructure/clock.js';
import { NETWORK, USDC_TYPE, parseSuiConfig } from './config.js';
import { assertRequirement, assertTransaction, readCandidate } from './wire.js';
import { SuiRpc, type SuiRpcPort } from './rpc.js';

const invalid = (reason: string, settlementAttempted?: boolean): Extract<FundingVerification, { ok: false }> =>
  ({ ok: false, code: 'payment_invalid', reason, ...(settlementAttempted === undefined ? {} : { settlementAttempted }) });
const pending = (): FundingVerification => ({ ok: false, code: 'payment_required', reason: 'Sui outcome retained for independent recovery', settlementAttempted: true });
export function createSuiFundingAdapter(env: NodeJS.ProcessEnv, opts: { clock?: Clock; rpc?: SuiRpcPort } = {}): FundingAdapter & {
  prepare(header: string, input: FundingRequirementInput): Promise<FundingPreparation>;
  recover(digest: string, input: FundingRequirementInput): Promise<FundingVerification>;
} {
  const parsed = parseSuiConfig(env), cfg = parsed.ok ? parsed.config : null, clock = opts.clock ?? systemClock;
  const rpc = opts.rpc ?? new SuiRpc();
  async function recover(digest: string, input: FundingRequirementInput): Promise<FundingVerification> {
    if (!cfg || !/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(digest)) return invalid('invalid Sui recovery candidate');
    try {
      assertRequirement(input, cfg, clock.now(), true);
      await rpc.assertNetwork();
      const chain = await rpc.transaction(digest);
      if (!chain) return pending();
      if (chain.checkpoint === null || chain.timestampMs === null) return pending();
      if (!chain.bcs || chain.digest !== digest || !/^[0-9]+$/.test(chain.checkpoint) || !Number.isSafeInteger(chain.timestampMs)) return invalid('Sui finalized evidence incomplete');
      const transfer = assertTransaction(chain.bcs, input, cfg.maxGasBudget);
      if (transfer.digest !== digest) return invalid('Sui on-chain bytes digest mismatch');
      const usdc = chain.balanceChanges.filter(b => b.coinType === USDC_TYPE);
      if (!chain.status.success) {
        if (usdc.some(b => BigInt(b.amount) !== 0n)) return invalid('Sui failed transaction has unexpected principal effects');
        return { ...invalid('Sui transaction failed on-chain; no purchase principal received'), definitiveFailure: true };
      }
      if (usdc.length !== 2 || !usdc.some(b => b.address === cfg.payee && b.amount === input.amount.amountBaseUnits) ||
          !usdc.some(b => b.address === transfer.payer && b.amount === '-' + input.amount.amountBaseUnits)) return invalid('Sui exact Circle USDC debit and destination credit mismatch');
      return { ok: true, funding: { rail: 'sui', network: NETWORK, assetId: USDC_TYPE, decimals: 6,
        amountBaseUnits: input.amount.amountBaseUnits, payer: transfer.payer, payee: cfg.payee, transferReference: digest,
        paymentState: 'confirmed', confirmations: null, purpose: input.settlement && BigInt(input.settlement.feeBaseUnits) > 0n ? 'principal_and_fee' : 'purchase_principal',
        evidenceMode: 'fresh_external', observedAt: clock.now().toISOString(), details: { source: 'sui_testnet_grpc',
          checkpoint: chain.checkpoint, timestampMs: chain.timestampMs, transactionDigest: digest, quoteDigest: input.quoteDigest,
          binding: 'payer_signed_application_candidate', onChainPurchaseCommitment: false, onChainQuoteExpiry: false,
          quoteExpiryEnforcement: 'application', receivedAfterExpiry: chain.timestampMs > Date.parse(input.expiresAt) } } };
    } catch { return pending(); }
  }
  const adapter: FundingAdapter & {
    prepare(header: string, input: FundingRequirementInput): Promise<FundingPreparation>;
    recover(digest: string, input: FundingRequirementInput): Promise<FundingVerification>;
  } = {
    rail: 'sui', network: NETWORK, paymentHeaderName: 'sui-payment',
    acceptedAsset: () => cfg ? { assetId: USDC_TYPE, decimals: 6, symbol: 'Testnet USDC', payTo: cfg.payee, supportsUsdNotional: true } : null,
    readiness: async () => {
      const base = { component: 'sui', environment: 'sui-testnet', checkedAt: clock.now().toISOString(), missing: parsed.ok ? [] : parsed.missing };
      if (!cfg) return { ...base, status: 'MISSING_CONFIG' };
      try { await rpc.assertNetwork(); await rpc.assertAsset(); return { ...base, status: 'EXTERNAL_CHECK_PASSED', detail: 'Native Circle USDC transfer; separate payer signatures; independent checkpoint readback' }; }
      catch { return { ...base, status: 'ACCESS_BLOCKED', detail: 'Testnet identity or Circle USDC metadata failed independent readiness' }; }
    },
    paymentRequirements: input => {
      if (!cfg) throw new Error('Sui funding unavailable');
      assertRequirement(input, cfg, clock.now());
      return { protocol: 'sui-usdc-transfer', version: 1, paymentHeader: 'sui-payment', requirement: (({ expectedPayer: _expectedPayer, ...publicInput }) => publicInput)(input),
        maxGasBudgetMist: cfg.maxGasBudget.toString(), binding: 'payer_signed_application_candidate', onChainPurchaseCommitment: false };
    },
    prepare: async (header, input) => {
      try {
        if (!cfg) return invalid('Sui funding unavailable', false);
        assertRequirement(input, cfg, clock.now());
        const c = await readCandidate(header, input, cfg);
        if (input.expectedPayer && c.transfer.payer !== input.expectedPayer) return invalid('payer differs from approved wallet', false);
        return { ok: true, transferReference: c.candidate.digest, recoveryPayload: { header } };
      } catch { return invalid('Sui signed candidate does not bind the exact requirement', false); }
    },
    recover,
    resume: async (digest, input, payload) => {
      // Validate the durable payload again after restart; an operator/database mismatch can never change its payment.
      try {
        if (!cfg || typeof payload.header !== 'string' || Object.keys(payload).length !== 1) return invalid('Sui recovery payload unavailable');
        const c = await readCandidate(payload.header, input, cfg);
        if (c.candidate.digest !== digest) return invalid('Sui durable recovery digest mismatch');
        const observed = await recover(digest, input);
        if (observed.ok || (!observed.ok && observed.code === 'payment_invalid')) return observed;
        if (Date.parse(input.expiresAt) <= clock.now().getTime()) return observed;
        // verify reads before sending and rechecks network, asset, objects and expiry. It resends only these same signed bytes.
        return adapter.verify(payload.header, input);
      } catch { return pending(); }
    },
    verify: async (header, input) => {
      let c: Awaited<ReturnType<typeof readCandidate>>;
      try {
        if (!cfg) return invalid('Sui funding unavailable', false);
        assertRequirement(input, cfg, clock.now());
        c = await readCandidate(header, input, cfg);
        if (input.expectedPayer && c.transfer.payer !== input.expectedPayer) return invalid('payer differs from approved wallet', false);
      } catch { return invalid('Sui signed candidate rejected', false); }
      try { await rpc.assertNetwork(); } catch { return invalid('Sui network identity check failed', false); }
      // An existing (even uncheckpointed or failed) transaction is never submitted again.
      // A read timeout cannot prove absence, so it also retains the candidate without submission.
      try { if (await rpc.transaction(c.candidate.digest)) return recover(c.candidate.digest, input); }
      catch { return pending(); }
      // Submission belongs to the gateway after durable preparation. The payer never broadcasts separately.
      try { await rpc.assertNetwork(); await rpc.assertAsset(); await rpc.assertPaymentObjects(c.bytes); assertRequirement(input, cfg!, clock.now()); }
      catch { return invalid('Sui pre-submission network, asset or expiry check failed', false); }
      try { await rpc.execute(c.bytes, c.candidate.signature); } catch { /* Preserve the candidate on every ambiguous submission. */ }
      return recover(c.candidate.digest, input);
    },
  };
  return adapter;
}
