import { Router } from 'express';
import type { GatewayParts } from './composition.js';
import { createGlobalSandboxExecutor } from './execution/shopify/globalSandbox.js';
import { Db } from './infrastructure/db.js';
import { loadShopifyConfig } from './execution/shopify/config.js';
import { createShopifyWebhookRouter, type ShopifyReconcileHint } from './execution/shopify/webhook.js';
import { createAtlasExecutor } from './execution/atlas/index.js';
import { createNuiteeExecutor } from './execution/nuitee/index.js';
import { createCardanoFundingAdapter } from './funding/cardano/index.js';
import { createSolanaFundingAdapter } from './funding/solana/index.js';
import { createMasumiFundingAdapter } from './funding/masumi/index.js';
import { createOcbcAdapter } from './banking/ocbc/adapter.js';
import { createEvidenceRouter, createInspectRouter } from './evidence/router.js';
import { CoreError } from './core/errors.js';
import { appendEvent } from './core/store.js';
import type { CommerceCore } from './core/service.js';
import { loadHostedMcpConfig } from './channels/hosted-mcp/config.js';
import { createHostedMcp, provisionPayerClient } from './channels/hosted-mcp/router.js';
import { createConsoleRedirect, createConsoleRouter } from './console/router.js';
import { loadSokosumiMarketplaceConfig } from './channels/sokosumi/config.js';
import { SokosumiRuntime } from './channels/sokosumi/runtime.js';

/** A verified webhook provides a lookup hint, never payment truth. Admin readback binds the quote again. */
export async function enqueueShopifyReadback(core: CommerceCore, hint: ShopifyReconcileHint): Promise<void> {
  const db=core.deps.db;
  await db.tx(async ()=>{
    const matches=await db.all<{id:string;state:string;attempt_id:string;checkpoints_json:string}>(
      "SELECT p.id,p.state,a.id AS attempt_id,a.checkpoints_json FROM purchases p JOIN quotes q ON q.id=p.quote_id JOIN execution_attempts a ON a.purchase_id=p.id WHERE q.route='shopify' AND (p.provider_reference=$1 OR a.provider_reference=$2 OR ($3::text IS NOT NULL AND (q.execution_ref_json::jsonb->>'nonce')=$4)) LIMIT 2",
      hint.orderId,hint.orderId,hint.quoteNonce,hint.quoteNonce);
    if(matches.length!==1) return;
    const p=matches[0]!;
    if(p.state!=='executing' && p.state!=='unresolved') return;
    if((await db.get('SELECT id FROM jobs WHERE dedupe_key = $1','shopify_webhook:'+hint.deliveryId))) return;
    const now=core.deps.clock.now().toISOString();
    const cp=JSON.parse(p.checkpoints_json) as Record<string,unknown>;
    cp.webhook_order={providerReference:hint.orderId};
    await db.run('UPDATE execution_attempts SET checkpoints_json = $1 WHERE id = $2',JSON.stringify(cp),p.attempt_id);
    await core.enqueueJob('reconcile_purchase',p.id,'shopify_webhook:'+hint.deliveryId,now);
    await appendEvent(db,p.id,'provider.webhook_received',{provider:'shopify',topic:hint.topic},now);
  });
}

/** Optional missing credentials report readiness and never fall back to fixtures. */
export function realParts(env: NodeJS.ProcessEnv, log: (line: Record<string,unknown>)=>void): GatewayParts {
  const bankAdapters=[createOcbcAdapter(env)];
  const hosted=loadHostedMcpConfig(env);
  const auxiliaryDbs: Db[] = [];
  let runtimeDb: Db | undefined;
  return {
    ...(hosted?.publicConsoleReadOnly ? { publicConsoleCustomerId: hosted.customerId } : {}),
    executors:[createGlobalSandboxExecutor(env,()=>{ if(!runtimeDb) throw new Error('gateway_not_initialized'); return runtimeDb; },{sink:step=>log({component:'shopify',step})}),createAtlasExecutor(env),createNuiteeExecutor(env)],
    fundingAdapters:[createCardanoFundingAdapter(env,{log}),createSolanaFundingAdapter(env),createMasumiFundingAdapter(env)],bankAdapters,
    buildRouters:core=>{
      runtimeDb = core.deps.db;
      const routers:NonNullable<GatewayParts['extraRouters']>=[
        // Hosted MCP + its OAuth server share this process and public port. Opt-in: absent unless MCP_HOSTED_ENABLED=true.
        ...(()=>{if(!hosted) return []; provisionPayerClient(core.deps.db,hosted).catch(()=>log({component:'hosted-mcp',step:'payer_client_provisioning_failed'})); return createHostedMcp({db:core.deps.db,config:hosted}).mounts;})(),
        {path:'/v1/evidence',router:createEvidenceRouter({db:core.deps.db,clock:core.deps.clock,bankAdapters}),auth:true},
        {path:'/inspect',router:createInspectRouter(),auth:false},
        // The console is the customer frontend; the earlier /proof page now sends people there.
        {path:'/console',router:createConsoleRouter(),auth:false},
        {path:'/proof',router:createConsoleRedirect(),auth:false},
      ];
      const marketplace = loadSokosumiMarketplaceConfig(env);
      if (marketplace) {
        const taskDb = new Db(marketplace.databaseUrl, marketplace.databaseSchema);
        auxiliaryDbs.push(taskDb);
        const runtime = new SokosumiRuntime({ db: taskDb, masumi: marketplace.masumi, gatewayUrl: marketplace.gatewayUrl,
          identities: [marketplace.identity], taskMode: 'commerce_search' });
        const initialized = runtime.initialize().then(() => true, () => false);
        const router = Router();
        router.use((req,res,next)=>{
          if (req.path === '/input_schema') return next();
          void initialized.then(ready=>{
            if (ready) return next();
            if (req.path === '/availability') return res.status(503).json({status:'unavailable',readinessScope:'task_store_only',externalDependenciesChecked:false});
            return res.status(503).json({error:{code:'task_store_unavailable'}});
          });
        });
        router.use(runtime.router());
        routers.push({path:'/marketplace/mip003',router,auth:false});
      }
      const report=loadShopifyConfig(env), cfg=report.config;
      const webhook=cfg.storeDomain && cfg.clientSecret && report.invalid.length===0
        ? createShopifyWebhookRouter({storeDomain:cfg.storeDomain,secret:cfg.clientSecret,onReconcile:async hint=>(await enqueueShopifyReadback(core,hint))})
        : Router().post('/',(_req,_res,next)=>next(new CoreError('route_unavailable','Shopify webhook is not configured')));
      routers.push({path:'/v1/webhooks/shopify',router:webhook,auth:false,beforeJson:true});
      routers.push({path:'/',router:createConsoleRedirect(),auth:false});
      return routers;
    },
    close: async () => { await Promise.all(auxiliaryDbs.map(db => db.close())); },
  };
}

