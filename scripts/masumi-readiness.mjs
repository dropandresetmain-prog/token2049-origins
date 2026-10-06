import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const env={}; for(const p of ['C:/Dev/token2049-origins/.env.local','C:/Dev/token2049-setup/masumi-payment-service/.env'])for(const l of readFileSync(p,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m&&!env[m[1]])env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
const state=JSON.parse(readFileSync('.runtime/mps-public-state.json','utf8')); const hash=v=>createHash('sha256').update(String(v)).digest('hex').slice(0,16);const report={at:new Date().toISOString(),calls:[]};
for(const p of ['health','api-key-status','rail-readiness?network=Preprod','registry?network=Preprod&filterPaymentSourceType=Web3CardanoV2&limit=100']){
const r=await fetch('http://127.0.0.1:3012/api/v1/'+p,{headers:{token:env.MASUMI_PAYMENT_API_KEY},redirect:'error'});const j=await r.json();
report.calls.push({endpoint:p,status:r.status,envelope:j.status,keys:Object.keys(j.data??{}),rails:j.data?.Rails?.map(q=>({rail:q.rail,ready:q.isReady,checks:q.Checks.map(c=>({id:c.id,complete:c.isComplete}))})),registryCount:j.data?.RegistryRequests?.length});
if(p.startsWith('registry'))writeFileSync('.runtime/registry-readback.json',JSON.stringify(j));
}
for(const w of state.wallets){const r=await fetch('https://cardano-preprod.blockfrost.io/api/v0/addresses/'+w.walletAddress,{headers:{project_id:env.BLOCKFROST_API_KEY_PREPROD??env.CARDANO_PROVIDER_PROJECT_ID}});const j=await r.json();report.calls.push({endpoint:'Blockfrost Preprod wallet balance',fingerprint:hash(w.walletAddress),type:w.type,status:r.status,amounts:j.amount});}
writeFileSync('.runtime/readiness.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
