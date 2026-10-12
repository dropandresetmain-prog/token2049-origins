import type { FundingAdapter, FundingRequirementInput, FundingVerification, FundingPreparation } from '../../contracts/ports.js';
import { systemClock, type Clock } from '../../infrastructure/clock.js';
import { CHAIN_ID, NETWORK, TOKEN, TOKEN_DECIMALS, parseXLayerConfig, type XLayerConfig } from './config.js';
import { PROTOCOL, TRANSFER_TOPIC, TX_HASH, assertRequirement, readCandidate, transferCalldata } from './wire.js';
import { XLayerRpc, xlayerClient, type XLayerRpcPort } from './rpc.js';

const invalid = (reason: string, settlementAttempted?: boolean): Extract<FundingVerification, { ok: false }> =>
  ({ ok: false, code: 'payment_invalid', reason, ...(settlementAttempted === undefined ? {} : { settlementAttempted }) });
const pending = (): FundingVerification => ({ ok: false, code: 'payment_required', reason: 'X Layer outcome retained for independent recovery', settlementAttempted: true });
const topicAddress = (topic: string | undefined): string | null => topic && /^0x0{24}[0-9a-f]{40}$/.test(topic) ? '0x' + topic.slice(26) : null;

export interface XLayerAdapterOptions { clock?: Clock; rpc?: XLayerRpcPort; sleep?: (ms: number) => Promise<void>; pollAttempts?: number; pollIntervalMs?: number }
type Adapter = FundingAdapter & {
  prepare(header: string, input: FundingRequirementInput): Promise<FundingPreparation>;
  recover(hash: string, input: FundingRequirementInput): Promise<FundingVerification>;
};
export function createXLayerFundingAdapter(env: NodeJS.ProcessEnv, opts: XLayerAdapterOptions = {}): Adapter {
  const parsed = parseXLayerConfig(env), cfg: XLayerConfig | null = parsed.ok ? parsed.config : null, clock = opts.clock ?? systemClock;
  const rpc = opts.rpc ?? new XLayerRpc(xlayerClient(cfg?.rpcUrl));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const pollAttempts = opts.pollAttempts ?? 8, pollIntervalMs = opts.pollIntervalMs ?? 1500;

  /** Independent, read-only evaluation of one transaction hash against the exact requirement. */
  async function recover(hash: string, input: FundingRequirementInput): Promise<FundingVerification> {
    if (!cfg || !TX_HASH.test(hash)) return invalid('invalid X Layer recovery candidate');
    try {
      assertRequirement(input, cfg, clock.now(), true);
      await rpc.assertNetwork();
      const tx = await rpc.transaction(hash);
      if (!tx) return pending();
      if (tx.hash !== hash || (tx.chainId !== null && tx.chainId !== CHAIN_ID) || tx.to !== TOKEN ||
          tx.input.toLowerCase() !== transferCalldata(input.payTo, BigInt(input.amount.amountBaseUnits)).toLowerCase() ||
          tx.from === input.payTo || (input.expectedPayer && tx.from !== input.expectedPayer.toLowerCase())) return invalid('X Layer on-chain transaction does not match the exact requirement');
      const receipt = await rpc.receipt(hash);
      if (!receipt || tx.blockNumber === null) return pending();
      if (receipt.hash !== hash || receipt.from !== tx.from || receipt.to !== TOKEN || receipt.blockNumber !== tx.blockNumber) return invalid('X Layer receipt and transaction disagree');
      const latest = await rpc.latestBlock(), confirmations = latest - receipt.blockNumber + 1n;
      if (confirmations < BigInt(cfg.confirmations)) return pending();
      const transfers = receipt.logs.filter(l => l.address === TOKEN && l.topics[0] === TRANSFER_TOPIC);
      if (receipt.status === 'reverted') {
        if (transfers.length) return invalid('X Layer failed transaction has unexpected principal effects');
        return { ...invalid('X Layer transaction reverted on-chain; no purchase principal received'), definitiveFailure: true };
      }
      const log = transfers[0];
      if (transfers.length !== 1 || !log || log.topics.length !== 3 || topicAddress(log.topics[1]) !== tx.from || topicAddress(log.topics[2]) !== cfg.payee ||
          !/^0x[0-9a-f]{64}$/.test(log.data) || BigInt(log.data) !== BigInt(input.amount.amountBaseUnits)) return invalid('X Layer exact USD₮0 Transfer event mismatch');
      const timestampMs = await rpc.blockTimestampMs(receipt.blockNumber);
      return { ok: true, funding: { rail: 'xlayer', network: NETWORK, assetId: TOKEN, decimals: TOKEN_DECIMALS,
        amountBaseUnits: input.amount.amountBaseUnits, payer: tx.from, payee: cfg.payee, transferReference: hash,
        paymentState: 'confirmed', confirmations: Number(confirmations),
        purpose: input.settlement && BigInt(input.settlement.feeBaseUnits) > 0n ? 'principal_and_fee' : 'purchase_principal',
        evidenceMode: 'fresh_external', observedAt: clock.now().toISOString(), details: { source: 'xlayer_testnet_rpc',
          chainId: CHAIN_ID, tokenContract: TOKEN, txHash: hash, blockHeight: receipt.blockNumber.toString(), blockHash: receipt.blockHash,
          logIndex: log.logIndex, gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(),
          timestampMs, quoteDigest: input.quoteDigest, binding: 'payer_signed_application_candidate',
          onChainPurchaseCommitment: false, onChainQuoteExpiry: false, quoteExpiryEnforcement: 'application',
          receivedAfterExpiry: timestampMs > Date.parse(input.expiresAt) } } };
    } catch { return pending(); }
  }

  /**
   * An EVM nonce can be consumed once. If the nonce is already used at a confirmed block and the candidate hash is
   * still absent, that exact signed transaction can never be included: a definitive, zero-principal outcome.
   */
  async function superseded(payer: string, nonce: number, hash: string): Promise<boolean> {
    const latest = await rpc.latestBlock(), settled = latest - BigInt(cfg!.confirmations) + 1n;
    if (settled < 0n || (await rpc.transactionCount(payer, settled)) <= nonce) return false;
    return (await rpc.transaction(hash)) === null && (await rpc.receipt(hash)) === null;
  }
  const supersededFailure = (): FundingVerification => ({ ...invalid('X Layer signed nonce was consumed by another transaction; no purchase principal received'), definitiveFailure: true });

  const adapter: Adapter = {
    rail: 'xlayer', network: NETWORK, paymentHeaderName: 'xlayer-payment',
    acceptedAsset: () => cfg ? { assetId: TOKEN, decimals: TOKEN_DECIMALS, symbol: 'Testnet USD₮0', payTo: cfg.payee, supportsUsdNotional: true } : null,
    readiness: async () => {
      const base = { component: 'xlayer', environment: 'xlayer-testnet', checkedAt: clock.now().toISOString(), missing: parsed.ok ? [] : parsed.missing };
      if (!cfg) return { ...base, status: 'MISSING_CONFIG' };
      try { await rpc.assertNetwork(); await rpc.assertAsset(); return { ...base, status: 'EXTERNAL_CHECK_PASSED', detail: 'Native X Layer Testnet USD₮0 transfer; separate payer signature; independent receipt and Transfer-event readback' }; }
      catch { return { ...base, status: 'ACCESS_BLOCKED', detail: 'Chain id 1952 or USD₮0 metadata failed independent readiness' }; }
    },
    paymentRequirements: input => {
      if (!cfg) throw new Error('X Layer funding unavailable');
      assertRequirement(input, cfg, clock.now());
      return { protocol: PROTOCOL, version: 1, paymentHeader: 'xlayer-payment', requirement: (({ expectedPayer: _expectedPayer, ...publicInput }) => publicInput)(input),
        maxGasBudgetWei: cfg.maxGasBudget.toString(), binding: 'payer_signed_application_candidate', onChainPurchaseCommitment: false };
    },
    prepare: async (header, input) => {
      try {
        if (!cfg) return invalid('X Layer funding unavailable', false);
        assertRequirement(input, cfg, clock.now());
        const c = await readCandidate(header, input, cfg);
        if (input.expectedPayer && c.transfer.payer !== input.expectedPayer.toLowerCase()) return invalid('payer differs from approved wallet', false);
        return { ok: true, transferReference: c.candidate.hash, recoveryPayload: { header } };
      } catch { return invalid('X Layer signed candidate does not bind the exact requirement', false); }
    },
    recover,
    resume: async (hash, input, payload) => {
      // Validate the durable payload again after restart; an operator/database mismatch can never change its payment.
      try {
        if (!cfg || typeof payload.header !== 'string' || Object.keys(payload).length !== 1) return invalid('X Layer recovery payload unavailable');
        const c = await readCandidate(payload.header, input, cfg);
        if (c.candidate.hash !== hash) return invalid('X Layer durable recovery hash mismatch');
        const observed = await recover(hash, input);
        if (observed.ok || observed.code === 'payment_invalid') return observed;
        if (await superseded(c.transfer.payer, c.transfer.nonce, hash)) return supersededFailure();
        if (Date.parse(input.expiresAt) <= clock.now().getTime()) return observed;
        // verify rechecks network, asset, balances, nonce and expiry. It resends only these same signed bytes.
        return adapter.verify(payload.header, input);
      } catch { return pending(); }
    },
    verify: async (header, input) => {
      let c: Awaited<ReturnType<typeof readCandidate>>;
      try {
        if (!cfg) return invalid('X Layer funding unavailable', false);
        assertRequirement(input, cfg, clock.now());
        c = await readCandidate(header, input, cfg);
        if (input.expectedPayer && c.transfer.payer !== input.expectedPayer.toLowerCase()) return invalid('payer differs from approved wallet', false);
      } catch { return invalid('X Layer signed candidate rejected', false); }
      try { await rpc.assertNetwork(); } catch { return invalid('X Layer network identity check failed', false); }
      // An existing (even unconfirmed or reverted) transaction is never submitted again.
      // A read timeout cannot prove absence, so it also retains the candidate without submission.
      try { if (await rpc.transaction(c.candidate.hash)) return recover(c.candidate.hash, input); }
      catch { return pending(); }
      try {
        await rpc.assertAsset();
        assertRequirement(input, cfg, clock.now());
        if (await superseded(c.transfer.payer, c.transfer.nonce, c.candidate.hash)) return supersededFailure();
        // The exact nonce must be next in line: a lower nonce was consumed elsewhere, a higher one would queue behind a gap.
        if (await rpc.transactionCount(c.transfer.payer) !== c.transfer.nonce) throw new Error('nonce not next');
        if (await rpc.tokenBalance(c.transfer.payer) < BigInt(input.amount.amountBaseUnits) || await rpc.nativeBalance(c.transfer.payer) < c.transfer.gasBudget) throw new Error('insufficient balance');
      } catch { return invalid('X Layer pre-submission network, asset, nonce, balance or expiry check failed', false); }
      try { await rpc.sendRaw(c.candidate.rawTransaction); } catch { /* Preserve the candidate on every ambiguous submission. */ }
      for (let attempt = 0; attempt < pollAttempts; attempt++) {
        const observed = await recover(c.candidate.hash, input);
        if (observed.ok || observed.code === 'payment_invalid') return observed;
        if (attempt < pollAttempts - 1) await sleep(pollIntervalMs);
      }
      return pending();
    },
  };
  return adapter;
}
