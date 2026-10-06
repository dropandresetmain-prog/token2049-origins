/**
 * Evidence API: a redacted, read-only view of purchases, funding evidence, journal, treasury and bank
 * observations. Mounted by the composition root at `/v1/evidence` behind authentication
 * (`extraRouters: [{ path: '/v1/evidence', router, auth: true }]`), so `req.actor` is always set here.
 *
 * Rules:
 *  - Customer endpoints require `evidence:read` and are owner-scoped: an unknown purchase and another
 *    customer's purchase are indistinguishable (404).
 *  - Treasury and bank endpoints require the operator-only `operator:read` scope.
 *  - Every JSON body passes through redact(); the read model additionally omits fulfillment details, raw
 *    provider payloads, execution checkpoints and non-whitelisted funding details.
 *  - The only write is POST /bank/refresh, which INSERTs observation rows. It never touches the journal,
 *    reservations or capacity: an observation is not a settlement.
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { Db } from '../infrastructure/db.js';
import type { Clock } from '../infrastructure/clock.js';
import { iso } from '../infrastructure/clock.js';
import { newId } from '../infrastructure/ids.js';
import { redact, redactString } from '../infrastructure/redact.js';
import { CoreError } from '../core/errors.js';
import type { Scope } from '../contracts/common.js';
import { IsoTimestamp } from '../contracts/common.js';
import { Money } from '../contracts/money.js';
import type { BankObservationAdapter } from '../contracts/ports.js';
import { maskReference } from '../banking/ocbc/mask.js';
import { OCBC_APIS } from '../banking/ocbc/client.js';
import { latestBankObservations, listPurchases, loadOwnedPurchase, purchaseDetail, treasuryView } from './read-model.js';

export interface EvidenceRouterDeps {
  db: Db;
  clock: Clock;
  bankAdapters: BankObservationAdapter[];
}

/** Shape adapters must return; anything else is rejected rather than stored. */
const StoredObservation = z
  .object({
    kind: z.enum(['account_balance', 'card_summary', 'account_transaction', 'card_transaction']),
    maskedReference: z.string().max(64),
    currency: z.string().regex(/^[A-Z]{3}$/),
    amount: Money.nullable(),
    availableAmount: Money.nullable(),
    description: z.string().max(500).nullable(),
    observedAt: IsoTimestamp,
    providerTimestamp: IsoTimestamp.nullable(),
    environment: z.literal('sandbox'),
    source: z.enum([
      `ocbc:sandbox:${OCBC_APIS.accountListing.label}`,
      `ocbc:sandbox:${OCBC_APIS.accountTransactions.label}`,
      `ocbc:sandbox:${OCBC_APIS.creditCardList.label}`,
      `ocbc:sandbox:${OCBC_APIS.creditCardUnbilled.label}`,
    ]),
    caveats: z.array(z.string().max(500)).max(50),
  })
  .strict();

const PURCHASE_LIST_LIMIT = 50;

function actorOf(req: Request) {
  if (!req.actor) throw new CoreError('unauthenticated', 'bearer token required');
  return req.actor;
}

function requireScope(req: Request, scope: Scope) {
  const actor = actorOf(req);
  if (!actor.scopes.has(scope)) throw new CoreError('forbidden', `missing scope ${scope}`);
  return actor;
}

/** Every response body is redacted at the boundary, whatever the read model produced. */
function send(res: Response, body: unknown): void {
  res.json(redact(body));
}

