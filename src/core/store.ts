import type { Db } from '../infrastructure/db.js';
import { newId } from '../infrastructure/ids.js';
import { redact } from '../infrastructure/redact.js';
import type { Money } from '../contracts/money.js';

export interface PurchaseRow {
  id: string;
  customer_id: string;
  quote_id: string;
  channel: string;
  state: string;
  payment_state: string;
  commerce_status: string;
  merchant_payment_status: string;
  funding_rail: string;
  funding_requirement_json: string;
  approval_json: string;
  provider_reference: string | null;
  receipt_json: string | null;
  status_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteRow {
  id: string;
  version: number;
  supersedes_quote_id: string | null;
  customer_id: string;
  offer_id: string;
  category: string;
  route: string;
  provider_environment: string;
  public_json: string;
  fulfillment_json: string;
  execution_ref_json: string;
  digest: string;
  expires_at: string;
  created_at: string;
}

export interface ReservationRow {
  id: string;
  purchase_id: string;
  currency: string;
  scale: number;
  amount_minor: string;
  status: 'active' | 'consumed' | 'released' | 'held_unresolved';
  expires_at: string | null;
}

export interface FundingEvidenceRow {
  id: string;
  purchase_id: string | null;
  rail: string;
  network: string;
  asset_id: string;
  decimals: number;
  amount_base_units: string;
  payer: string;
  payee: string;
  transfer_reference: string;
  payment_state: string;
  confirmations: number | null;
  purpose: string;
  application: 'applied' | 'unapplied' | 'pending_confirmation';
  evidence_mode: string;
  observed_at: string;
  verified_at: string;
  details_json: string;
}

export interface AttemptRow {
  id: string;
  purchase_id: string;
  attempt_no: number;
  idempotency_key: string;
  status: 'started' | 'succeeded' | 'failed_definite' | 'terms_changed' | 'unknown';
  provider_reference: string | null;
  checkpoints_json: string;
  result_json: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface FundingRequirementRecord {
  /** Frozen x402 resource identity; optional only for pre-recovery-schema records. */
  resourceUrl?: string;
  rail: string;
  network: string;
  assetId: string;
  decimals: number;
  symbol?: string;
  amountBaseUnits: string;
  payTo: string;
  expiresAt: string;
  quoteDigest: string;
  valuation: Record<string, unknown>;
}

export async function appendEvent(db: Db, purchaseId: string, type: string, data: Record<string, unknown>, nowIso: string): Promise<void> {
  return db.tx(async () => {
    const row = await db.get<{ s: number | null }>('SELECT MAX(sequence) AS s FROM purchase_events WHERE purchase_id = $1', purchaseId);
    const seq = (row?.s ?? 0) + 1;
    await db.run(
      'INSERT INTO purchase_events(id, purchase_id, sequence, type, data_json, created_at) VALUES ($1,$2,$3,$4,$5,$6)',
      newId('evt'),
      purchaseId,
      seq,
      type,
      JSON.stringify(redact(data)),
      nowIso,
    );
  });
}

export async function getPurchaseRow(db: Db, id: string): Promise<PurchaseRow | undefined> {
  return await db.get<PurchaseRow>('SELECT * FROM purchases WHERE id = $1', id);
}

export async function getQuoteRow(db: Db, id: string): Promise<QuoteRow | undefined> {
  return await db.get<QuoteRow>('SELECT * FROM quotes WHERE id = $1', id);
}

export async function getReservation(db: Db, purchaseId: string): Promise<ReservationRow | undefined> {
  return await db.get<ReservationRow>('SELECT * FROM reservations WHERE purchase_id = $1', purchaseId);
}

export async function setReservationStatus(
  db: Db,
  purchaseId: string,
  from: ReservationRow['status'][],
  to: ReservationRow['status'],
  nowIso: string,
): Promise<boolean> {
  const placeholders = from.map((_, index) => `$${index + 4}`).join(',');
  const r = await db.run(
    `UPDATE reservations SET status = $1, updated_at = $2 WHERE purchase_id = $3 AND status IN (${placeholders})`,
    to,
    nowIso,
    purchaseId,
    ...from,
  );
  return r.changes === 1;
}

/** Compare-and-set purchase state transition. Returns false if the purchase was not in an expected state. */
export async function transitionPurchase(
  db: Db,
  id: string,
  from: string[],
  patch: Partial<Pick<PurchaseRow, 'state' | 'payment_state' | 'commerce_status' | 'merchant_payment_status' | 'provider_reference' | 'receipt_json' | 'status_reason'>>,
  nowIso: string,
): Promise<boolean> {
  const sets: string[] = [];
  const vals: (string | null)[] = [];
  for (const [k, v] of Object.entries(patch)) {
    sets.push(`${k} = $${vals.length + 1}`);
    vals.push(v as string | null);
  }
  sets.push(`updated_at = $${vals.length + 1}`);
  vals.push(nowIso);
  const placeholders = from.map((_, index) => `$${vals.length + index + 2}`).join(',');
  const r = await db.run(`UPDATE purchases SET ${sets.join(', ')} WHERE id = $${vals.length + 1} AND state IN (${placeholders})`, ...vals, id, ...from);
  return r.changes === 1;
}

export function moneyOf(currency: string, scale: number, amountMinor: string | bigint): Money {
  return { currency, scale, amountMinor: amountMinor.toString() };
}
