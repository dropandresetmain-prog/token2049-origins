import { z } from 'zod';
import type { Money } from '../../contracts/money.js';
import type { RetailFulfillment } from '../../contracts/intent.js';
import { ProviderError } from '../../core/errors.js';
import type { ShopifyConfig } from './config.js';
import { postGraphQL, ShopifyHttpError, type GraphQLEndpoint } from './http.js';
import { MoneyV2, toMoney } from './money.js';

/**
 * Buyer-side Shopify Storefront API client (search, cart, delivery selection). It holds only the
 * Storefront token (public or server-side private): it cannot read orders or complete a checkout. Checkout
 * completion happens in the controlled browser (browserCheckout.ts).
 *
 * Cart delivery uses the current Storefront API (2026-10): addresses go in `cartCreate`
 * `input.delivery.addresses[]` (CartSelectableAddressInput) and the option is picked with
 * `cartSelectedDeliveryOptionsUpdate`. The legacy `buyerIdentity.deliveryAddressPreferences` is not used.
 */

/** Cart attribute carrying the per-quote nonce; Shopify copies cart attributes to order customAttributes. */
export const QUOTE_ATTRIBUTE = 't2o_quote';

const DeliveryOption = z.object({
  handle: z.string(),
  title: z.string().nullable().optional(),
  estimatedCost: MoneyV2,
  deliveryMethodType: z.string(),
});

const CartSchema = z.object({
  id: z.string(),
  checkoutUrl: z.string(),
  totalQuantity: z.number().int(),
  buyerIdentity: z.object({ email: z.string().nullable() }),
  attributes: z.array(z.object({ key: z.string(), value: z.string().nullable() })),
  cost: z.object({
    totalAmount: MoneyV2,
    subtotalAmount: MoneyV2,
    totalAmountEstimated: z.boolean(),
    subtotalAmountEstimated: z.boolean(),
    totalTaxAmount: MoneyV2.nullable(),
    totalTaxAmountEstimated: z.boolean(),
    totalDutyAmount: MoneyV2.nullable(),
    totalDutyAmountEstimated: z.boolean(),
  }),
  discountAllocations: z.array(z.unknown()),
  delivery: z.object({ addresses: z.array(z.object({
    selected: z.boolean(),
    address: z.object({ firstName:z.string().nullable(), lastName:z.string().nullable(), address1:z.string().nullable(), address2:z.string().nullable(), city:z.string().nullable(), zip:z.string().nullable(), countryCode:z.string().nullable(), provinceCode:z.string().nullable() }),
  })) }).optional(),
  lines: z.object({
    nodes: z.array(
      z.object({
        quantity: z.number().int(),
        merchandise: z.object({ id: z.string(), title: z.string(), product: z.object({ title: z.string() }) }),
      }),
    ),
  }),
  deliveryGroups: z.object({
    nodes: z.array(
      z.object({
        id: z.string(),
        deliveryAddress: z.object({ firstName: z.string().nullable(), lastName: z.string().nullable(), address1: z.string().nullable(), address2: z.string().nullable(), city: z.string().nullable(), zip: z.string().nullable(), countryCodeV2: z.string().nullable(), provinceCode: z.string().nullable() }),
        deliveryOptions: z.array(DeliveryOption),
        selectedDeliveryOption: DeliveryOption.nullable(),
      }),
    ),
  }),
});
export type StorefrontCart = z.infer<typeof CartSchema>;

const UserErrors = z.array(z.object({ code: z.string().nullable().optional(), field: z.array(z.string()).nullable().optional() }));

