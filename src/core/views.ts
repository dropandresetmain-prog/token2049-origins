import type { Db } from '../infrastructure/db.js';
import { paymentAttempt } from './handoffs.js';
import type { PurchaseView, QuoteView, FundingSummary, ReceiptView } from '../contracts/commerce.js';
import { getQuoteRow, getReservation, type PurchaseRow, type FundingEvidenceRow, type FundingRequirementRecord } from './store.js';

export function fundingRequirementView(req: FundingRequirementRecord): import('../contracts/commerce.js').FundingOption {
  return { rail: req.rail as import('../contracts/common.js').FundingRail,
    ...(req.fundingOptionId ? { fundingOptionId: req.fundingOptionId } : {}),
    amount: { network: req.network, assetId: req.assetId, decimals: req.decimals, amountBaseUnits: req.amountBaseUnits,
      ...(req.symbol ? { symbol: req.symbol } : {}) }, payTo: req.payTo,
    ...(req.settlement ? { settlement: req.settlement } : {}),
    ...(req.valuation ? { valuation: req.valuation as import('../contracts/commerce.js').FundingOption['valuation'] } : {}),
  };
}

export async function fundingSummaries(db: Db, purchaseId: string): Promise<FundingSummary[]> {
  return (await db
    .all<FundingEvidenceRow>('SELECT * FROM funding_evidence WHERE purchase_id = $1 ORDER BY verified_at, id', purchaseId))
    .map((f) => ({
      rail: f.rail as FundingSummary['rail'],
      network: f.network,
      asset: f.asset_id,
      amountBaseUnits: f.amount_base_units,
      decimals: f.decimals,
      transferReference: f.transfer_reference,
      paymentState: f.payment_state as FundingSummary['paymentState'],
      purpose: f.purpose as FundingSummary['purpose'],
      verifiedAt: f.verified_at,
      evidenceMode: f.evidence_mode as FundingSummary['evidenceMode'],
    }));
}

export async function buildPurchaseView(db: Db, p: PurchaseRow, publicBaseUrl: string, now = Date.now()): Promise<PurchaseView> {
  const q = (await getQuoteRow(db, p.quote_id))!;
  const qv = JSON.parse(q.public_json) as QuoteView;
  const req = JSON.parse(p.funding_requirement_json) as FundingRequirementRecord;
  const res = await getReservation(db, p.id);
  const awaiting = p.state === 'awaiting_funding' && p.payment_state === 'not_received';
  const handoff = await paymentAttempt(db, p.id);
  if (handoff?.status === 'running' && now - Date.parse(handoff.updatedAt) > 10 * 60_000) handoff.reviewRequired = true;
  const manual = await db.get("SELECT id FROM purchase_events WHERE purchase_id = $1 AND type IN ('reconciliation.manual_required','funding.manual_required','outcome.manual_required') LIMIT 1", p.id);
  return {
    purchaseId: p.id,
    customerId: p.customer_id,
    quoteId: p.quote_id,
    quoteVersion: q.version,
    category: qv.category,
    route: qv.route,
    state: p.state as PurchaseView['state'],
    paymentState: p.payment_state as PurchaseView['paymentState'],
    commerceStatus: p.commerce_status as PurchaseView['commerceStatus'],
    merchantPaymentStatus: p.merchant_payment_status as PurchaseView['merchantPaymentStatus'],
    payablePrincipal: qv.payablePrincipal,
    fundingRequirement: fundingRequirementView(req),
    fundingInstructions: awaiting
      ? {
          fundUrl: `${publicBaseUrl}/v1/purchases/${p.id}/fund`,
          protocol: 'x402',
          options: [fundingRequirementView(req)],
          expiresAt: req.expiresAt,
          note: 'POST the fund URL without a payment header to receive the x402 challenge; pay with a bounded payer client. No merchant spend occurs until funding is independently verified and confirmed.',
        }
      : null,
    funding: (await fundingSummaries(db, p.id)),
    reservation: res
      ? { status: res.status, amount: { currency: res.currency, scale: res.scale, amountMinor: res.amount_minor } }
      : null,
    providerReference: p.provider_reference,
    receipt: p.receipt_json ? (JSON.parse(p.receipt_json) as ReceiptView) : null,
    statusReason: p.status_reason,
    ...(handoff ? { paymentAttempt: handoff } : {}),
    ...(manual && ['awaiting_funding', 'executing', 'unresolved', 'succeeded'].includes(p.state) && !(p.state === 'succeeded' && p.commerce_status !== 'ticketing') ? { operatorAttention: true } : {}),
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  };
}
