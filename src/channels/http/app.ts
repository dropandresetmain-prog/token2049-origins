import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { CommerceCore } from '../../core/service.js';
import { CoreError } from '../../core/errors.js';
import { authenticate } from '../../infrastructure/auth.js';
import { CreatePurchaseRequest, CreateQuoteRequest, SearchOffersRequest } from '../../contracts/api.js';
import type { ErrorBody } from '../../contracts/common.js';
import { redact } from '../../infrastructure/redact.js';
import type { ActorContext } from '../../core/actor.js';
import type { Router } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
    actor?: ActorContext;
  }
}

export interface HttpAppOptions {
  core: CommerceCore;
  /** Extra routers mounted after auth (e.g. evidence). */
  extraRouters?: Array<{ path: string; router: Router; auth: boolean; beforeJson?: boolean }>;
  log?: (line: Record<string, unknown>) => void;
}

const asyncH =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

export function createHttpApp(opts: HttpAppOptions): express.Express {
  const { core } = opts;
  const log = opts.log ?? (() => undefined);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);

  app.use((req, res, next) => {
    req.requestId = randomUUID();
    res.setHeader('X-Request-Id', req.requestId);
    res.setHeader('Cache-Control', 'no-store');
    const started = Date.now();
    res.on('finish', () => log({ requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started }));
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, contractVersion: 'v1' });
  });

  app.get(
    '/v1/capabilities',
    asyncH(async (_req, res) => {
      res.json(await core.capabilities());
    }),
  );

  const auth = (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.actor = authenticate(core.deps.db, req.header('authorization'), req.requestId);
      next();
    } catch (e) {
      next(e);
    }
  };

  // Signature-verified webhook handlers must see exact request bytes before JSON parsing.
  for (const r of opts.extraRouters ?? []) {
    if (r.beforeJson) {
      if (r.auth) app.use(r.path, auth, r.router);
      else app.use(r.path, r.router);
    }
  }
  app.use(express.json({ limit: '64kb' }));

  app.post(
    '/v1/offers/search',
    auth,
    asyncH(async (req, res) => {
      const body = SearchOffersRequest.parse(req.body);
      res.json({ offers: await core.searchOffers(req.actor!, body.intent) });
    }),
  );

  app.post(
    '/v1/quotes',
    auth,
    asyncH(async (req, res) => {
      const body = CreateQuoteRequest.parse(req.body);
      res.status(201).json({ quote: await core.createQuote(req.actor!, body.offerId, body.fulfillment) });
    }),
  );

  app.get(
    '/v1/quotes/:id',
    auth,
    asyncH((req, res) => {
      res.json({ quote: core.getQuote(req.actor!, String(req.params.id)) });
    }),
  );

  app.post(
    '/v1/purchases',
    auth,
    asyncH(async (req, res) => {
      const body = CreatePurchaseRequest.parse(req.body);
      const r = await core.createPurchase(req.actor!, body, req.header('idempotency-key'));
      res.status(r.status).json({ purchase: r.purchase });
    }),
  );

  app.post(
    '/v1/purchases/:id/fund',
    auth,
    asyncH(async (req, res) => {
      const id = String(req.params.id);
      const adapterHeader = core.paymentHeaderName(id, req.actor!);
      const r = await core.fundPurchase(req.actor!, id, req.header(adapterHeader) ?? undefined);
      if (r.kind === 'payment_required') {
        const encoded = Buffer.from(JSON.stringify(r.requirements)).toString('base64');
        res.setHeader('PAYMENT-REQUIRED', encoded);
        res.status(402).json({ ...r.requirements, purchase: r.purchase });
        return;
      }
      if (r.settlementHeader) res.setHeader(r.settlementHeader.name, r.settlementHeader.value);
      res.status(202).json({ purchase: r.purchase });
    }),
  );

  app.get(
    '/v1/purchases/:id',
    auth,
    asyncH((req, res) => {
      res.json({ purchase: core.getPurchase(req.actor!, String(req.params.id)) });
    }),
  );

  app.get(
    '/v1/purchases/:id/events',
    auth,
    asyncH((req, res) => {
      res.json({ events: core.purchaseEvents(req.actor!, String(req.params.id)) });
    }),
  );

  for (const r of opts.extraRouters ?? []) {
    if (r.beforeJson) continue;
    if (r.auth) app.use(r.path, auth, r.router);
    else app.use(r.path, r.router);
  }

  app.use((req, _res, next) => next(new CoreError('not_found', `no route ${req.method} ${req.path}`)));

  // One error shape for everything.
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId ?? randomUUID();
    let body: ErrorBody;
    let status: number;
    if (err instanceof CoreError) {
      status = err.status;
      body = { error: { code: err.code, message: err.message, requestId, ...(err.details ? { details: redact(err.details) } : {}) } };
    } else if (err instanceof ZodError) {
      status = 400;
      body = {
        error: {
          code: 'invalid_request',
          message: 'request validation failed',
          requestId,
          details: { issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
        },
      };
    } else if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.parse.failed') {
      status = 400;
      body = { error: { code: 'invalid_request', message: 'malformed JSON', requestId } };
    } else if (err && typeof err === 'object' && 'type' in err && (err as { type: string }).type === 'entity.too.large') {
      status = 413;
      body = { error: { code: 'invalid_request', message: 'request too large', requestId } };
    } else if (err && typeof err === 'object' && 'type' in err && ['encoding.unsupported','charset.unsupported'].includes(String(err.type))) {
      status = 415;
      body = {error:{code:'invalid_request',message:'unsupported request encoding',requestId}};
    } else {
      status = 500;
      body = { error: { code: 'internal', message: 'internal error', requestId } };
      log({ requestId, level: 'error', error: String(redact((err as Error)?.stack ?? err)) });
    }
    res.status(status).json(body);
  });

  return app;
}