export function createEvidenceRouter(deps: EvidenceRouterDeps): Router {
  const { db, clock, bankAdapters } = deps;
  const router = Router();
  let refreshing = false;

  router.get('/purchases', async (req, res) => {
    const actor = requireScope(req, 'evidence:read');
    send(res, { purchases: (await listPurchases(db, actor.customerId, PURCHASE_LIST_LIMIT)), limit: PURCHASE_LIST_LIMIT });
  });

  router.get('/purchases/:id', async (req, res) => {
    const actor = requireScope(req, 'evidence:read');
    const p = await loadOwnedPurchase(db, actor.customerId, String(req.params.id));
    // Foreign and nonexistent purchases are the same 404: no existence oracle.
    if (!p) throw new CoreError('not_found', 'purchase not found');
    send(res, (await purchaseDetail(db, p)));
  });

  router.get('/treasury', async (req, res) => {
    requireScope(req, 'operator:read');
    send(res, (await treasuryView(db)));
  });

  router.get('/bank', async (req, res) => {
    requireScope(req, 'operator:read');
    const adapters = [];
    for (const a of bankAdapters) adapters.push(await a.readiness());
    send(res, {
      note: 'Observations of external bank/card state. They are stored facts with provenance, separate from the gateway journal and from simulated card capacity; they do not show that any gateway purchase reached the bank.',
      adapters,
      observations: (await latestBankObservations(db)),
    });
  });

  router.post('/bank/refresh', async (req, res) => {
    requireScope(req, 'operator:read');
    if (refreshing) throw new CoreError('conflict', 'a bank observation refresh is already in progress');
    refreshing = true;
    try {
      const results: Array<{ bank: string; ok: boolean; inserted: number; rejected: number; error?: string }> = [];
      for (const adapter of bankAdapters) {
        try {
          const observed = await adapter.observe();
          let inserted = 0;
          let rejected = 0;
          await db.tx(async () => {
            for (const o of observed) {
              const parsed = StoredObservation.safeParse(o);
              if (!parsed.success) {
                rejected++;
                continue;
              }
              const v = parsed.data;
              await db.run(
                `INSERT INTO bank_observations(id, bank, kind, masked_reference, currency, amount_json, available_json, description, environment, source, provider_timestamp, observed_at, caveats_json)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
                newId('bob'),
                adapter.bank,
                v.kind,
                // Defence in depth: masked again here in case an adapter forgot.
                maskReference(v.maskedReference),
                v.currency,
                v.amount ? JSON.stringify(v.amount) : null,
                v.availableAmount ? JSON.stringify(v.availableAmount) : null,
                // Provider descriptions are free-form and may name people or merchants; do not retain them.
                null,
                v.environment,
                v.source,
                v.providerTimestamp,
                v.observedAt,
                JSON.stringify(v.caveats.map(redactString)),
              );
              inserted++;
            }
          });
          results.push({ bank: adapter.bank, ok: true, inserted, rejected });
        } catch (e) {
          // Adapter messages may include upstream or credential details. Keep the public failure generic.
          void e;
          results.push({ bank: adapter.bank, ok: false, inserted: 0, rejected: 0, error: 'observation failed' });
        }
      }
      send(res, { refreshedAt: iso(clock.now()), results });
    } finally {
      refreshing = false;
    }
  });

  return router;
}

/** Public /inspect shell. It contains no private facts; browser state comes from the authenticated API. */
export function createInspectRouter(): Router {
  const router = Router();
  const headers = (res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
  };

  router.get('/', (_req, res) => {
    headers(res);
    res.type('html').send(INSPECT_HTML);
  });
  router.get('/app.js', (_req, res) => {
    headers(res);
    res.type('application/javascript').send(INSPECT_SCRIPT);
  });
  return router;
}

const INSPECT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Commerce evidence</title>
  <style>
    :root { color-scheme: light dark; font: 16px/1.5 system-ui, sans-serif; }
    body { max-width: 860px; margin: 3rem auto; padding: 0 1rem; }
    form { display: flex; gap: .5rem; max-width: 40rem; }
    input { flex: 1; min-width: 0; padding: .6rem; }
    button { padding: .55rem .8rem; cursor: pointer; }
    #purchases { display: grid; gap: .4rem; margin: 1.5rem 0; }
    pre { overflow: auto; padding: 1rem; border: 1px solid #8888; border-radius: .5rem; }
    #status { min-height: 1.5em; }
  </style>
  <script src="/inspect/app.js" defer></script>
</head>
<body>
  <main>
    <h1>Commerce evidence</h1>
    <p>Enter a gateway bearer token with <code>evidence:read</code> to load this customer's purchase evidence. The token stays in this page's memory and is not saved.</p>
    <form id="auth">
      <label for="token">Bearer token</label>
      <input id="token" type="password" autocomplete="off" required>
      <button type="submit">Load purchases</button>
    </form>
    <p id="status" role="status" aria-live="polite"></p>
    <section aria-labelledby="purchases-heading">
      <h2 id="purchases-heading">Purchases</h2>
      <div id="purchases"></div>
    </section>
    <section aria-labelledby="detail-heading">
      <h2 id="detail-heading">Evidence detail</h2>
      <pre id="detail">Authenticate to load evidence.</pre>
    </section>
  </main>
</body>
</html>`;

const INSPECT_SCRIPT = `(() => {
  const form = document.getElementById('auth');
  const tokenInput = document.getElementById('token');
  const status = document.getElementById('status');
  const purchases = document.getElementById('purchases');
  const detail = document.getElementById('detail');
  let token = '';

  async function get(path) {
    const response = await fetch(path, { headers: { Authorization: 'Bearer ' + token } });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error?.message || 'Request failed (' + response.status + ').');
    return body;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    token = tokenInput.value;
    tokenInput.value = '';
    purchases.replaceChildren();
    detail.textContent = '';
    status.textContent = 'Loading…';
    try {
      const body = await get('/v1/evidence/purchases');
      for (const purchase of body.purchases || []) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = purchase.id + ' · ' + purchase.state;
        button.addEventListener('click', async () => {
          status.textContent = 'Loading evidence…';
          try {
            const evidence = await get('/v1/evidence/purchases/' + encodeURIComponent(purchase.id));
            detail.textContent = JSON.stringify(evidence, null, 2);
            status.textContent = '';
          } catch (error) {
            status.textContent = error instanceof Error ? error.message : 'Evidence could not be loaded.';
          }
        });
        purchases.append(button);
      }
      status.textContent = body.purchases?.length ? '' : 'No purchases are available for this customer.';
      if (!body.purchases?.length) token = '';
    } catch (error) {
      token = '';
      status.textContent = error instanceof Error ? error.message : 'Purchases could not be loaded.';
    }
  });
})();`;
