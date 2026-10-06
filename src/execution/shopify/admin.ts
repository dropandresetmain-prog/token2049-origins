import { z } from 'zod';
import type { Clock } from '../../infrastructure/clock.js';
import { ProviderError } from '../../core/errors.js';
import type { ShopifyConfig } from './config.js';
import { postGraphQL, ShopifyHttpError, type GraphQLEndpoint } from './http.js';
import { MoneyV2 } from './money.js';

/**
 * Seller-admin READBACK client. It exists only to independently observe what the buyer-side
 * checkout produced. Its token (read_orders) is minted via the Dev Dashboard client-credentials
 * grant and cached in memory. This module deliberately has no mutation: it can never create an
 * order, complete a draft or mark anything paid.
 */

const TokenResponse = z.object({ access_token: z.string().min(1), expires_in: z.number().positive().optional() });

const Tx = z.object({
  kind: z.enum(['AUTHORIZATION', 'CAPTURE', 'CHANGE', 'EMV_AUTHORIZATION', 'REFUND', 'SALE', 'SUGGESTED_REFUND', 'VOID']),
  status: z.enum(['ERROR','FAILURE','PENDING','SUCCESS','UNKNOWN']),
  test: z.boolean(),
  gateway: z.string().nullable().optional(),
  amountSet: z.object({ presentmentMoney: MoneyV2 }),
});

export const AdminOrder = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/Order\/\d+$/),
  name: z.string(),
  confirmationNumber: z.string().nullable().optional(),
  test: z.boolean(),
  displayFinancialStatus: z.enum(['AUTHORIZED','EXPIRED','PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED','PENDING','REFUNDED','VOIDED']).nullable(),
  totalPriceSet: z.object({ presentmentMoney: MoneyV2 }),
  customAttributes: z.array(z.object({ key: z.string(), value: z.string().nullable() })),
  transactions: z.array(Tx),
});
export type AdminOrder = z.infer<typeof AdminOrder>;

const ORDER_FIELDS = `id name confirmationNumber test displayFinancialStatus
  totalPriceSet { presentmentMoney { amount currencyCode } }
  customAttributes { key value }
  transactions { kind status test gateway amountSet { presentmentMoney { amount currencyCode } } }`;

const ORDERS_QUERY = `query Orders($q: String!) {
  orders(first: 25, sortKey: CREATED_AT, reverse: true, query: $q) { nodes { ${ORDER_FIELDS} } }
}`;

const ORDER_QUERY = `query Order($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;
const SHOP_QUERY = 'query { shop { name } }';

/** Refresh when less than this much validity remains (Shopify recommends 60s). */
const TOKEN_SKEW_MS = 60_000;
/** Order search values are interpolated into a search string: allow-list them. */
const SAFE_TERM = /^[#A-Za-z0-9-]{1,32}$/;

export class AdminClient {
  private token: { value: string; expiresAtMs: number } | null = null;
  constructor(
    private readonly cfg: ShopifyConfig,
    private readonly fetchImpl: typeof fetch,
    private readonly clock: Clock,
  ) {
    if (!cfg.clientId || !cfg.clientSecret) throw new ProviderError('unknown', 'shopify_admin_not_configured', 'admin client credentials missing');
  }

  private endpoint(token: string): GraphQLEndpoint {
    return {
      url: `https://${this.cfg.storeDomain}/admin/api/${this.cfg.apiVersion}/graphql.json`,
      headers: { 'X-Shopify-Access-Token': token },
    };
  }

  /** client_credentials grant; ~24h token cached in memory only (never persisted or logged). */
  private async mintToken(): Promise<string> {
    const now = this.clock.now().getTime();
    if (this.token && this.token.expiresAtMs - TOKEN_SKEW_MS > now) return this.token.value;
    let res: Response;
    try {
      res = await this.fetchImpl(`https://${this.cfg.storeDomain}/admin/oauth/access_token`, {
        method: 'POST',
        redirect: 'error',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.cfg.clientId!,
          client_secret: this.cfg.clientSecret!,
        }).toString(),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new ShopifyHttpError('network', 'token request failed');
    }
    // Token endpoint rejections (bad client, shop_not_permitted) are credential problems.
    if (!res.ok) throw new ShopifyHttpError('http', `token endpoint HTTP ${res.status}`, res.status === 400 ? 401 : res.status);
    const parsed = TokenResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new ShopifyHttpError('parse', 'token response malformed');
    this.token = { value: parsed.data.access_token, expiresAtMs: now + (parsed.data.expires_in ?? 86_399) * 1000 };
    return this.token.value;
  }

  private async gql<S extends z.ZodType>(query: string, variables: Record<string, unknown>, schema: S): Promise<z.infer<S>> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.mintToken();
      try {
        return await postGraphQL(this.fetchImpl, this.endpoint(token), query, variables, schema);
      } catch (e) {
        // A 401 on a cached token means it was revoked/expired early: mint once more.
        if (attempt === 0 && e instanceof ShopifyHttpError && e.status === 401) {
          this.token = null;
          continue;
        }
        throw e;
      }
    }
  }

  async shopName(): Promise<string> {
    const r = await this.gql(SHOP_QUERY, {}, z.object({ shop: z.object({ name: z.string() }) }));
    return r.shop.name;
  }

  /**
   * Recent orders matching a name or confirmation number and/or created after a time. Callers must
   * still verify the quote nonce on every candidate; a search hit alone proves nothing.
   */
  async searchOrders(f: { orderId?: string; name?: string; confirmationNumber?: string; createdAfter?: string }): Promise<AdminOrder[]> {
    if (f.orderId) {
      if (!/^gid:\/\/shopify\/Order\/\d+$/.test(f.orderId)) return [];
      const result = await this.gql(ORDER_QUERY, { id: f.orderId }, z.object({ order: AdminOrder.nullable() }));
      return result.order ? [result.order] : [];
    }
    const parts: string[] = [];
    if (f.name) {
      if (!SAFE_TERM.test(f.name)) return [];
      parts.push(`name:${f.name}`);
    }
    if (f.confirmationNumber) {
      if (!SAFE_TERM.test(f.confirmationNumber)) return [];
      parts.push(`confirmation_number:${f.confirmationNumber}`);
    }
    if (f.createdAfter && !z.iso.datetime().safeParse(f.createdAfter).success) return [];
    if (f.createdAfter) parts.push(`created_at:>=${f.createdAfter}`);
    const r = await this.gql(ORDERS_QUERY, { q: parts.join(' ') }, z.object({ orders: z.object({ nodes: z.array(AdminOrder) }) }));
    return r.orders.nodes;
  }
}
