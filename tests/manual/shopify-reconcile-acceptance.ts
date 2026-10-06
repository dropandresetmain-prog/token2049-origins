/** Read-only Shopify order lookup plus core reconciliation for one existing paid sandbox attempt.
 * node --env-file=.env --import tsx tests/manual/shopify-reconcile-acceptance.ts artifacts/e2e/<run> --reconcile-only
 * Never creates a quote/purchase, funds, opens checkout or calls the executor's execute method.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Page } from 'playwright-core';
import { Pool } from 'pg';
import { CommerceCore } from '../../src/core/service.js';
import { Worker } from '../../src/core/worker.js';
import { trialBalance } from '../../src/core/journal.js';
import { Db } from '../../src/infrastructure/db.js';
import { loadCoreEnv, toCoreConfig } from '../../src/infrastructure/config.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { systemClock } from '../../src/infrastructure/clock.js';
import { createHttpApp } from '../../src/channels/http/app.js';
import { createEvidenceRouter } from '../../src/evidence/router.js';
import { createProofPageRouter } from '../../src/evidence/proof-page.js';
import { getPurchaseRow, getQuoteRow } from '../../src/core/store.js';
import { PurchaseProof } from '../../src/evidence/proof.js';
import { AdminClient } from '../../src/execution/shopify/admin.js';
import { hasPaidTestEvidence, ShopifyExecutor } from '../../src/execution/shopify/index.js';
import { loadShopifyConfig } from '../../src/execution/shopify/config.js';
import type { ExecutionContext, ExecutionResult } from '../../src/contracts/ports.js';
import type { QuoteView } from '../../src/contracts/commerce.js';

const artifactArg = process.argv[2];
if (!artifactArg || process.argv.length !== 4 || process.argv[3] !== '--reconcile-only') throw new Error('explicit_reconcile_only_required');
const artifactRoot = path.resolve('artifacts/e2e');
const outDir = path.resolve(artifactArg);
if (!outDir.startsWith(artifactRoot + path.sep) || !fs.statSync(outDir).isDirectory()) throw new Error('artifact_directory_required');
const verificationPath = path.join(outDir, '06-reconciliation-verification.json');
if (fs.existsSync(verificationPath)) throw new Error('reconciliation_artifact_exists');
const sameMoney = (a: { currency: string; scale: number; amountMinor: string }, b: { currency: string; scale: number; amountMinor: string }) =>
  a.currency === b.currency && a.scale === b.scale && a.amountMinor === b.amountMinor;

const manifest = JSON.parse(fs.readFileSync(path.join(outDir, '01-manifest.json'), 'utf8')) as Record<string, unknown>;
const prior = JSON.parse(fs.readFileSync(path.join(outDir, '03-execution-result.json'), 'utf8')) as Record<string, unknown>;
const runId = manifest.runId;
const schema = manifest.schema;
const purchaseId = prior.purchaseId;
const expectedConfirmation = prior.providerReference;
if (typeof runId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runId) ||
    schema !== 'shopify_accept_' + runId.replaceAll('-', '') || !/^shopify_accept_[a-f0-9]{32}$/.test(String(schema)) ||
    prior.schema !== schema || typeof purchaseId !== 'string' || !/^pur_[0-9A-Z]{26}$/.test(purchaseId) ||
    !['unresolved','succeeded'].includes(String(prior.state)) || typeof expectedConfirmation !== 'string' || !/^[A-Z0-9]{6,12}$/.test(expectedConfirmation) ||
    !Array.isArray(prior.checkpointNames) || !prior.checkpointNames.includes('pay_click') || !prior.checkpointNames.includes('order') ||
    manifest.fundingMode !== 'local_fixture' || manifest.shopifyMode !== 'real_bogus_sandbox' || manifest.storeHost !== 'token2049-test-store.myshopify.com' || manifest.cardanoTransaction !== false)
  throw new Error('existing_attempt_artifact_mismatch');

if (process.env.APP_ENV !== 'sandbox' || Object.keys(process.env).some(k => /^(CARDANO_|PAYER_|BLOCKFROST_|SOLANA_)/.test(k) && process.env[k])) throw new Error('sandbox_funding_guard');
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname)) throw new Error('loopback_database_required');
const providerEnv: NodeJS.ProcessEnv = { APP_ENV: 'sandbox' };
for (const key of ['SHOPIFY_STORE_DOMAIN','SHOPIFY_API_VERSION','SHOPIFY_STOREFRONT_TOKEN','SHOPIFY_STOREFRONT_PRIVATE_TOKEN','SHOPIFY_STOREFRONT_BUYER_IP',
  'SHOPIFY_CLIENT_ID','SHOPIFY_CLIENT_SECRET','SHOPIFY_STORE_PASSWORD','SHOPIFY_DEV_STORE_CONFIRMED','SHOPIFY_BOGUS_GATEWAY_ENABLED']) {
  if (process.env[key]) providerEnv[key] = process.env[key];
}
const configReport = loadShopifyConfig(providerEnv);
const cfg = configReport.config;
if (cfg.storeDomain !== 'token2049-test-store.myshopify.com' || !configReport.buyerReady || !configReport.adminReady || configReport.invalid.length ||
    !cfg.devStoreConfirmed || !cfg.bogusGatewayEnabled) throw new Error('shopify_sandbox_admin_guard');

let adminReadCalls = 0;
let executeCalls = 0;
const denied = async (): Promise<never> => { throw new Error('reconciliation_only_external_action_forbidden'); };
const readOnlyShopifyFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname !== cfg.storeDomain) throw new Error('reconciliation_network_boundary');
  if (url.pathname === '/admin/oauth/access_token') {
    if (init?.method !== 'POST' || typeof init.body !== 'string' || !init.body.includes('grant_type=client_credentials')) throw new Error('reconciliation_token_boundary');
    return fetch(input, init);
  }
  if (url.pathname !== `/admin/api/${cfg.apiVersion}/graphql.json` || init?.method !== 'POST' || typeof init.body !== 'string') throw new Error('reconciliation_network_boundary');
  const body = JSON.parse(init.body) as { query?: unknown };
  if (typeof body.query !== 'string' || !/^\s*query\s+Orders?\b/.test(body.query) || /\bmutation\b/i.test(body.query)) throw new Error('reconciliation_graphql_boundary');
  adminReadCalls++;
  return fetch(input, init);
};
const adminClient = new AdminClient(cfg, readOnlyShopifyFetch, systemClock);
class ReconciliationOnlyShopifyExecutor extends ShopifyExecutor {
  override execute(_ctx: ExecutionContext): Promise<ExecutionResult> {
    executeCalls++;
    return denied();
  }
  override quote(..._args: Parameters<ShopifyExecutor['quote']>): ReturnType<ShopifyExecutor['quote']> { return denied(); }
}
// No dependency overrides: ShopifyExecutor must retain fresh_external evidence semantics.
// Its quote/execute entry points are disabled; reconciliation uses only retrieve()'s Admin read.
const executor = new ReconciliationOnlyShopifyExecutor(providerEnv, { fetchImpl: readOnlyShopifyFetch });

const coreEnv = loadCoreEnv({ ...process.env, APP_ENV: 'test', DATABASE_URL: databaseUrl, PUBLIC_BASE_URL: 'http://127.0.0.1:8787', SERVICE_FEE_BPS: '0' });
const db = new Db(databaseUrl, String(schema));
const core = new CommerceCore({ db, clock: systemClock, config: toCoreConfig(coreEnv), executors: new Map([['shopify', executor]]), fundingAdapters: new Map(), bankAdapters: [] });
const worker = new Worker(core);
const app = createHttpApp({ core, extraRouters: [
  { path: '/v1/evidence', router: createEvidenceRouter({ db, clock: systemClock, bankAdapters: [] }), auth: true },
  { path: '/proof', router: createProofPageRouter(), auth: false },
] });
let server: Server | undefined;
let phase = 'preflight';
let proofUi: Record<string, boolean> | null = null;

try {
  const adminPool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const schemaResult = await adminPool.query<{ namespace: string | null }>('SELECT to_regnamespace($1)::text AS namespace', [schema]);
    if (!schemaResult.rows[0]?.namespace) throw new Error('existing_acceptance_schema_missing');
  } finally { await adminPool.end(); }

  const purchases = await db.all<{ id: string; state: string; quote_id: string; provider_reference: string | null }>('SELECT id,state,quote_id,provider_reference FROM purchases');
  if (purchases.length !== 1 || purchases[0]!.id !== purchaseId || !['executing','unresolved','succeeded'].includes(purchases[0]!.state) ||
      ![expectedConfirmation,'gid://shopify/Order/'].some(value => purchases[0]!.provider_reference?.startsWith(value)))
    throw new Error('target_purchase_state_mismatch');
  const purchase = (await getPurchaseRow(db, purchaseId))!;
  const quoteRow = (await getQuoteRow(db, purchase.quote_id))!;
  if (quoteRow.route !== 'shopify' || quoteRow.provider_environment !== 'test') throw new Error('target_quote_route_mismatch');
  const quote = JSON.parse(quoteRow.public_json) as QuoteView;
  const executionRef = JSON.parse(quoteRow.execution_ref_json) as { nonce?: unknown };
  if (typeof executionRef.nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(executionRef.nonce)) throw new Error('target_quote_nonce_missing');

  const counts = await db.get<{ purchases: number; funding: number; attempts: number; executeJobs: number; receipts: number }>(
    "SELECT (SELECT COUNT(*)::int FROM purchases) AS purchases,(SELECT COUNT(*)::int FROM funding_evidence WHERE purchase_id=$1) AS funding,(SELECT COUNT(*)::int FROM execution_attempts WHERE purchase_id=$1) AS attempts,(SELECT COUNT(*)::int FROM jobs WHERE purchase_id=$1 AND kind='execute_purchase') AS \"executeJobs\",(SELECT COUNT(*)::int FROM purchases WHERE id=$1 AND receipt_json IS NOT NULL) AS receipts",
    purchaseId);
  const fundingEvidence = await db.all<{ application: string; payment_state: string; evidence_mode: string }>('SELECT application,payment_state,evidence_mode FROM funding_evidence WHERE purchase_id=$1', purchaseId);
  const attempt = await db.get<{ id: string; attempt_no: number; status: string; checkpoints_json: string }>('SELECT id,attempt_no,status,checkpoints_json FROM execution_attempts WHERE purchase_id=$1 ORDER BY attempt_no DESC LIMIT 1', purchaseId);
  const executeJob = await db.get<{ status: string }>("SELECT status FROM jobs WHERE purchase_id=$1 AND kind='execute_purchase'", purchaseId);
  const reservation = await db.get<{ status: string }>('SELECT status FROM reservations WHERE purchase_id=$1', purchaseId);
  const jobs = await db.all<{ id: string; kind: string; purchase_id: string; status: string; run_after: string }>('SELECT id,kind,purchase_id,status,run_after FROM jobs ORDER BY created_at,id');
  const checkpoints = attempt ? JSON.parse(attempt.checkpoints_json) as Record<string, { providerReference?: string }> : {};
  const pendingFunding = await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM funding_attempts WHERE status='pending'");
  const unresolved = purchases[0]!.state !== 'succeeded';
  const pendingJobs = jobs.filter(j => j.status === 'pending');
  const checkpointOrder = checkpoints.order?.providerReference ?? '';
  if (counts?.purchases !== 1 || counts.funding !== 1 || fundingEvidence.length !== 1 || fundingEvidence[0]!.application !== 'applied' || fundingEvidence[0]!.payment_state !== 'confirmed' || fundingEvidence[0]!.evidence_mode !== 'local_fixture' || counts.attempts !== 1 || counts.executeJobs !== 1 ||
      attempt?.attempt_no !== 1 || !checkpoints.pay_click || !(checkpointOrder === expectedConfirmation || /^gid:\/\/shopify\/Order\/\d+$/.test(checkpointOrder)) ||
      executeJob?.status !== 'done' || pendingFunding?.n !== 0 || jobs.some(j => j.status === 'claimed') || jobs.some(j => !['done','pending'].includes(j.status)) ||
      (unresolved ? counts.receipts !== 0 || !['unknown','started'].includes(attempt.status) || reservation?.status !== 'held_unresolved' || pendingJobs.length !== 1 || pendingJobs[0]?.kind !== 'reconcile_purchase' || pendingJobs[0]?.purchase_id !== purchaseId
        : counts.receipts !== 1 || attempt.status !== 'succeeded' || reservation?.status !== 'consumed' || pendingJobs.length !== 0))
    throw new Error('reconciliation_preflight_invariant_failed');

  // Verify the supplied confirmation reference, quote nonce, paid test status and exact total
  // before core reconciliation can change the unresolved purchase state.
  phase = 'read_only_order_reconciliation';
  const beforeOrders = await adminClient.searchOrders({ confirmationNumber: expectedConfirmation });
  const beforeBound = beforeOrders.filter(order => order.customAttributes.some(a => a.key === 't2o_quote' && a.value === executionRef.nonce));
  if (beforeBound.length !== 1 || beforeBound[0]!.confirmationNumber !== expectedConfirmation || !hasPaidTestEvidence(beforeBound[0]!, quote.merchantTotal))
    throw new Error('pre_reconciliation_paid_order_evidence_mismatch');
  const expectedOrderId = beforeBound[0]!.id;
  const expectedOrderName = beforeBound[0]!.name;

  let processed = 0;
  if (unresolved) {
    // Bring only the already-existing target reconciliation job due. Preflight constrains the
    // single worker tick to this job; the executor's execute/quote entry points are disabled.
    const reconcileJob = pendingJobs[0]!;
    await db.run("UPDATE jobs SET run_after=$1,updated_at=$1 WHERE id=$2 AND kind='reconcile_purchase' AND purchase_id=$3 AND status='pending'", systemClock.now().toISOString(), reconcileJob.id, purchaseId);
    processed = await worker.tick();
  }
  if ((unresolved && processed !== 1) || executeCalls !== 0 || adminReadCalls < 1) throw new Error('reconciliation_only_boundary_failed');

  phase = 'verify_database_and_proof';
  const reconciled = await db.get<{ state: string; provider_reference: string | null; merchant_payment_status: string | null; commerce_status: string; receipt_json: string | null }>(
    'SELECT state,provider_reference,merchant_payment_status,commerce_status,receipt_json FROM purchases WHERE id=$1', purchaseId);
  const afterCounts = await db.get<{ purchases: number; funding: number; attempts: number; executeJobs: number; receipts: number }>(
    "SELECT (SELECT COUNT(*)::int FROM purchases) AS purchases,(SELECT COUNT(*)::int FROM funding_evidence WHERE purchase_id=$1) AS funding,(SELECT COUNT(*)::int FROM execution_attempts WHERE purchase_id=$1) AS attempts,(SELECT COUNT(*)::int FROM jobs WHERE purchase_id=$1 AND kind='execute_purchase') AS \"executeJobs\",(SELECT COUNT(*)::int FROM purchases WHERE id=$1 AND receipt_json IS NOT NULL) AS receipts",
    purchaseId);
  const afterAttempt = await db.get<{ status: string; result_json: string | null; checkpoints_json: string }>('SELECT status,result_json,checkpoints_json FROM execution_attempts WHERE id=$1', attempt!.id);
  const afterExecuteJob = await db.get<{ status: string }>("SELECT status FROM jobs WHERE purchase_id=$1 AND kind='execute_purchase'", purchaseId);
  const afterReservation = await db.get<{ status: string }>('SELECT status FROM reservations WHERE purchase_id=$1', purchaseId);
  const balance = [...(await trialBalance(db)).entries()].map(([asset, net]) => ({ asset, net: net.toString() }));
  if (reconciled?.state !== 'succeeded' || reconciled.provider_reference !== expectedOrderId || reconciled.merchant_payment_status !== 'simulated_paid' ||
      afterCounts?.purchases !== 1 || afterCounts.funding !== 1 || afterCounts.attempts !== 1 || afterCounts.executeJobs !== 1 || afterCounts.receipts !== 1 ||
      afterAttempt?.status !== 'succeeded' || afterExecuteJob?.status !== 'done' || afterReservation?.status !== 'consumed' || balance.some(v => v.net !== '0'))
    throw new Error('reconciled_core_invariant_failed');
  const result = JSON.parse(afterAttempt.result_json ?? '{}') as { chargedAmount?: unknown; evidence?: Array<{ details?: { test?: unknown; financialStatus?: unknown } }> };
  if (!result.chargedAmount || !sameMoney(result.chargedAmount as QuoteView['merchantTotal'], quote.merchantTotal) || !result.evidence?.some(e => e.details?.test === true && e.details?.financialStatus === 'PAID'))
    throw new Error('reconciled_result_evidence_mismatch');

  const independent = await adminClient.searchOrders({ orderId: expectedOrderId });
  const bound = independent.filter(order => order.customAttributes.some(a => a.key === 't2o_quote' && a.value === executionRef.nonce));
  if (independent.length !== 1 || bound.length !== 1 || bound[0]!.id !== expectedOrderId || bound[0]!.name !== expectedOrderName || bound[0]!.confirmationNumber !== expectedConfirmation || !hasPaidTestEvidence(bound[0]!, quote.merchantTotal))
    throw new Error('independent_paid_order_evidence_mismatch');

  const apiClient = await createClient(db, { customerId: purchase.customer_id, displayName: 'Shopify reconciliation proof reader', channel: 'test', label: 'shopify-reconcile-proof', scopes: ['purchases:read','evidence:read'] }, systemClock.now().toISOString());
  server = await new Promise<Server>(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  const proofResponse = await fetch(base + '/v1/evidence/purchases/' + encodeURIComponent(purchaseId) + '/proof', { headers: { authorization: 'Bearer ' + apiClient.token }, redirect: 'error' });
  if (!proofResponse.ok) throw new Error('proof_api_read_failed');
  const proof = PurchaseProof.parse((await proofResponse.json() as { proof: unknown }).proof);
  if (proof.merchant.providerReference !== expectedOrderId || proof.funding.transfers.length !== 1 || proof.funding.transfers[0]!.evidenceMode !== 'local_fixture' || !proof.receipt || proof.receipt.receiptId !== JSON.parse(reconciled.receipt_json!).receiptId)
    throw new Error('proof_api_invariant_failed');

  if (process.env.SHOPIFY_BROWSER_EXECUTABLE) {
    const { chromium } = await import('playwright-core');
    const browser = await chromium.launch({ executablePath: process.env.SHOPIFY_BROWSER_EXECUTABLE, headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
    try {
      const page: Page = await browser.newPage();
      await page.goto(base + '/proof');
      await page.locator('#token').fill(apiClient.token);
      await page.getByRole('button', { name: 'Load purchases', exact: true }).click();
      await page.locator('#purchases button').filter({ hasText: purchaseId.slice(-6) }).click();
      await page.locator('#proof').waitFor({ state: 'visible' });
      const text = await page.locator('#proof').innerText();
      proofUi = { orderReference: text.includes(expectedOrderId), receiptId: text.includes(proof.receipt.receiptId), fixtureLabel: text.includes('local_fixture'), paymentProof: text.includes('Payment proof'), merchantResult: text.includes('Merchant result') };
      if (Object.values(proofUi).some(value => !value)) throw new Error('proof_ui_invariant_failed');
    } finally { await browser.close(); }
  }

  const evidence = {
    verdict: 'RECONCILIATION_PASS', overallE2E: 'PARTIAL', runId, schema, purchaseId, quoteId: quote.quoteId,
    expectedTotal: quote.merchantTotal, orderId: expectedOrderId, orderName: expectedOrderName, confirmationNumber: expectedConfirmation,
    nonceBoundSingleOrder: true, orderIsTest: bound[0]!.test, financialStatus: bound[0]!.displayFinancialStatus, coreReconciliationApplied: unresolved,
    paidTestEvidence: true, fundingEvidenceMode: 'local_fixture', fundingEvidenceCount: afterCounts!.funding,
    executionAttempts: afterCounts!.attempts, executeJobs: afterCounts!.executeJobs, receiptCount: afterCounts!.receipts,
    reservation: afterReservation!.status, balancedLedger: balance.every(v => v.net === '0'), ledgerEntries: balance,
    proofApi: true, proofUi, adminReadCalls, executeCalls, checkoutOrPayCalls: 0, cardanoTransaction: false,
    receiptId: proof.receipt.receiptId, evidenceMode: proof.merchant.evidenceMode,
  };
  fs.writeFileSync(verificationPath, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ phase: 'complete', verdict: evidence.verdict, purchaseId, orderId: expectedOrderId, receiptId: evidence.receiptId, proofUi: proofUi ? 'PASS' : 'SKIPPED_NO_BROWSER' }));
} finally {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  await db.close();
}
