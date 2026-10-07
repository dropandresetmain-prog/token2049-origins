import { createHash } from 'node:crypto';
import { address } from '@solana/kit';
import { toFacilitatorSvmSigner, type FacilitatorSvmSigner } from '@x402/svm';
import { ExactSvmScheme } from '@x402/svm/exact/facilitator';
import { decodePaymentSignatureHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentPayload } from '@x402/core/types';
import { NETWORK, decodeTransaction } from '../../src/funding/solana/wire.js';
import { SolanaRpc } from '../../src/funding/solana/rpc.js';
import { loadSigner } from './signer.js';
import { validatePayment } from './policy.js';
import type { SolanaPayerConfig } from './config.js';
import type { SolanaLedgerPort } from './ledger-port.js';

/** Internal sponsor only. It has no HTTP surface and cannot accept a caller-supplied transfer. */
export async function createHostedSponsor(cfg: SolanaPayerConfig, ledger: SolanaLedgerPort, opts: { rpc?: SolanaRpc; signer?: FacilitatorSvmSigner; wait?: (ms: number) => Promise<void> } = {}) {
  const rpc = opts.rpc ?? new SolanaRpc(cfg.rpcUrl);
  const signer = opts.signer ?? toFacilitatorSvmSigner(await loadSigner(cfg.sponsorKeyFile, cfg.sponsor), { defaultRpcUrl: cfg.rpcUrl });
  const scheme = new ExactSvmScheme(signer, undefined, { maxComputeUnits: 20000, maxPriorityFeeMicroLamports: 1, maxRequiredSignatures: 2 });
  return {
    prepare: async (payload: PaymentPayload): Promise<{ header: string; signature: string }> => ledger.exclusive(async () => {
      await ledger.assertAllowed?.(String((payload.accepted.extra?.funding as { purchaseId?: unknown } | undefined)?.purchaseId ?? ''));
      validatePayment(payload, payload.accepted, cfg);
      const raw = (payload.payload as { transaction: string }).transaction;
      const transfer = decodeTransaction(raw, false);
      const id = createHash('sha256').update(transfer.message).digest('hex');
      await ledger.assertAllowed?.(id, createHash('sha256').update(raw).digest('hex'));
      const existing = (await ledger.read()).find(e => e.id === id);
      if (existing?.header && existing.signature) return { header: existing.header, signature: existing.signature };
      if (existing) throw new Error('incomplete sponsor reservation requires reconciliation');
      await rpc.assertNetwork();
      const check = await scheme.verify(payload, payload.accepted);
      if (!check.isValid) throw new Error('Solana sponsor verification rejected');
      await ledger.reconcile(rpc);
      const fee = await rpc.call<{ value: number | null }>('getFeeForMessage', [Buffer.from(transfer.message).toString('base64'), { commitment: 'confirmed' }]);
      if (fee.value === null || !Number.isSafeInteger(fee.value) || fee.value < 0 || fee.value > 10001) throw new Error('Solana sponsor fee outside cap');
      await ledger.assertCaps(0n, BigInt(fee.value), cfg.maxTotal, cfg.maxFees);
      const reservation = { id, signature: null, amount: '0', fee: String(fee.value), header: null, createdAt: new Date().toISOString() };
      await ledger.upsert(reservation);
      // Revalidate after every awaited prerequisite, immediately before granting signing authority.
      validatePayment(payload, payload.accepted, cfg);
      const signed = await signer.signTransaction(raw, address(cfg.sponsor), NETWORK);
      const signature = decodeTransaction(signed).signature!;
      const header = encodePaymentSignatureHeader({ ...payload, payload: { transaction: signed } });
      validatePayment(decodePaymentSignatureHeader(header), payload.accepted, cfg, true);
      await ledger.upsert({ ...reservation, signature, header });
      return { header, signature };
    }),
    broadcast: async (payload: PaymentPayload): Promise<void> => ledger.exclusive(async () => {
      const raw = (payload.payload as { transaction: string }).transaction;
      const transfer = decodeTransaction(raw);
      await ledger.assertAllowed?.(String((payload.accepted.extra?.funding as { purchaseId?: unknown } | undefined)?.purchaseId ?? ''), createHash('sha256').update(transfer.message).digest('hex'), createHash('sha256').update(raw).digest('hex'), transfer.signature ?? '');
      const entry = (await ledger.read()).find(e => e.signature === transfer.signature);
      if (!entry?.header || encodePaymentSignatureHeader(payload) !== entry.header) throw new Error('Solana broadcast candidate not durably bound');
      await rpc.assertNetwork();
      const status = async () => (await rpc.call<{ value: Array<{ err: unknown; confirmationStatus: string } | null> }>('getSignatureStatuses', [[transfer.signature], { searchTransactionHistory: true }])).value[0];
      let observed = await status();
      if (observed?.err) throw new Error('Solana retained transaction failed');
      if (!observed) {
        validatePayment(payload, payload.accepted, cfg, true);
        await Promise.all([rpc.assertMint(cfg.mint), rpc.assertToken(cfg.source, cfg.mint, cfg.payer), rpc.assertToken(cfg.tokenAccount, cfg.mint, cfg.payee)]);
        const check = await scheme.verify(payload, payload.accepted);
        if (!check.isValid) throw new Error('Solana signed candidate verification rejected');
        validatePayment(payload, payload.accepted, cfg, true);
        // Broadcast the persisted bytes directly: SDK settlement may sign again; this path never does.
        const reference = await rpc.call<string>('sendTransaction', [raw, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 }]);
        if (reference !== transfer.signature) throw new Error('Solana RPC reference mismatch');
      }
      for (let attempt = 0; attempt < 12; attempt++) {
        if (observed?.err) throw new Error('Solana retained transaction failed');
        if (observed?.confirmationStatus === 'finalized') return;
        await (opts.wait ?? ((ms) => new Promise<void>(resolve => setTimeout(resolve, ms))))(1000);
        observed = await status();
      }
      throw new Error('Solana finality pending; retained candidate requires independent recovery');
    }),
  };
}
