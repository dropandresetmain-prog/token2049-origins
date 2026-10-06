/** Test-only lane composition. No Cardano/Payer import, deployed fixture switch or mark-funded API.
 * node --env-file=<sandbox-env> --import tsx tests/manual/shopify-global-sandbox.ts <artifacts/e2e/run> --stop-before-pay
 * --allow-one-bogus-order is refused while any retained real Shopify attempt is unresolved.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { Db } from '../../src/infrastructure/db.js';
import { buildGateway } from '../../src/composition.js';
import { createClient, authenticate } from '../../src/infrastructure/auth.js';
import { systemClock } from '../../src/infrastructure/clock.js';
import { demoData } from '../../src/demo/config.js';
import { createGlobalSandboxExecutor } from '../../src/execution/shopify/globalSandbox.js';
import { loadShopifyConfig } from '../../src/execution/shopify/config.js';
import { SANDBOX_STORE } from '../../src/execution/shopify/shadowAdmin.js';
import { AdminClient } from '../../src/execution/shopify/admin.js';
import { hasPaidTestEvidence } from '../../src/execution/shopify/index.js';
import { FixtureFundingAdapter } from '../support/fixtures.js';
import { getPurchaseRow } from '../../src/core/store.js';
import { purchaseProof } from '../../src/evidence/proof.js';
import { trialBalance } from '../../src/core/journal.js';
import { ProviderError, CoreError } from '../../src/core/errors.js';
import type { Page } from 'playwright-core';

const output = process.argv[2];
const stopBeforePay = process.argv.includes('--stop-before-pay');
const allowPay = process.argv.includes('--allow-one-bogus-order');
const resume = process.argv.includes('--resume-before-pay');
if (resume && !stopBeforePay) throw new Error('resume_is_preparation_only');
if (!output || stopBeforePay === allowPay) throw new Error('choose_one_explicit_boundary');
const outDir = path.resolve(output), root = path.resolve('artifacts/e2e');
if (!outDir.startsWith(root + path.sep)) throw new Error('artifact_directory_required');
if (process.env.APP_ENV !== 'sandbox' || Object.keys(process.env).some(k => /^(CARDANO_|PAYER_|BLOCKFROST_|SOLANA_)/.test(k) && process.env[k])) throw new Error('funding_environment_guard');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname)) throw new Error('loopback_database_required');
const report = loadShopifyConfig(process.env), cfg = report.config;
if (cfg.storeDomain !== SANDBOX_STORE || report.invalid.length || !report.buyerReady || !report.adminReady || !cfg.devStoreConfirmed || !cfg.bogusGatewayEnabled || !cfg.browserExecutable || !process.env.SHOPIFY_SANDBOX_PUBLICATION_ID) throw new Error('controlled_shopify_guard');
fs.mkdirSync(outDir, { recursive: true });
const schema = resume ? JSON.parse(fs.readFileSync(path.join(outDir, '01-manifest.json'), 'utf8')).schema as string : 'shopify_global_' + randomUUID().replaceAll('-', '');
if (!/^shopify_global_[a-f0-9]{32}$/.test(schema)) throw new Error('invalid_owned_schema');
if (!resume) fs.writeFileSync(path.join(outDir, '01-manifest.json'), JSON.stringify({ schema, startedAt: new Date().toISOString(), store: cfg.storeDomain, fundingMode: 'local_fixture', cardanoTransaction: false, stopBeforePay }, null, 2), { flag: 'wx' });
const emit = (kind: string, data: Record<string, unknown>) => {
  const event = { at: new Date().toISOString(), kind, ...data };
  fs.appendFileSync(path.join(outDir, '02-events.jsonl'), JSON.stringify(event) + '\n'); console.log(JSON.stringify(event));
};
const pool = new Pool({ connectionString: databaseUrl, max: 1 });
try {
  // Read-only audit across retained acceptance schemas. An ambiguous Pay stops all new paid tests.
  const schemas = await pool.query<{ table_schema: string }>("SELECT table_schema FROM information_schema.tables WHERE table_name='purchases'");
  let unresolved = 0;
  for (const row of schemas.rows) {
    if (!/^[a-z][a-z0-9_]*$/.test(row.table_schema)) throw new Error('untrusted_schema');
    const result = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "${row.table_schema}".purchases p JOIN "${row.table_schema}".quotes q ON q.id=p.quote_id WHERE q.route='shopify' AND q.provider_environment='test' AND p.state IN ('executing','unresolved')`);
    unresolved += result.rows[0]!.n;
  }
  emit('prior_attempt_guard', { unresolvedRealShopifyPurchases: unresolved, paymentAllowed: allowPay && unresolved === 0 });
  if (allowPay && unresolved) throw new Error('prior_shopify_outcome_ambiguous');
  if (!resume) await pool.query('CREATE SCHEMA "' + schema + '"');
} finally { await pool.end(); }
const db = new Db(databaseUrl, schema);
let phase = 'initialization', cartRequests = 0;
const observedFetch: typeof fetch = async (url, init) => {
  // The HTTP adapter may contact only Shopify's global catalog or our controlled store.
  const destination = new URL(String(url));
  if (!['catalog.shopify.com', cfg.storeDomain].includes(destination.hostname)) throw new Error('source_merchant_transport_forbidden');
  const body = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : null;
  if (/mutation CartCreate\b/.test(body?.query ?? '') && ++cartRequests > 1) throw new Error('one_cart_per_invocation');
  return fetch(url, init);
};
try {
  let checkoutPage: Page | undefined;
  const executor = createGlobalSandboxExecutor(process.env, () => db, { fetchImpl: observedFetch, sink: step => emit('checkout_step', { phase, step }),
    checkoutObserver: { attach: page => { checkoutPage = page; }, stepFailed: async step => {
      if (!checkoutPage) return;
      const text = await checkoutPage.locator('body').innerText();
      // Only standalone summary labels and money tokens; never persist customer text or URLs.
      const tokens = text.split('\n').map(line => line.trim()).filter(line => /^(?:Subtotal|Shipping|Total|Tax|Taxes|Total tax|USD|Free|Standard|\$[\d,.]+)$/i.test(line));
      emit('checkout_summary_diagnostic', { step, tokens, pending: /calculating|calculated at (?:the )?next step|estimated taxes/i.test(text) });
    } },
  });
  const funding = new FixtureFundingAdapter(systemClock);
  const gw = await buildGateway({ executors: [executor], fundingAdapters: [funding], bankAdapters: [] }, { db,
    env: { APP_ENV: 'test', DATABASE_URL: databaseUrl, PUBLIC_BASE_URL: 'http://127.0.0.1:8787', SERVICE_FEE_BPS: '0' } });
  const prior = resume ? await db.get<{ customer_id: string; public_json: string }>('SELECT customer_id,public_json FROM offers ORDER BY created_at LIMIT 1') : undefined;
  if (resume && !prior) throw new Error('prior_selection_required');
  const client = await createClient(db, { ...(prior ? { customerId: prior.customer_id } : {}), displayName: 'Synthetic global sandbox judge', channel: 'test', label: 'global-sandbox' }, new Date().toISOString());
  const actor = await authenticate(db, 'Bearer ' + client.token, randomUUID());
  const constraints = demoData.retailJudgeSandbox;
  const intent = { category: 'retail', discovery: 'live', query: constraints.query, quantity: constraints.quantity,
    shipToCountry: constraints.shipToCountry, spendCeiling: { currency: constraints.currency, amountMinor: constraints.maxCommercialMinor, scale: 2 } };
  phase = 'discovery';
  const offers = prior ? [JSON.parse(prior.public_json) as import('../../src/contracts/commerce.js').OfferView] : await gw.core.searchOffers(actor, intent);
  const selected = offers.find(o => o.sourceOffer?.availability === 'available' && o.sourceOffer.observedPrice.currency === 'USD');
  if (!selected?.sourceOffer) throw new Error('no_available_usd_offer');
  // Store only the selected transaction's reduced provenance, never raw Catalog payloads/images.
  emit('source_selected', { offerId: selected.offerId, sourceOffer: selected.sourceOffer });
  phase = 'shadow_and_quote';
  const quote = await gw.core.createQuote(actor, selected.offerId, { category: 'retail', ...demoData.buyer });
  const repeated = await gw.core.createQuote(actor, selected.offerId, { category: 'retail', ...demoData.buyer });
  if (quote.quoteId !== repeated.quoteId || quote.digest !== repeated.digest) throw new Error('duplicate_quote');
  const privateQuote = await db.get<{ execution_ref_json: string }>('SELECT execution_ref_json FROM quotes WHERE id=$1', quote.quoteId);
  const ref = JSON.parse(privateQuote!.execution_ref_json);
  emit('exact_sandbox_quote', { quoteId: quote.quoteId, digest: quote.digest, sourceOffer: quote.sourceOffer, sandboxRepresentation: quote.sandboxRepresentation,
    breakdown: quote.breakdown, total: quote.merchantTotal, cartId: String(ref.cartId).split('?')[0], cartRequests, repeatedQuoteSame: true,
    authorization: 'NOT_YET_SUBMITTED', funding: 'NOT_RUN', sandboxPayment: 'NOT_RUN' });
  if (stopBeforePay) {
    emit('verdict', { discovery: 'PASS', shadowProduct: 'PASS', sandboxExecution: 'NOT_RUN', overall: 'PARTIAL', boundary: 'STOPPED_BEFORE_FUNDING_OR_PAY' });
  } else {
    phase = 'approval';
    if (quote.fundingOptions.length !== 1 || !quote.fundingOptions[0]?.fundingOptionId) throw new Error('fixture_funding_requirement');
    const requirement = quote.fundingOptions[0];
    const request = { quoteId: quote.quoteId, approval: { maxTotal: quote.payablePrincipal, quoteDigest: quote.digest, selectedFundingOptionId: requirement.fundingOptionId! } };
    const creation = await gw.core.createPurchase(actor, request, 'global-sandbox-' + schema);
    const id = creation.purchase.purchaseId;
    phase = 'fixture_funding';
    await gw.core.fundPurchase(actor, id, 'fixture:global-local-' + schema + ':' + requirement.amount.amountBaseUnits);
    phase = 'one_sandbox_execution'; await gw.worker.tick();
    const purchase = await gw.core.getPurchase(actor, id);
    emit('execution_result', { purchaseId: id, state: purchase.state, providerReference: purchase.providerReference, fundingEvidenceMode: 'local_fixture' });
    if (purchase.state !== 'succeeded') throw new Error('STOP_ambiguous_or_failed_no_execution_retry');
    const orders = await new AdminClient(cfg, fetch, systemClock).searchOrders({ orderId: purchase.providerReference! });
    if (orders.length !== 1 || !hasPaidTestEvidence(orders[0]!, quote.merchantTotal) || !orders[0]!.customAttributes.some(a => a.key === 't2o_quote' && a.value === ref.nonce)) throw new Error('STOP_admin_readback_mismatch');
    const proof = await purchaseProof(db, (await getPurchaseRow(db, id))!);
    if (!proof.sourceOffer || !proof.sandboxExecution || proof.funding.transfers.some(f => f.evidenceMode !== 'local_fixture') || !proof.receipt) throw new Error('STOP_proof_boundary_mismatch');
    const balance = await trialBalance(db); if ([...balance.values()].some(v => v !== 0n)) throw new Error('STOP_unbalanced');
    const duplicate = await gw.core.createPurchase(actor, request, 'global-sandbox-' + schema); if (duplicate.purchase.purchaseId !== id) throw new Error('STOP_duplicate_purchase');
    emit('independent_admin', { orderId: orders[0]!.id, orderReference: orders[0]!.name, test: orders[0]!.test, financialStatus: orders[0]!.displayFinancialStatus,
      receiptId: proof.receipt.receiptId, sourceOffer: proof.sourceOffer, sandboxExecution: proof.sandboxExecution, fundingMode: 'local_fixture', cardanoTransaction: false });
    emit('verdict', { discovery: 'PASS', shadowProduct: 'PASS', sandboxExecution: 'PASS', overall: 'PASS', funding: 'local_fixture' });
  }
} catch (error) {
  const code = error instanceof ProviderError ? error.providerCode : error instanceof CoreError ? error.code : error instanceof Error && /^[a-zA-Z0-9_]+$/.test(error.message) ? error.message : error instanceof Error ? error.name : 'unknown';
  emit('stopped', { phase, code, ...(error instanceof ProviderError ? { diagnostic: error.message } : {}), noPaymentRetry: true, cartRequests, schema }); process.exitCode = 1;
} finally { await db.close(); }