const CART_FIELDS = `
fragment CartFields on Cart {
  id checkoutUrl totalQuantity
  buyerIdentity { email }
  attributes { key value }
  delivery { addresses { selected address { ... on CartDeliveryAddress { firstName lastName address1 address2 city zip countryCode provinceCode } } } }
  cost { totalAmount { amount currencyCode } subtotalAmount { amount currencyCode } totalAmountEstimated subtotalAmountEstimated totalTaxAmount { amount currencyCode } totalTaxAmountEstimated totalDutyAmount { amount currencyCode } totalDutyAmountEstimated }
  discountAllocations { discountedAmount { amount currencyCode } }
  lines(first: 10) { nodes { quantity merchandise { ... on ProductVariant { id title product { title } } } } }
  deliveryGroups(first: 5) {
    nodes {
      id
      deliveryAddress { firstName lastName address1 address2 city zip countryCodeV2 provinceCode }
      deliveryOptions { handle title deliveryMethodType estimatedCost { amount currencyCode } }
      selectedDeliveryOption { handle title deliveryMethodType estimatedCost { amount currencyCode } }
    }
  }
}`;

const CART_CREATE = `${CART_FIELDS}
mutation CartCreate($input: CartInput!, $country: CountryCode!) @inContext(country: $country) {
  cartCreate(input: $input) { cart { ...CartFields } userErrors { code field } }
}`;

const CART_SELECT_DELIVERY = `${CART_FIELDS}
mutation CartSelectDelivery($cartId: ID!, $options: [CartSelectedDeliveryOptionInput!]!, $country: CountryCode!) @inContext(country: $country) {
  cartSelectedDeliveryOptionsUpdate(cartId: $cartId, selectedDeliveryOptions: $options) { cart { ...CartFields } userErrors { code field } }
}`;

const CART_QUERY = `${CART_FIELDS}
query CartRead($id: ID!, $country: CountryCode!) @inContext(country: $country) { cart(id: $id) { ...CartFields } }`;

const VARIANT_FIELDS = 'id title availableForSale price { amount currencyCode }';
const PRODUCT_FIELDS = `id title description availableForSale variants(first: 10) { nodes { ${VARIANT_FIELDS} } }`;

const SEARCH_QUERY = `query Search($q: String!, $country: CountryCode!) @inContext(country: $country) {
  products(first: 10, query: $q) { nodes { ${PRODUCT_FIELDS} } }
}`;

const NODE_QUERY = `query Node($id: ID!, $country: CountryCode!) @inContext(country: $country) {
  node(id: $id) {
    ... on Product { ${PRODUCT_FIELDS} }
    ... on ProductVariant { ${VARIANT_FIELDS} product { id title description } }
  }
}`;

const SHOP_QUERY = 'query { shop { name } }';

const VariantSchema = z.object({ id: z.string(), title: z.string(), availableForSale: z.boolean(), price: MoneyV2 });
const ProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  availableForSale: z.boolean(),
  variants: z.object({ nodes: z.array(VariantSchema) }),
});
const VariantWithProduct = VariantSchema.extend({
  product: z.object({ id: z.string(), title: z.string(), description: z.string().nullable().optional() }),
});

export interface CatalogVariant {
  variantId: string;
  title: string;
  description: string;
  unitPrice: Money;
}

const GID = /^gid:\/\/shopify\/(Product|ProductVariant)\/\d+$/;

