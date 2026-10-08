/** Explicit one-purchase acceptance. Keeps its private run manifest/schema for same-purchase recovery. */
import { loadEnvFile } from 'node:process';
import { existsSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { buildGateway } from '../../src/composition.js';
import { Db } from '../../src/infrastructure/db.js';
import { createClient } from '../../src/infrastructure/auth.js';
import { demoData } from '../../src/demo/config.js';
import { ShopifyExecutor, hasPaidTestEvidence } from '../../src/execution/shopify/index.js';
import { loadShopifyConfig } from '../../src/execution/shopify/config.js';
import { AdminClient } from '../../src/execution/shopify/admin.js';
import { createSuiFundingAdapter } from '../../src/funding/sui/adapter.js';
import { SuiRpc, suiClient } from '../../src/funding/sui/rpc.js';
import { USDC_TYPE, SUI_TYPE } from '../../src/funding/sui/config.js';
import { loadSuiPayerConfig } from '../../clients/sui/config.js';
import { SuiLedger } from '../../clients/sui/ledger.js';
import { createEvidenceRouter } from '../../src/evidence/router.js';
import { PurchaseView } from '../../src/contracts/commerce.js';
import { systemClock } from '../../src/infrastructure/clock.js';
import { PurchaseProof } from '../../src/evidence/proof.js';
import { trialBalance } from '../../src/core/journal.js';

const privateEnv = process.argv[2], mode = process.argv[3];
if (!privateEnv || !['--preflight', '--execute'].includes(mode ?? '')) throw new Error('private Sui env file and --preflight or --execute required');
loadEnvFile('C:/Dev/token2049-origins/.env.local'); loadEnvFile(privateEnv);
const cfg = loadSuiPayerConfig(process.env), report = loadShopifyConfig(process.env);
if (report.config.storeDomain !== 'token2049-test-store.myshopify.com' || !report.buyerReady || !report.adminReady || report.invalid.length ||
    !report.config.devStoreConfirmed || !report.config.bogusGatewayEnabled || !report.config.browserExecutable) throw new Error('controlled Shopify sandbox configuration unavailable');
const shopifyEnv: NodeJS.ProcessEnv = {};
for (const [k, v] of Object.entries(process.env)) if (k.startsWith('SHOPIFY_')) shopifyEnv[k] = v;
const shopify = new ShopifyExecutor(shopifyEnv, { sink: () => {} }), adapter = createSuiFundingAdapter(process.env);
const client = suiClient(), rpc = new SuiRpc(client);
// The isolated signer receives its own rail configuration, never merchant/admin credentials.
const payerEnv: NodeJS.ProcessEnv = {};
for (const [key, value] of Object.entries(process.env)) {
  if ((key.startsWith('SUI_') && !key.startsWith('SUI_E2E_')) || ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR'].includes(key)) payerEnv[key] = value;
}
const intent = { category: 'retail' as const, query: demoData.retail.query, quantity: 1, shipToCountry: 'US',
  spendCeiling: { currency: 'USD', amountMinor: cfg.maxCommercial.toString(), scale: 2 } };
const readiness = await adapter.readiness();
if (readiness.status !== 'EXTERNAL_CHECK_PASSED') throw new Error('Sui external readiness failed');
if (mode === '--preflight') {
  const offers = await shopify.search(intent);
  console.log(JSON.stringify({ status: 'PREFLIGHT_PASS', sui: readiness.status, provider: 'shopify', providerEnvironment: shopify.environment, offerCount: offers.length,
    payer: cfg.payer, treasury: cfg.payee, purchaseExecuted: false }));
  process.exit(0);
}
const directory = dirname(cfg.ledger), manifestPath = process.env.SUI_E2E_RUN_MANIFEST ?? join(directory, 'live-run.json');
if (!isAbsolute(manifestPath) || resolve(dirname(manifestPath)) !== resolve(directory)) throw new Error('acceptance manifest must stay in protected payer directory');
type Manifest = { version: 1; schema: string; clientId?: string; customerId?: string; purchaseId?: string; phase: string; createdAt: string };
const persist = (value: Manifest) => {
  const tmp = manifestPath + '.tmp', fd = openSync(tmp, 'wx', 0o600);
  try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(tmp, manifestPath);
};
let manifest: Manifest;
if (existsSync(manifestPath)) manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
else {
  const [tokens, gas] = await Promise.all([client.getBalance({ owner: cfg.payer, coinType: USDC_TYPE }), client.getBalance({ owner: cfg.payer, coinType: SUI_TYPE })]);
  if (BigInt(tokens.balance.balance) < cfg.policy.maxPerPayment || BigInt(gas.balance.balance) < cfg.maxGasBudget) throw new Error('dedicated wallet requires faucet funds before purchase creation');
  manifest = { version: 1, schema: 'sui_e2e_' + randomUUID().replaceAll('-', ''), phase: 'initialized', createdAt: new Date().toISOString() };
  writeFileSync(manifestPath, JSON.stringify(manifest), { flag: 'wx', mode: 0o600 });
}
if (manifest.version !== 1 || !/^sui_e2e_[a-f0-9]{32}$/.test(manifest.schema)) throw new Error('invalid retained Sui run manifest');
// Explicit loopback DB only. Keep its schema instead of deleting acceptance/recovery evidence.
const databaseUrl = process.env.SUI_E2E_DATABASE_URL;
if (!databaseUrl) throw new Error('dedicated SUI_E2E_DATABASE_URL required');
if (!['127.0.0.1', 'localhost'].includes(new URL(databaseUrl).hostname)) throw new Error('loopback E2E database required');
const admin = new Pool({ connectionString: databaseUrl, max: 1 }); await admin.query(`CREATE SCHEMA IF NOT EXISTS "${manifest.schema}"`);
const db = new Db(databaseUrl, manifest.schema), gateway = await buildGateway({ executors: [shopify], fundingAdapters: [adapter], bankAdapters: [],
  buildRouters: core => [{ path: '/v1/evidence', router: createEvidenceRouter({ db: core.deps.db, clock: core.deps.clock, bankAdapters: [] }), auth: true }],
}, { db, env: { APP_ENV: 'sandbox', DATABASE_URL: databaseUrl, PUBLIC_BASE_URL: cfg.gatewayUrl, QUOTE_TTL_SECONDS: '900', SERVICE_FEE_BPS: '0',
  DEMO_PER_PURCHASE_LIMIT_USD_MINOR: cfg.maxCommercial.toString(), SIMULATED_CARD_CAPACITY_USD_MINOR: cfg.maxCommercial.toString() }, log: () => {} });
gateway.core.deps.config.settlementPolicy = demoData.settlementPolicy;
const server = await new Promise<import('node:http').Server>(resolveServer => {
  const s = gateway.app.listen(Number(new URL(cfg.gatewayUrl).port), '127.0.0.1', () => resolveServer(s));
});
if (!manifest.clientId) {
  if (existsSync(cfg.tokenFile)) throw new Error('gateway token exists without retained client identity; reconcile setup');
  const c = await createClient(db, { displayName: 'Sui controlled sandbox buyer', channel: 'test', label: 'sui-live-e2e' }, new Date().toISOString());
  writeFileSync(cfg.tokenFile, c.token, { flag: 'wx', mode: 0o600 });
  manifest = { ...manifest, clientId: c.clientId, customerId: c.customerId, phase: 'client_ready' }; persist(manifest);
}
const token = readFileSync(cfg.tokenFile, 'utf8').trim();
const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
  const r = await fetch(cfg.gatewayUrl + path, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}), ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(180000) });
  const data = await r.json() as any;
  if (!r.ok) throw new Error(`gateway_${r.status}_${data.error?.code ?? 'unknown'}`);
  return data;
};
const evidence: Record<string, unknown> = { timestamp: new Date().toISOString(), schema: manifest.schema, status: 'PARTIAL',
    provider: 'shopify', providerEnvironment: shopify.environment, settlementPolicy: demoData.settlementPolicy, onChainPurchaseCommitment: false,
    onChainQuoteExpiry: false, quoteExpiryEnforcement: 'payer_signed_application_binding_and_gateway_preflight' };
