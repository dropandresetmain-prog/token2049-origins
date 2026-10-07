import type { Db } from '../infrastructure/db.js';
import { PaymentAttempt } from '../contracts/commerce.js';

export async function paymentAttempt(db: Db, purchaseId: string) {
  const row = await db.get<{ attempt_id: string; status: string; retry_safe: boolean; error_code: string | null; updated_at: string }>(
    'SELECT * FROM payment_handoffs WHERE purchase_id = $1', purchaseId);
  return row ? PaymentAttempt.parse({ attemptId: row.attempt_id, status: row.status, retrySafe: row.retry_safe, errorCode: row.error_code, updatedAt: row.updated_at }) : undefined;
}
