import { z } from 'zod';
import { AdminTransport } from './adminTransport.js';
import { MoneyV2 } from './money.js';

/**
 * Seller-admin READBACK client. It exists only to independently observe what the buyer-side
 * checkout produced. Its token (read_orders) is minted via the Dev Dashboard client-credentials
 * grant and cached in memory. This module deliberately has no mutation: it can never create an
 * order, complete a draft or mark anything paid.
 */

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

const SAFE_TERM = /^[#A-Za-z0-9-]{1,32}$/;

export class AdminClient extends AdminTransport {
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
