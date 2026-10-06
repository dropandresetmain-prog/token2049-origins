import { z } from 'zod';
import { SourceOffer, SandboxExecution } from '../contracts/provenance.js';
import type { Db } from '../infrastructure/db.js';
import { Money } from '../contracts/money.js';
import { HumanProgress, projectProgress, maskAddress } from '../contracts/presentation.js';
import { FundingOption, type QuoteView } from '../contracts/commerce.js';
import { buildPurchaseView } from '../core/views.js';
import { getQuoteRow, type PurchaseRow, type FundingEvidenceRow } from '../core/store.js';
import { redactString } from '../infrastructure/redact.js';

export const PurchaseProof = z.object({
  sourceOffer: SourceOffer.optional(), sandboxExecution: SandboxExecution.optional(),
  purchaseId: z.string(), quoteId: z.string(), summary: z.string(), commercialAmount: Money,
  progress: HumanProgress,
  timeline: z.array(z.object({ step: z.enum(['requested', 'quote_confirmed', 'approved', 'funded', 'merchant_execution', 'result_verified']),
    label: z.string(), status: z.enum(['complete', 'current', 'pending', 'attention']), timestamp: z.string().nullable(),
    text: z.string(), evidenceRef: z.string().nullable(),
  }).strict()),
  funding: z.object({ requirement: FundingOption, confirmationStatus: z.string(), applied: z.boolean(),
    sources: z.array(z.object({ displayAddress: z.string(), evidenceRef: z.string() }).strict()),
    transfers: z.array(z.object({ reference: z.string(), confirmationStatus: z.string(), application: z.string(), evidenceMode: z.string(), verifiedAt: z.string() }).strict()),
  }).strict(),
  merchant: z.object({ provider: z.string(), environment: z.string(), result: z.string(), paymentStatus: z.string(), providerReference: z.string().nullable(), evidenceMode: z.string().nullable() }).strict(),
  receipt: z.object({ receiptId: z.string(), finalResult: z.string(), issuedAt: z.string(), limitations: z.array(z.string()), evidenceRefs: z.array(z.string()) }).strict().nullable(),
  technicalEvidencePath: z.string(),
}).strict();
export type PurchaseProof = z.infer<typeof PurchaseProof>;

/** Payer formats a proof may display, per rail. Anything else (including Masumi remuneration) shows no source. */
const PAYER_FORMAT: Record<string, RegExp> = { cardano: /^addr_test1[0-9a-z]{10,200}$/, solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ };

/** Curated projection of durable facts. No provider prose, PII, checkpoints, bank data or journal internals. */
export async function purchaseProof(db: Db, p: PurchaseRow): Promise<PurchaseProof> {
  const q = (await getQuoteRow(db, p.quote_id))!;
  const qv = JSON.parse(q.public_json) as QuoteView;
  const purchase = await buildPurchaseView(db, p, '');
  const progress = projectProgress(purchase);
  const events = await db.all<{ id: string; type: string; created_at: string }>('SELECT id, type, created_at FROM purchase_events WHERE purchase_id = $1 ORDER BY sequence', p.id);
  const funding = await db.all<FundingEvidenceRow>('SELECT * FROM funding_evidence WHERE purchase_id = $1 ORDER BY verified_at, id', p.id);
  const requested = await db.get<{ created_at: string }>('SELECT created_at FROM offers WHERE id = $1 AND customer_id = $2', q.offer_id, p.customer_id);
  const approval = events.find(e => e.type === 'approval.recorded');
  const funded = events.find(e => e.type === 'funding.confirmed');
  const execution = events.find(e => e.type === 'execution.started');
  const result = events.findLast(e => ['execution.succeeded', 'execution.failed_definite', 'execution.terms_changed'].includes(e.type));
  const applied = funding.some(f => f.application === 'applied' && f.payment_state === 'confirmed');
  const verified = !!result && progress.outcomeFinal;
  const step = (key: PurchaseProof['timeline'][number]['step'], label: string, done: boolean, timestamp: string | null, text: string, ref: string | null, current = false) => ({
    step: key, label, status: done ? 'complete' as const : current ? progress.stage === 'needs_attention' ? 'attention' as const : 'current' as const : 'pending' as const,
    timestamp: done || current ? timestamp : null, text, evidenceRef: done || current ? ref : null,
  });
  return PurchaseProof.parse({
    ...(qv.sourceOffer ? { sourceOffer: qv.sourceOffer } : {}),
    ...(qv.sandboxRepresentation ? { sandboxExecution: { ...qv.sandboxRepresentation, quotedTotal: qv.merchantTotal, orderReference: p.provider_reference, paymentStatus: p.merchant_payment_status, evidenceMode: purchase.receipt?.evidenceMode ?? null } } : {}),
    purchaseId: p.id, quoteId: q.id, summary: `${q.category} purchase via ${q.route}`, commercialAmount: qv.payablePrincipal, progress,
    timeline: [
      step('requested', 'Requested', !!requested, requested?.created_at ?? null, 'Purchase request received.', null),
      step('quote_confirmed', 'Quote confirmed', true, q.created_at, 'Exact commercial terms frozen in the quote.', q.id),
      step('approved', 'Approved', !!approval, approval?.created_at ?? null, approval ? 'Channel submitted approval of the exact quote and selected funding option.' : 'No explicit approval event is available for this legacy purchase.', approval?.id ?? null),
      step('funded', 'Funded', applied && !!funded, funded?.created_at ?? null, applied ? funding.some(f => f.evidence_mode === 'local_fixture') ? 'SIMULATED / LOCAL FIXTURE funding applied; no externally confirmed chain transaction is proved.' : 'Payment confirmed and applied to this purchase.' : 'Awaiting confirmation of payment for this purchase.', funded?.id ?? null, !applied),
      step('merchant_execution', 'Merchant execution', !!execution && verified, execution?.created_at ?? null, execution ? 'Merchant execution started; completion depends on the verified result.' : 'Merchant execution has not started.', execution?.id ?? null, applied && !verified),
      step('result_verified', 'Result verified', verified && progress.stage === 'complete', result?.created_at ?? null, verified ? progress.message : 'A final merchant result is not yet verified.', result?.id ?? null, verified && progress.stage !== 'complete'),
    ],
    funding: {
      requirement: purchase.fundingRequirement!, confirmationStatus: purchase.paymentState, applied,
      sources: funding.flatMap(f => PAYER_FORMAT[f.rail]?.test(f.payer) ? [{ displayAddress: maskAddress(f.payer), evidenceRef: f.id }] : []),
      transfers: funding.map(f => ({ reference: redactString(f.transfer_reference), confirmationStatus: f.payment_state,
        application: f.application, evidenceMode: f.evidence_mode, verifiedAt: f.verified_at })),
    },
    merchant: { provider: q.route, environment: q.provider_environment, result: p.commerce_status, paymentStatus: p.merchant_payment_status,
      providerReference: p.provider_reference ? redactString(p.provider_reference) : null, evidenceMode: purchase.receipt?.evidenceMode ?? null },
    receipt: purchase.receipt ? { receiptId: purchase.receipt.receiptId, finalResult: progress.label, issuedAt: purchase.receipt.issuedAt,
      limitations: purchase.receipt.limitations.map(redactString), evidenceRefs: purchase.receipt.evidenceRefs.map(redactString) } : null,
    technicalEvidencePath: `/v1/evidence/purchases/${encodeURIComponent(p.id)}`,
  });
}
