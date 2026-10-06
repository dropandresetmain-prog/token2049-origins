import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { QUOTE_ATTRIBUTE } from './storefront.js';

/** HMAC covers exact bytes; JSON.parse/stringify changes them and must never be substituted. */
export function verifyShopifyHmac(raw: Buffer, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const provided = Buffer.from(signature, 'base64');
  const expected = createHmac('sha256', secret).update(raw).digest();
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export interface ShopifyReconcileHint {
  orderId: string;
  quoteNonce: string | null;
  deliveryId: string;
  topic: 'orders/paid' | 'orders/updated';
}
export interface ShopifyWebhookOptions {
  storeDomain: string;
  secret: string;
  /** Durably enqueue independent Admin readback; may run more than once and out of order. */
  onReconcile(hint: ShopifyReconcileHint): Promise<void>;
}
const Body = z.object({
  admin_graphql_api_id: z.string().regex(/^gid:\/\/shopify\/Order\/\d+$/),
  note_attributes: z.array(z.object({ name: z.string(), value: z.string().nullable() })).optional(),
});

/** Mount BEFORE global express.json(). Payload status/amounts never enter the callback. */
export function createShopifyWebhookRouter(options: ShopifyWebhookOptions): Router {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(options.storeDomain) || !options.secret) throw new Error('Shopify webhook configuration is incomplete');
  const router = Router();
  router.post('/', express.raw({ type: 'application/json', limit: '256kb', inflate: false }), async (req, res) => {
    if (!Buffer.isBuffer(req.body)) { res.status(400).json({ error: 'raw_body_required' }); return; }
    if (!verifyShopifyHmac(req.body, req.get('x-shopify-hmac-sha256'), options.secret) || req.get('x-shopify-shop-domain') !== options.storeDomain) {
      res.status(401).json({ error: 'invalid_webhook' }); return;
    }
    const topic = req.get('x-shopify-topic');
    const deliveryId = req.get('x-shopify-webhook-id');
    if ((topic !== 'orders/paid' && topic !== 'orders/updated') || !deliveryId || !/^[a-zA-Z0-9-]{1,100}$/.test(deliveryId)) {
      res.status(400).json({ error: 'unsupported_webhook' }); return;
    }
    let raw: unknown;
    try { raw = JSON.parse(req.body.toString('utf8')); } catch { res.status(400).json({ error: 'invalid_payload' }); return; }
    const parsed = Body.safeParse(raw);
    if (!parsed.success) { res.status(400).json({ error: 'invalid_payload' }); return; }
    const nonces = (parsed.data.note_attributes ?? []).filter(a => a.name === QUOTE_ATTRIBUTE).map(a => a.value);
    const quoteNonce = nonces.length === 1 && z.string().uuid().safeParse(nonces[0]).success ? nonces[0]! : null;
    try {
      // Do not cache deliveries in memory: a failed enqueue must remain retryable across restarts.
      await options.onReconcile({ orderId: parsed.data.admin_graphql_api_id, quoteNonce, topic, deliveryId });
      res.sendStatus(202);
    } catch { res.status(503).json({ error: 'reconciliation_unavailable' }); }
  });
  return router;
}
