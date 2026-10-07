import { z } from 'zod';
import { PurchaseIntent, Fulfillment } from './intent.js';
import { PurchaseIntentDraft, FulfillmentDraft } from './input.js';
import { OfferView, QuoteView, PurchaseView, PurchaseEventView, Approval } from './commerce.js';
import { CONTRACT_VERSION, FundingRail, OfferId, QuoteId, Readiness } from './common.js';

/** Canonical HTTP surface, v1. MCP tools map 1:1 onto these operations. */
export const API_PREFIX = `/${CONTRACT_VERSION}` as const;

export const SearchOffersRequest = z.object({ intent: PurchaseIntent }).strict();
export const SearchOffersResponse = z.object({ offers: z.array(OfferView) }).strict();

export const CreateQuoteRequest = z.object({ offerId: OfferId, fulfillment: Fulfillment }).strict();
export const CreateQuoteResponse = z.object({ quote: QuoteView }).strict();
export const SearchOffersDraftRequest = z.object({ intent: PurchaseIntentDraft }).strict();
export const CreateQuoteDraftRequest = z.object({ offerId: OfferId, fulfillment: FulfillmentDraft }).strict();

/** Requires `Idempotency-Key` header. Creates the purchase and returns funding instructions; no merchant spend. */
export const CreatePurchaseRequest = z
  .object({ quoteId: QuoteId, approval: Approval })
  .strict();
export const PurchaseResponse = z.object({ purchase: PurchaseView }).strict();

export const PurchaseEventsResponse = z.object({ events: z.array(PurchaseEventView) }).strict();

export const CompletePaymentAttempt = z.object({
  attemptId: z.string().regex(/^pat_[0-9A-Za-z]{10,40}$/),
  status: z.enum(['succeeded', 'failed']),
  retrySafe: z.boolean(),
  errorCode: z.string().regex(/^[a-z_]{3,40}$/).nullable(),
}).strict().refine(v => v.status === 'failed' || (!v.retrySafe && v.errorCode === null), { message: 'successful handoffs cannot authorize a retry' });

export const CapabilitiesResponse = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    appEnv: z.string(),
    routes: z.array(
      z
        .object({
          route: z.string(),
          category: z.string(),
          readiness: Readiness,
        })
        .strict(),
    ),
    fundingRails: z.array(z.object({ rail: FundingRail, readiness: Readiness }).strict()),
    banking: z.array(Readiness),
    operations: z.array(z.string()),
  })
  .strict();

export const HealthResponse = z.object({ ok: z.literal(true), contractVersion: z.literal(CONTRACT_VERSION) }).strict();

export type SearchOffersRequest = z.infer<typeof SearchOffersRequest>;
export type CreateQuoteRequest = z.infer<typeof CreateQuoteRequest>;
export type CreatePurchaseRequest = z.infer<typeof CreatePurchaseRequest>;
export type CapabilitiesResponse = z.infer<typeof CapabilitiesResponse>;

/** Operation names shared by HTTP and MCP channels. */
export const OPERATIONS = {
  searchOffers: { method: 'POST', path: `${API_PREFIX}/offers/search`, mcpTool: 'find_offers', scope: 'offers:read' },
  createQuote: { method: 'POST', path: `${API_PREFIX}/quotes`, mcpTool: 'create_quote', scope: 'quotes:write' },
  createPurchase: { method: 'POST', path: `${API_PREFIX}/purchases`, mcpTool: 'buy', scope: 'purchases:write' },
  fundPurchase: { method: 'POST', path: `${API_PREFIX}/purchases/:id/fund`, mcpTool: 'buy', scope: 'purchases:fund' },
  getPurchase: { method: 'GET', path: `${API_PREFIX}/purchases/:id`, mcpTool: 'get_purchase', scope: 'purchases:read' },
  purchaseEvents: { method: 'GET', path: `${API_PREFIX}/purchases/:id/events`, mcpTool: null, scope: 'purchases:read' },
  capabilities: { method: 'GET', path: `${API_PREFIX}/capabilities`, mcpTool: null, scope: null },
} as const;
