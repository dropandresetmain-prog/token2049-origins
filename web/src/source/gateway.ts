/**
 * Gateway source: authenticated, read-only calls to the gateway HTTP API. Every response is validated
 * with the gateway's own schemas before it reaches a presenter.
 *
 * The access key lives in this module's closure only. It is sent as a bearer header, never logged,
 * never written to storage, never placed in a URL and never included in an error message.
 *
 * Endpoints (all GET): /v1/capabilities, /v1/evidence/purchases, /v1/purchases/:id,
 * /v1/evidence/purchases/:id, /v1/evidence/purchases/:id/proof, /v1/quotes/:id, and the operator reads
 * /v1/evidence/treasury and /v1/evidence/bank (operator:read). POST /v1/evidence/bank/refresh is deliberately
 * not used: the console observes stored facts and never asks a bank anything.
 * See docs/contracts/CONSOLE_CONTRACT.md.
 */
import { z } from 'zod';
import { CapabilitiesResponse, ErrorBody, PurchaseResponse, QuoteView } from '../contracts/backend.js';
import { EvidenceDetail, EvidenceListResponse, PurchaseProofResponse } from '../contracts/evidence.js';
import { BankResponse, TreasuryResponse } from '../contracts/operator.js';
import { EMPTY_CONTEXT } from '../contracts/proposed.js';
import {
  ConsoleError,
  type ConsoleEnvironment,
  type ConnectionsData,
  type ConsoleSource,
  type PurchaseBundle,
  type PurchaseListResult,
} from '../contracts/source.js';

export interface GatewaySourceOptions {
  /** '' for same-origin. */
  baseUrl: string;
  accessKey: string;
  fetchImpl?: typeof fetch;
}

const QuoteResponse = z.object({ quote: QuoteView });

const STATUS_CODES: Record<number, { code: 'unauthenticated' | 'forbidden' | 'not_found'; message: string }> = {
  401: { code: 'unauthenticated', message: 'The access key was not accepted.' },
  403: { code: 'forbidden', message: 'The access key does not allow this.' },
  404: { code: 'not_found', message: 'Not found.' },
};

export function createGatewaySource(opts: GatewaySourceOptions): ConsoleSource {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const accessKey = opts.accessKey;
  const doFetch: typeof fetch = opts.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  async function request<S extends z.ZodType>(path: string, schema: S, init: { auth: boolean } = { auth: true }): Promise<{ data: z.output<S>; raw: unknown }> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (init.auth) headers.Authorization = `Bearer ${accessKey}`;

    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, { method: 'GET', headers, credentials: 'omit', cache: 'no-store' });
    } catch {
      // The underlying message can carry URLs or request details; keep the surfaced error generic.
      throw new ConsoleError('network', 'The gateway could not be reached.');
    }

    let body: unknown;
    let bodyReadable = true;
    try {
      body = await response.json();
    } catch {
      bodyReadable = false;
    }

    if (!response.ok) {
      const parsed = bodyReadable ? ErrorBody.safeParse(body) : undefined;
      if (parsed?.success) {
        const { code, message, requestId } = parsed.data.error;
        throw new ConsoleError(code, message, requestId, response.status);
      }
      const known = STATUS_CODES[response.status];
      throw new ConsoleError(known?.code ?? 'internal', known?.message ?? 'The gateway could not complete the request.', undefined, response.status);
    }

    const parsed = bodyReadable ? schema.safeParse(body) : undefined;
    if (!parsed?.success) {
      // No response data in the message: it may contain private purchase facts.
      throw new ConsoleError('invalid_response', 'The gateway returned a response the console could not read.', undefined, response.status);
    }
    return { data: parsed.data, raw: body };
  }

  /** Optional reads degrade to null when the key lacks the scope. Everything else propagates. */
  async function optional<T>(read: () => Promise<T>): Promise<T | null> {
    try {
      return await read();
    } catch (e) {
      if (e instanceof ConsoleError && e.code === 'forbidden') return null;
      throw e;
    }
  }

  const enc = encodeURIComponent;

  return {
    kind: 'gateway',

    async environment(): Promise<ConsoleEnvironment> {
      const { data } = await request('/v1/capabilities', CapabilitiesResponse, { auth: false });
      return { mode: data.appEnv === 'production' ? 'live' : 'test' };
    },

    async listPurchases(): Promise<PurchaseListResult> {
      const { data } = await request('/v1/evidence/purchases', EvidenceListResponse);
      return { entries: data.purchases.map((item) => ({ item, context: EMPTY_CONTEXT })), limit: data.limit };
    },

    async getTreasury() {
      return (await request('/v1/evidence/treasury', TreasuryResponse)).data;
    },

    async getConnections(): Promise<ConnectionsData> {
      // The bank read is the gated one; ask for it first so a customer key fails before anything else is sent.
      const bank = (await request('/v1/evidence/bank', BankResponse)).data;
      const capabilities = (await request('/v1/capabilities', CapabilitiesResponse, { auth: false })).data;
      return { capabilities, bank };
    },

    async hasOperatorAccess(): Promise<boolean> {
      try {
        await request('/v1/evidence/treasury', TreasuryResponse);
        return true;
      } catch (e) {
        if (e instanceof ConsoleError && e.code === 'forbidden') return false;
        throw e;
      }
    },

    async getPurchase(purchaseId: string): Promise<PurchaseBundle> {
      const id = enc(purchaseId);
      const purchase = request(`/v1/purchases/${id}`, PurchaseResponse);
      const proof = optional(() => request(`/v1/evidence/purchases/${id}/proof`, PurchaseProofResponse));
      const evidence = optional(() => request(`/v1/evidence/purchases/${id}`, EvidenceDetail));
      // The quote read needs the purchase's quoteId, so it follows the purchase but overlaps the other reads.
      const quote = optional(async () => {
        const p = await purchase;
        return request(`/v1/quotes/${enc(p.data.purchase.quoteId)}`, QuoteResponse);
      });

      const results = await Promise.allSettled([purchase, proof, evidence, quote]);
      // The purchase is required; report its failure first, then any other failure in a fixed order.
      for (const r of results) if (r.status === 'rejected') throw r.reason;
      const [p, pr, ev, q] = results.map((r) => (r as PromiseFulfilledResult<unknown>).value) as [
        Awaited<typeof purchase>,
        Awaited<typeof proof>,
        Awaited<typeof evidence>,
        Awaited<typeof quote>,
      ];

      return {
        purchase: p.data.purchase,
        quote: q ? q.data.quote : null,
        proof: pr ? pr.data.proof : null,
        evidence: ev ? ev.data : null,
        technicalRecord: ev ? ev.raw : null,
        context: EMPTY_CONTEXT,
      };
    },
  };
}