/** Keep free text to word characters so it cannot inject Storefront search operators. */
export function sanitizeSearchText(q: string): string {
  return q.replace(/[^\p{L}\p{N} '-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

export class StorefrontClient {
  private readonly ep: GraphQLEndpoint;
  constructor(
    cfg: ShopifyConfig,
    private readonly fetchImpl: typeof fetch,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {
    if (!cfg.storefrontToken && !cfg.storefrontPrivateToken) throw new ProviderError('not_sent', 'shopify_not_configured', 'Storefront token missing');
    // Server-side calls prefer the private (delegate) token; Shopify attributes traffic via the buyer IP when configured.
    const headers: Record<string, string> = cfg.storefrontPrivateToken
      ? { 'Shopify-Storefront-Private-Token': cfg.storefrontPrivateToken }
      : { 'X-Shopify-Storefront-Access-Token': cfg.storefrontToken! };
    if (cfg.storefrontBuyerIp) headers['Shopify-Storefront-Buyer-IP'] = cfg.storefrontBuyerIp;
    this.ep = { url: `https://${cfg.storeDomain}/api/${cfg.apiVersion}/graphql.json`, headers };
  }

  /**
   * Shopify limits cart/checkout creation per minute and answers with a 200 THROTTLED error. Carts are
   * harmless to repeat (no order or payment), so retry with bounded exponential backoff. Other errors,
   * and exhaustion, propagate unchanged.
   */
  private async retryThrottled<T>(fn: () => Promise<T>): Promise<T> {
    const delays = [500, 1500, 4000, 10_000];
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (!(e instanceof ShopifyHttpError && e.throttled) || attempt >= delays.length) throw e;
        await this.sleep(delays[attempt]!);
      }
    }
  }

  async shopName(): Promise<string> {
    const r = await postGraphQL(this.fetchImpl, this.ep, SHOP_QUERY, {}, z.object({ shop: z.object({ name: z.string() }) }));
    return r.shop.name;
  }

  /** Available variants only, price exact (decimal string parsed to minor units). */
  async findVariants(opts: { query?: string; productRef?: string; country: string; includeSandboxShadows?: boolean }): Promise<CatalogVariant[]> {
    const out: CatalogVariant[] = [];
    // Reserved shadow titles are controlled and verified during preparation. Ordinary discovery
    // cannot turn retained audit products into purchases without source provenance.
    const blockedShadow = (title: string) => !opts.includeSandboxShadows && title.startsWith('[CAPSULE SANDBOX] ');
    const pushProduct = (p: z.infer<typeof ProductSchema>): void => {
      if (blockedShadow(p.title)) return;
      for (const v of p.variants.nodes) {
        if (!v.availableForSale) continue;
        out.push({
          variantId: v.id,
          title: v.title === 'Default Title' ? p.title : `${p.title} - ${v.title}`,
          description: (p.description ?? '').slice(0, 300),
          unitPrice: toMoney(v.price),
        });
      }
    };
    if (opts.productRef) {
      if (!GID.test(opts.productRef)) throw new ProviderError('rejected', 'shopify_bad_product_ref', 'productRef must be a Shopify Product or ProductVariant gid');
      const NodeSchema = z.object({ node: z.union([ProductSchema, VariantWithProduct]).nullable() });
      const r = await postGraphQL(this.fetchImpl, this.ep, NODE_QUERY, { id: opts.productRef, country: opts.country }, NodeSchema);
      const n = r.node;
      if (!n) return [];
      if ('variants' in n) pushProduct(n);
      else if (n.availableForSale && !blockedShadow(n.product.title)) {
        out.push({
          variantId: n.id,
          title: n.title === 'Default Title' ? n.product.title : `${n.product.title} - ${n.title}`,
          description: (n.product.description ?? '').slice(0, 300),
          unitPrice: toMoney(n.price),
        });
      }
      return out;
    }
    const text = sanitizeSearchText(opts.query ?? '');
    if (!text) throw new ProviderError('rejected', 'shopify_empty_query', 'search text is empty after sanitising');
    const r = await postGraphQL(
      this.fetchImpl,
      this.ep,
      SEARCH_QUERY,
      { q: `${text} available_for_sale:true${opts.includeSandboxShadows ? '' : ' tag_not:capsule-sandbox'}`, country: opts.country },
      z.object({ products: z.object({ nodes: z.array(ProductSchema) }) }),
    );
    for (const p of r.products.nodes) pushProduct(p);
    return out.slice(0, 10);
  }

  private cartResult(payloadRaw: unknown): StorefrontCart {
    const payload = z.object({ cart: CartSchema.nullable(), userErrors: UserErrors }).parse(payloadRaw);
    if (payload.userErrors.length > 0 || !payload.cart) {
      const codes = payload.userErrors.map(() => 'REJECTED').join(',');
      throw new ProviderError('rejected', 'shopify_cart_rejected', `cart operation rejected${codes ? ` (${codes})` : ''}`);
    }
    return payload.cart;
  }

  /** New cart with the line, buyer email/country, the shipping address and the quote nonce attribute. */
  async createCart(args: { variantId: string; quantity: number; nonce: string; fulfillment: RetailFulfillment }): Promise<StorefrontCart> {
    const a = args.fulfillment.shippingAddress;
    const deliveryAddress: Record<string, unknown> = {
      firstName: a.firstName,
      lastName: a.lastName,
      address1: a.address1,
      city: a.city,
      zip: a.zip,
      countryCode: a.countryCode,
    };
    if (a.address2) deliveryAddress.address2 = a.address2;
    // provinceCode wants a code (e.g. CA); free-text province names are left to checkout.
    if (a.province && /^[A-Za-z0-9-]{1,6}$/.test(a.province)) deliveryAddress.provinceCode = a.province.toUpperCase();
    // phone must be E.164
    if (a.phone && /^\+[1-9]\d{6,14}$/.test(a.phone)) deliveryAddress.phone = a.phone;
    const input = {
      lines: [{ merchandiseId: args.variantId, quantity: args.quantity }],
      attributes: [{ key: QUOTE_ATTRIBUTE, value: args.nonce }],
      buyerIdentity: { email: args.fulfillment.email, countryCode: a.countryCode },
      delivery: { addresses: [{ selected: true, oneTimeUse: true, address: { deliveryAddress } }] },
    };
    const d = await this.retryThrottled(() => postGraphQL(this.fetchImpl, this.ep, CART_CREATE, { input, country: a.countryCode }, z.object({ cartCreate: z.unknown() })));
    return this.cartResult(d.cartCreate);
  }

  async selectDelivery(cartId: string, selections: Array<{ deliveryGroupId: string; deliveryOptionHandle: string }>, country: string): Promise<StorefrontCart> {
    const d = await this.retryThrottled(() => postGraphQL(
      this.fetchImpl,
      this.ep,
      CART_SELECT_DELIVERY,
      { cartId, options: selections, country },
      z.object({ cartSelectedDeliveryOptionsUpdate: z.unknown() }),
    ));
    return this.cartResult(d.cartSelectedDeliveryOptionsUpdate);
  }

  /** Null when the cart no longer exists (expired/consumed by a completed checkout). */
  async getCart(cartId: string, country: string): Promise<StorefrontCart | null> {
    const d = await postGraphQL(this.fetchImpl, this.ep, CART_QUERY, { id: cartId, country }, z.object({ cart: CartSchema.nullable() }));
    return d.cart;
  }
}

export interface CartTotals {
  total: Money;
  subtotal: Money;
  shipping: Money;
  /** Explicit tax field is deprecated but still required here to reject hidden duties/discounts. */
  tax: Money;
  shippingTitle: string;
}

const unavailable = (why: string): ProviderError => new ProviderError('rejected', 'shopify_total_unavailable', `exact cart total unavailable: ${why}`);

/** The selected CartDeliveryAddress is authoritative; the delivery-group projection may omit codes. */
export function readCartAddress(cart: StorefrontCart): StorefrontCart['deliveryGroups']['nodes'][number]['deliveryAddress'] {
  const group = cart.deliveryGroups.nodes[0]?.deliveryAddress;
  if (!group) throw unavailable('delivery address missing');
  if (!cart.delivery) return group; // Legacy/test responses retain their original address boundary.
  const selected = cart.delivery.addresses.filter(a => a.selected);
  if (selected.length !== 1) throw unavailable('exactly one selected delivery address required');
  const address = selected[0]!.address;
  const actual = { ...address, countryCodeV2: address.countryCode };
  const normalized = (v: string | null) => (v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  for (const key of ['firstName','lastName','address1','address2','city','zip','countryCodeV2','provinceCode'] as const) {
    // Missing country/province in the derived group is not a contradiction. Its other fields
    // must still agree, and the explicit selected address must carry the requested codes.
    if ((key === 'countryCodeV2' || key === 'provinceCode') && group[key] === null) continue;
    if (normalized(group[key]) !== normalized(actual[key])) throw unavailable('selected address conflicts with delivery group');
  }
  return actual;
}

/** Cart terms used to select and bind a checkout; these amounts are not an exact payable quote. */
export function readCartTerms(cart: StorefrontCart): Pick<CartTotals, 'subtotal' | 'shipping' | 'shippingTitle'> {
  if (cart.discountAllocations.length || (cart.cost.totalDutyAmount && BigInt(toMoney(cart.cost.totalDutyAmount).amountMinor) !== 0n)) throw unavailable('discounts and duties are unsupported');
  if (cart.deliveryGroups.nodes.length !== 1) throw unavailable('exactly one delivery group required');
  const selected = cart.deliveryGroups.nodes[0]!.selectedDeliveryOption;
  if (!selected || selected.deliveryMethodType !== 'SHIPPING' || !selected.title) throw unavailable('no named shipping option selected');
  const subtotal = toMoney(cart.cost.subtotalAmount);
  const shipping = toMoney(selected.estimatedCost);
  if (subtotal.currency !== shipping.currency || subtotal.scale !== shipping.scale) throw unavailable('mixed currencies');
  return { subtotal, shipping, shippingTitle: selected.title };
}

/** Exact API quote validation; every amount must be settled and the explicit tax must balance. */
export function readCartTotals(cart: StorefrontCart): CartTotals {
  if (cart.cost.totalAmountEstimated || cart.cost.subtotalAmountEstimated || cart.cost.totalTaxAmountEstimated || cart.cost.totalDutyAmountEstimated || !cart.cost.totalTaxAmount) throw unavailable('totals or tax are estimated/missing');
  if (cart.discountAllocations.length || (cart.cost.totalDutyAmount && BigInt(toMoney(cart.cost.totalDutyAmount).amountMinor) !== 0n)) throw unavailable('discounts and duties are unsupported');
  const groups = cart.deliveryGroups.nodes;
  if (groups.length !== 1) throw unavailable('exactly one delivery group required');
  const total = toMoney(cart.cost.totalAmount);
  const subtotal = toMoney(cart.cost.subtotalAmount);
  let shippingMinor = 0n;
  const titles: string[] = [];
  for (const g of groups) {
    const sel = g.selectedDeliveryOption;
    if (!sel || sel.deliveryMethodType !== 'SHIPPING' || !sel.title) throw unavailable('no named shipping option selected');
    const c = toMoney(sel.estimatedCost);
    if (c.currency !== total.currency) throw unavailable('mixed currencies');
    shippingMinor += BigInt(c.amountMinor);
    titles.push(sel.title ?? sel.handle);
  }
  if (subtotal.currency !== total.currency) throw unavailable('mixed currencies');
  const taxMinor = BigInt(total.amountMinor) - BigInt(subtotal.amountMinor) - shippingMinor;
  const tax = toMoney(cart.cost.totalTaxAmount!);
  if (taxMinor < 0n || tax.currency !== total.currency || BigInt(tax.amountMinor) !== taxMinor) throw unavailable('explicit tax does not balance total, items and shipping');
  const mk = (v: bigint): Money => ({ currency: total.currency, amountMinor: v.toString(), scale: total.scale });
  return { total, subtotal, shipping: mk(shippingMinor), tax: mk(taxMinor), shippingTitle: titles.join(' + ') };
}

/** Cheapest SHIPPING option per delivery group (ties broken by handle for determinism). */
export function cheapestSelections(cart: StorefrontCart): Array<{ deliveryGroupId: string; deliveryOptionHandle: string }> {
  const out: Array<{ deliveryGroupId: string; deliveryOptionHandle: string }> = [];
  for (const g of cart.deliveryGroups.nodes) {
    const opts = g.deliveryOptions
      .filter((o) => o.deliveryMethodType === 'SHIPPING')
      .map((o) => ({ o, cost: BigInt(toMoney(o.estimatedCost).amountMinor) }))
      .sort((x, y) => (x.cost < y.cost ? -1 : x.cost > y.cost ? 1 : x.o.handle.localeCompare(y.o.handle)));
    const best = opts[0];
    if (!best) return [];
    out.push({ deliveryGroupId: g.id, deliveryOptionHandle: best.o.handle });
  }
  return out;
}