try {
  if (!manifest.purchaseId) {
    if (manifest.phase === 'purchase_creation_started') throw new Error('purchase creation interrupted; reconcile durable quote/purchase before another create');
    const offers = await call('POST', '/v1/offers/search', { intent });
    const quoteResponse = await call('POST', '/v1/quotes', { offerId: offers.offers[0]?.offerId, fulfillment: { category: 'retail', ...demoData.buyer } });
    const quote = quoteResponse.quote, option = quote.fundingOptions.find((o: any) => o.rail === 'sui');
    if (!option || BigInt(option.amount.amountBaseUnits) > cfg.policy.maxPerPayment) throw new Error('Sui exact quote exceeds bounded acceptance policy');
    manifest.phase = 'purchase_creation_started'; persist(manifest);
    const purchased = await call('POST', '/v1/purchases', { quoteId: quote.quoteId, approval: { maxTotal: quote.payablePrincipal, quoteDigest: quote.digest,
      selectedFundingOptionId: option.fundingOptionId } }, { 'idempotency-key': 'sui-e2e-' + manifest.schema });
    manifest.purchaseId = purchased.purchase.purchaseId; manifest.phase = 'purchase_created'; persist(manifest);
  }
  const id = manifest.purchaseId!, existing = await call('GET', `/v1/purchases/${id}`);
  if (existing.purchase.state === 'awaiting_funding' && existing.purchase.paymentState === 'not_received') {
    const run = promisify(execFile);
    // Keys are loaded only in this separate payer child. Stdout contains public status/digest only.
    const paid = await run(process.execPath, ['--import', 'tsx', resolve('clients/sui/pay.ts'), id], { env: payerEnv, timeout: 120000, maxBuffer: 3000 });
    evidence.payer = JSON.parse(paid.stdout.trim()); manifest.phase = 'payment_attempted'; persist(manifest);
  }
  let purchase = existing.purchase;
  for (let n = 0; n < 40; n++) {
    await gateway.core.recoverPendingFunding(id); await gateway.worker.tick();
    purchase = (await call('GET', `/v1/purchases/${id}`)).purchase;
    // Unknown merchant readback follows scheduled retrieve() reconciliation; it must never start another checkout.
    if (['succeeded', 'failed', 'expired', 'requires_reauthorization'].includes(purchase.state)) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  const validated = PurchaseView.parse(purchase); evidence.purchase = { purchaseId: id, state: validated.state, paymentState: validated.paymentState,
    merchantPaymentStatus: validated.merchantPaymentStatus, commerceStatus: validated.commerceStatus, providerReference: validated.providerReference,
    receiptId: validated.receipt?.receiptId, funding: validated.funding };
  const entry = new SuiLedger(cfg.ledger, cfg.payer).read().find(e => e.id === id);
  if (!entry?.digest) throw new Error('retained signed candidate unavailable');
  const chain = await rpc.transaction(entry.digest);
  if (!chain?.status.success || chain.checkpoint === null) throw new Error('independent Sui checkpoint readback missing');
  evidence.chain = { digest: chain.digest, checkpoint: chain.checkpoint, timestampMs: chain.timestampMs, balanceChanges: chain.balanceChanges,
    explorer: `https://suiscan.xyz/testnet/tx/${chain.digest}` };
  evidence.evidenceCount = (await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM funding_evidence WHERE purchase_id=$1', id))!.n;
  const outcomes = await new AdminClient(report.config, fetch, systemClock).searchOrders({ orderId: validated.providerReference ?? '' });
  const outcome = outcomes.length === 1 ? outcomes[0] : undefined;
  if (!validated.receipt || validated.state !== 'succeeded' || !outcome || !hasPaidTestEvidence(outcome, validated.payablePrincipal)) throw new Error('independent paid Shopify sandbox order or receipt not verified');
  evidence.providerReadback = { orderId: outcome.id, name: outcome.name, test: outcome.test, financialStatus: outcome.displayFinancialStatus,
    paidTestEvidence: true };
  const proof = PurchaseProof.parse((await call('GET', `/v1/evidence/purchases/${id}/proof`)).proof);
  if (proof.purchaseId !== id || proof.funding.requirement.rail !== 'sui' || !proof.funding.applied ||
      proof.funding.transfers.length !== 1 || proof.funding.transfers[0]?.reference !== entry.digest ||
      proof.receipt?.receiptId !== validated.receipt.receiptId) throw new Error('retrievable Sui proof or receipt mismatch');
  evidence.proofReadback = { purchaseId: proof.purchaseId, digest: proof.funding.transfers[0].reference, receiptId: proof.receipt.receiptId };
  const journalCount = (await db.get<{ n: number }>("SELECT COUNT(*)::int AS n FROM journal_entries WHERE purchase_id=$1 AND kind='funding_received'", id))!.n;
  if (journalCount !== 1 || [...(await trialBalance(db)).values()].some(sum => sum !== 0n)) throw new Error('funding journal duplicate or imbalance');
  evidence.fundingJournalCount = journalCount;
  const repeat = await promisify(execFile)(process.execPath, ['--import', 'tsx', resolve('clients/sui/pay.ts'), id], { env: payerEnv, timeout: 30000, maxBuffer: 3000 });
  const duplicate = JSON.parse(repeat.stdout.trim());
  if (duplicate.digest !== entry.digest || duplicate.resumed !== true || evidence.evidenceCount !== 1) throw new Error('same-candidate duplicate funding invariant failed');
  evidence.duplicate = duplicate; evidence.status = 'PASS'; manifest.phase = 'complete'; persist(manifest);
} catch (error) {
  evidence.reason = error instanceof Error ? error.message : 'unexpected failure'; process.exitCode = 1;
} finally {
  writeFileSync(resolve('docs/work/SUI_LIVE.json'), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify({ status: evidence.status, purchaseId: manifest.purchaseId, phase: manifest.phase, reason: evidence.reason, chain: evidence.chain }));
  await new Promise<void>(r => server.close(() => r())); await db.close(); await admin.end();
}
