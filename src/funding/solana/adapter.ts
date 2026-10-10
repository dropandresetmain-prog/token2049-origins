import { type HTTPFacilitatorClient, encodePaymentResponseHeader } from '@x402/core/http';
import type { PaymentRequirements } from '@x402/core/types';
import type { FundingAdapter, FundingRequirementInput, FundingVerification, FundingPreparation } from '../../contracts/ports.js';
import { systemClock, type Clock } from '../../infrastructure/clock.js';
import { parseSolanaConfig } from './config.js';
import { createSolanaFacilitatorClient } from './facilitator.js';
import { NETWORK, commitment, readHeader, assertTransfer, decodeTransaction } from './wire.js';
import { SolanaRpc, type ChainTransaction } from './rpc.js';
export interface SolanaAdapterOptions { clock?: Clock; fetchImpl?: typeof fetch; facilitator?: Pick<HTTPFacilitatorClient,'verify'|'settle'|'getSupported'>; }
const invalid = (reason: string, settlementAttempted?: boolean): Extract<FundingVerification,{ok:false}> => ({ ok: false, code: 'payment_invalid', reason, ...(settlementAttempted === undefined ? {} : { settlementAttempted }) });
export function createSolanaFundingAdapter(env: NodeJS.ProcessEnv, opts: SolanaAdapterOptions = {}): Omit<FundingAdapter, 'prepare' | 'recover'> & {
  prepare(paymentHeaderValue: string, input: FundingRequirementInput): FundingPreparation;
  recover(transferReference: string, input: FundingRequirementInput): Promise<FundingVerification>;
} {
  const parsed = parseSolanaConfig(env), clock = opts.clock ?? systemClock;
  const cfg = parsed.ok ? parsed.config : null;
  const rpc = cfg ? new SolanaRpc(cfg.rpcUrl, opts.fetchImpl) : null;
  const facilitator = cfg ? opts.facilitator ?? createSolanaFacilitatorClient(cfg, opts.fetchImpl) : null;
  function requirement(input: FundingRequirementInput, allowExpired = false): PaymentRequirements {
    if (!cfg || input.amount.network !== NETWORK || input.amount.assetId !== cfg.mint || input.amount.decimals !== 6 || input.payTo !== cfg.payee ||
        !/^[1-9][0-9]*$/.test(input.amount.amountBaseUnits) || BigInt(input.amount.amountBaseUnits) > cfg.maxAmount ||
        (!allowExpired && Date.parse(input.expiresAt) <= clock.now().getTime())) throw new Error('Solana requirement unavailable, expired or outside policy');
    const memo = commitment(input, cfg.tokenAccount);
    return { scheme: 'exact', network: NETWORK, asset: cfg.mint, amount: input.amount.amountBaseUnits, payTo: cfg.payee,
      maxTimeoutSeconds: 60, extra: { feePayer: cfg.sponsor, memo, tokenAccount: cfg.tokenAccount,
        preparation: cfg.settlementMode === 'payer_broadcast' ? { mode: 'payer_broadcast', requiresFullySignedTransaction: true } : {url:cfg.facilitatorUrl+'/prepare',method:'POST',authentication:'Bearer',requiresFullySignedTransaction:true},
        funding: { purchaseId: input.purchaseId, quoteId: input.quoteId, quoteDigest: input.quoteDigest, resourceUrl: input.resourceUrl, expiresAt: input.expiresAt, ...(input.settlement ? { settlement: input.settlement } : {}) } } };
  }
  async function recover(signature: string, input: FundingRequirementInput): Promise<FundingVerification> {
    try {
      const req = requirement(input, true);
      if (!rpc || !cfg || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(signature)) return invalid('invalid Solana candidate');
      await rpc.assertNetwork();
      const tx = await rpc.call<ChainTransaction | null>('getTransaction', [signature, { commitment: 'finalized', encoding: 'base64', maxSupportedTransactionVersion: 0 }]);
      if (!tx) return { ok: false, code: 'payment_required', reason: 'Solana transaction is not independently finalized' };
      if (!tx.meta || tx.meta.err || tx.transaction[1] !== 'base64' || !Number.isSafeInteger(tx.meta.fee) || tx.meta.fee > 10001 ||
          tx.meta.innerInstructions?.some(i => i.instructions.length)) return invalid('Solana on-chain execution failed or exceeded policy');
      const transfer = decodeTransaction(tx.transaction[0]); assertTransfer(transfer, req);
      if (transfer.signature !== signature) return invalid('Solana chain signature mismatch');
      // The memo commits expiry. Late settlement is still a received liability; the core forbids expired commerce and records its refundable balance.
      if (tx.blockTime === null || !Number.isSafeInteger(tx.blockTime)) return invalid('Solana block time unavailable');
      // Historical token balances survive later ATA closure; current account snapshots belong only to readiness/pre-send.
      const sourceIndex=transfer.accounts.indexOf(transfer.source),sourceBefore=tx.meta.preTokenBalances.filter(b=>b.accountIndex===sourceIndex),sourceAfter=tx.meta.postTokenBalances.filter(b=>b.accountIndex===sourceIndex);
      if(sourceBefore.length!==1||sourceAfter.length!==1||[...sourceBefore,...sourceAfter].some(b=>b.mint!==cfg.mint||b.owner!==transfer.payer||b.uiTokenAmount.decimals!==6||!/^[0-9]+$/.test(b.uiTokenAmount.amount))||BigInt(sourceBefore[0]!.uiTokenAmount.amount)-BigInt(sourceAfter[0]!.uiTokenAmount.amount)!==BigInt(req.amount))return invalid('Solana historical source debit mismatch');
      const accountIndex = transfer.accounts.indexOf(cfg.tokenAccount);
      const before = tx.meta.preTokenBalances.filter(b => b.accountIndex === accountIndex);
      const after = tx.meta.postTokenBalances.filter(b => b.accountIndex === accountIndex);
      if (before.length !== 1 || after.length !== 1 || [...before, ...after].some(b => b.mint !== cfg.mint || b.owner !== cfg.payee || b.uiTokenAmount.decimals !== 6 || !/^[0-9]+$/.test(b.uiTokenAmount.amount)) ||
          BigInt(after[0]!.uiTokenAmount.amount) - BigInt(before[0]!.uiTokenAmount.amount) !== BigInt(req.amount)) return invalid('Solana exact destination balance change mismatch');
      return { ok: true, funding: { rail: 'solana', network: NETWORK, assetId: cfg.mint, decimals: 6, amountBaseUnits: req.amount, payer: transfer.payer,
        payee: cfg.payee, transferReference: signature, paymentState: 'confirmed', confirmations: null, purpose: input.settlement && BigInt(input.settlement.feeBaseUnits) > 0n ? 'principal_and_fee' : 'purchase_principal',
        evidenceMode: 'fresh_external', observedAt: clock.now().toISOString(), settlementResponseHeader: { name: 'PAYMENT-RESPONSE', value: encodePaymentResponseHeader({ success: true, transaction: signature, network: NETWORK, payer: transfer.payer }) },
        details: { source: 'solana_devnet_rpc', commitment: 'finalized', slot: tx.slot, blockTime: tx.blockTime, feeLamports: tx.meta.fee,
          memo: transfer.memo, tokenAccount: cfg.tokenAccount, tokenProgram: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          receivedAfterExpiry: tx.blockTime * 1000 > Date.parse(input.expiresAt), quoteDigest: input.quoteDigest } } };
    } catch { return invalid('Solana chain verification unavailable or mismatched'); }
  }
  return {
    rail: 'solana', network: NETWORK, paymentHeaderName: 'payment-signature',
    acceptedAsset: () => cfg ? { assetId: cfg.mint, decimals: 6, symbol: 'Devnet test USDC', payTo: cfg.payee, supportsUsdNotional: true } : null,
    readiness: async () => {
      const base = { component: 'solana', environment: 'solana-devnet', checkedAt: clock.now().toISOString(), missing: parsed.ok ? [] : parsed.missing };
      if (!cfg || !rpc) return { ...base, status: 'MISSING_CONFIG' };
      try { await rpc.assertNetwork(); await Promise.all([rpc.assertMint(cfg.mint), rpc.assertToken(cfg.tokenAccount, cfg.mint, cfg.payee)]); if (cfg.settlementMode === 'payer_broadcast') return { ...base, status: 'EXTERNAL_CHECK_PASSED', detail: 'Hosted payer broadcasts Devnet funding; the gateway independently verifies finalized exact transfers' }; const supported = await facilitator!.getSupported();
        if (!supported.kinds.some(k => k.x402Version === 2 && k.scheme === 'exact' && k.network === NETWORK && k.extra?.feePayer === cfg.sponsor)) throw new Error('facilitator mismatch');
        return { ...base, status: 'EXTERNAL_CHECK_PASSED', detail: 'Official x402 v2 exact Solana; the provided payer must call authenticated /prepare before submitting the fully signed PAYMENT-SIGNATURE' };
      } catch { return { ...base, status: 'ACCESS_BLOCKED', detail: 'Devnet RPC, accounts or facilitator failed independent readiness' }; }
    },
    paymentRequirements: input => ({ x402Version: 2, resource: { url: input.resourceUrl, description: input.description, mimeType: 'application/json' }, accepts: [requirement(input)] }),
    prepare: (header, input): FundingPreparation => { try { const r = requirement(input), p = readHeader(header, r, input.resourceUrl); assertTransfer(p.transfer, r); if (!p.transfer.signature) return invalid('sponsor signature required'); if (input.expectedPayer && p.transfer.payer !== input.expectedPayer) return invalid('payer differs from approved wallet', false); return { ok: true, transferReference: p.transfer.signature }; } catch { return invalid('Solana signed payment does not bind requirement'); } },
    recover,
    verify: async (header, input) => {
      let p: ReturnType<typeof readHeader>, req: PaymentRequirements;
      try { req = requirement(input); p = readHeader(header, req, input.resourceUrl); assertTransfer(p.transfer, req); if (input.expectedPayer && p.transfer.payer !== input.expectedPayer) return invalid('payer differs from approved wallet', false); } catch { return invalid('Solana payment requirement mismatch', false); }
      const reference = p.transfer.signature!;
      const existing = await recover(reference, input); if (existing.ok) return existing;
      if (cfg!.settlementMode === 'payer_broadcast') return { ok: false, code: 'payment_required', reason: 'Hosted Solana candidate retained for independent finality recovery', settlementAttempted: true };
      try {
        await rpc!.assertNetwork();
        const v = await facilitator!.verify(p.payload, req);
        if (!v.isValid) return invalid('Solana facilitator rejected transaction', false);
      } catch { return invalid('Solana facilitator verification unavailable', false); }
      try { requirement(input); } catch { return invalid('Solana quote expired before settlement',false); }
      try { const settled = await facilitator!.settle(p.payload, req); if (settled.transaction && settled.transaction !== reference) return invalid('Solana facilitator reference mismatch'); } catch { /* The persisted candidate remains authoritative even after response loss. */ }
      const observed = await recover(reference, input);
      return observed.ok ? observed : { ok: false, code: 'payment_required', reason: 'Solana settlement outcome retained for independent recovery', settlementAttempted: true };
    },
  };
}
