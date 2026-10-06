/**
 * The console's data boundary. Screens never call fetch; they ask a ConsoleSource.
 *
 * Two implementations exist:
 * - the sample source (web/src/source/sample.ts): local sample purchases, used until the gateway is wired;
 * - the gateway source (web/src/source/gateway.ts): authenticated reads from the gateway HTTP API.
 *
 * Both return the gateway's own contract shapes (PurchaseView, QuoteView, PurchaseProof, ...), validated
 * with the same schemas. Turning the console "live" means switching the source, not rewriting screens.
 * The console is read-only: it never creates, approves or pays for a purchase.
 */
import type { PurchaseView, QuoteView, ErrorCode } from './backend.js';
import type { EvidenceDetail, EvidenceListItem, PurchaseProof } from './evidence.js';
import type { PurchaseContext } from './proposed.js';

export type ConsoleMode = 'sample' | 'test' | 'live';

export interface ConsoleEnvironment {
  /** sample: local sample data. test: a gateway in sandbox/testnet. live: a production gateway. */
  mode: ConsoleMode;
}

export interface PurchaseListEntry {
  item: EvidenceListItem;
  context: PurchaseContext;
}

export interface PurchaseListResult {
  entries: PurchaseListEntry[];
  /** The gateway returns at most this many purchases (newest first). */
  limit: number;
}

export interface PurchaseBundle {
  /** GET /v1/purchases/:id (purchases:read). Always present. */
  purchase: PurchaseView;
  /** GET /v1/quotes/:quoteId. Null when the access key lacks the scope (see gap G5). */
  quote: QuoteView | null;
  /** GET /v1/evidence/purchases/:id/proof (evidence:read). Null when not permitted. */
  proof: PurchaseProof | null;
  /** GET /v1/evidence/purchases/:id (evidence:read), the parts the console reads. */
  evidence: EvidenceDetail | null;
  /** The same evidence response, untouched, for the "Technical details" disclosure. */
  technicalRecord: unknown;
  context: PurchaseContext;
}

export interface ConsoleSource {
  readonly kind: 'sample' | 'gateway';
  environment(): Promise<ConsoleEnvironment>;
  listPurchases(): Promise<PurchaseListResult>;
  getPurchase(purchaseId: string): Promise<PurchaseBundle>;
}

/** Every source failure surfaces as this. `code` follows the gateway ErrorCode, plus transport failures. */
export class ConsoleError extends Error {
  constructor(
    readonly code: ErrorCode | 'network' | 'invalid_response',
    message: string,
    readonly requestId?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ConsoleError';
  }
}
