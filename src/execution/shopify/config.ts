import { missingEnv } from '../../infrastructure/config.js';

/**
 * Shopify lane configuration. Buyer capability (Storefront token + controlled browser) and
 * seller-admin readback capability (Dev Dashboard client credentials) are SEPARATE halves with
 * separate credentials and code paths: the buyer half can never read orders, and the admin half
 * is never used to create or mark anything paid (see the static test over this directory).
 */
export const BUYER_ENV = ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_STOREFRONT_TOKEN'] as const;
export const ADMIN_ENV = ['SHOPIFY_STORE_DOMAIN', 'SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET'] as const;

export const DEFAULT_API_VERSION = '2026-10';

export interface ShopifyConfig {
  storeDomain: string;
  apiVersion: string;
  storefrontToken: string | null;
  /** Optional server-side delegate token (Shopify-Storefront-Private-Token); preferred over the public token when set. */
  storefrontPrivateToken: string | null;
  /** Optional egress IP forwarded as Shopify-Storefront-Buyer-IP so Shopify can attribute traffic instead of pooling it. */
  storefrontBuyerIp: string | null;
  clientId: string | null;
  clientSecret: string | null;
  storePassword: string | null;
  browserExecutable: string | null;
  headless: boolean;
  devStoreConfirmed: boolean;
  bogusGatewayEnabled: boolean;
}

export interface ShopifyConfigReport {
  config: ShopifyConfig;
  /** Env names missing for each half (never values). */
  missingBuyer: string[];
  missingAdmin: string[];
  /** Env names that are present but malformed (never values). */
  invalid: string[];
  buyerReady: boolean;
  adminReady: boolean;
}

const DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const VERSION = /^\d{4}-\d{2}$/;

export function loadShopifyConfig(env: NodeJS.ProcessEnv): ShopifyConfigReport {
  const get = (k: string): string | null => {
    const v = env[k];
    return v && v.trim() !== '' ? v.trim() : null;
  };
  const invalid: string[] = [];
  let storeDomain = (get('SHOPIFY_STORE_DOMAIN') ?? '').toLowerCase();
  // The domain is interpolated into request URLs and the checkout allow-list: strict shape only.
  if (storeDomain && !DOMAIN.test(storeDomain)) {
    invalid.push('SHOPIFY_STORE_DOMAIN');
    storeDomain = '';
  }
  let apiVersion = get('SHOPIFY_API_VERSION') ?? DEFAULT_API_VERSION;
  if (!VERSION.test(apiVersion)) {
    invalid.push('SHOPIFY_API_VERSION');
    apiVersion = DEFAULT_API_VERSION;
  }
  let buyerIp = get('SHOPIFY_STOREFRONT_BUYER_IP');
  // Forwarded verbatim as a header: accept only a plain IPv4/IPv6 literal.
  if (buyerIp && !/^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]{2,45}$/.test(buyerIp)) {
    invalid.push('SHOPIFY_STOREFRONT_BUYER_IP');
    buyerIp = null;
  }
  const config: ShopifyConfig = {
    storeDomain,
    apiVersion,
    storefrontToken: get('SHOPIFY_STOREFRONT_TOKEN'),
    storefrontPrivateToken: get('SHOPIFY_STOREFRONT_PRIVATE_TOKEN'),
    storefrontBuyerIp: buyerIp,
    clientId: get('SHOPIFY_CLIENT_ID'),
    clientSecret: get('SHOPIFY_CLIENT_SECRET'),
    storePassword: get('SHOPIFY_STORE_PASSWORD'),
    browserExecutable: get('SHOPIFY_BROWSER_EXECUTABLE'),
    headless: (get('SHOPIFY_HEADLESS') ?? 'true').toLowerCase() !== 'false',
    devStoreConfirmed: get('SHOPIFY_DEV_STORE_CONFIRMED') === 'true',
    bogusGatewayEnabled: get('SHOPIFY_BOGUS_GATEWAY_ENABLED') === 'true',
  };
  // A malformed domain counts as missing for both halves.
  const view: NodeJS.ProcessEnv = { ...env, SHOPIFY_STORE_DOMAIN: storeDomain };
  const missingBuyer = missingEnv(view, [...BUYER_ENV]);
  const missingAdmin = missingEnv(view, [...ADMIN_ENV]);
  return {
    config,
    missingBuyer,
    missingAdmin,
    invalid,
    buyerReady: missingBuyer.length === 0,
    adminReady: missingAdmin.length === 0,
  };
}
