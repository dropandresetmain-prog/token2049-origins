import { z } from 'zod';
import { Money } from './money.js';
import { EvidenceMode } from './common.js';

/** Reduced source facts, never a provider payload or a source checkout handle. */
export const SourceOffer = z.object({
  source: z.literal('shopify_global_catalog'),
  productId: z.string().regex(/^gid:\/\/shopify\/(?:p|Product)\/[A-Za-z0-9]+$/),
  variantId: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/),
  merchantId: z.string().regex(/^gid:\/\/shopify\/Shop\/\d+$/),
  merchantName: z.string().min(1).max(200), merchantUrl: safeSourceUrl(),
  productTitle: z.string().min(1).max(250), variantTitle: z.string().min(1).max(250),
  productUrl: safeSourceUrl(), observedPrice: Money,
  availability: z.literal('available'), observedAt: z.iso.datetime(),
  schemaVersion: z.literal('2026-08-25'), evidenceMode: EvidenceMode,
}).strict();
export type SourceOffer = z.infer<typeof SourceOffer>;

/** Source links are display-only; provider transport never follows them. Tracking is removed. */
function safeSourceUrl() {
  return z.url().max(2000).refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port;
  }, 'HTTPS source URL required');
}
export const SandboxRepresentation = z.object({
  provider: z.literal('shopify'), environment: z.literal('test'),
  boundary: z.literal('Source merchant receives no order or payment; equivalent transaction executes in Capsule Shopify Sandbox.'),
  shadowProductId: z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/),
  shadowVariantId: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/),
  publicationId: z.string().regex(/^gid:\/\/shopify\/Publication\/\d+$/),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type SandboxRepresentation = z.infer<typeof SandboxRepresentation>;
export const SandboxExecution = SandboxRepresentation.extend({
  quotedTotal: Money, orderReference: z.string().nullable(), paymentStatus: z.string(),
  evidenceMode: EvidenceMode.nullable(),
}).strict();
export type SandboxExecution = z.infer<typeof SandboxExecution>;
