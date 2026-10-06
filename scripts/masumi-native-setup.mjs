import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const env={};for(const p of ['C:/Dev/token2049-origins/.env.local','C:/Dev/token2049-setup/masumi-payment-service/.env'])for(const l of readFileSync(p,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m&&!env[m[1]])env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
const p='.runtime/native-setup.json';const st=existsSync(p)?JSON.parse(readFileSync(p,'utf8')):{};const save=()=>writeFileSync(p,JSON.stringify(st));const pub=JSON.parse(readFileSync('.runtime/mps-public-state.json','utf8'));const seller=pub.wallets.find(w=>w.type==='Selling'),buyer=pub.wallets.find(w=>w.type==='Purchasing'),source=pub.sources.find(s=>s.network==='Preprod');const unit='16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d';
const call=async(path,body)=>{const r=await fetch('http://127.0.0.1:3012/api/v1/'+path,{method:body?'POST':'GET',headers:{token:env.ADMIN_KEY,'content-type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000),redirect:'error'});const j=await r.json();if(!r.ok||j.status!=='success')throw new Error('Native request rejected HTTP'+r.status);return j.data;};
const action=process.argv[2];
if(action==='fund'){
if(st.fundAttempt&&!st.fund)throw new Error('Ambiguous fund write; reconcile only');
if(!st.fund){st.fundAttempt=new Date().toISOString();save();st.fund=await call('wallet/transfer-funds',{fromWalletAddress:seller.walletAddress,toAddress:buyer.walletAddress,lovelaceAmount:'8000000',assets:[{unit,quantity:'100000'}]});save();}
const j=await call('wallet/transfer-funds?id='+encodeURIComponent(st.fund.id));st.fund=j.transfers[0];save();console.log(JSON.stringify({action,status:st.fund.status,hasTx:Boolean(st.fund.txHash),errorPresent:Boolean(st.fund.errorNote)}));
}else if(action==='gas'){
if(st.gasAttempt&&!st.gas)throw new Error('Ambiguous gas top-up; reconcile only');
if(!st.gas){st.gasAttempt=new Date().toISOString();save();st.gas=await call('wallet/transfer-funds',{fromWalletAddress:seller.walletAddress,toAddress:buyer.walletAddress,lovelaceAmount:'10000000'});save();}
const j=await call('wallet/transfer-funds?id='+encodeURIComponent(st.gas.id));st.gas=j.transfers[0];save();console.log(JSON.stringify({action,status:st.gas.status,hasTx:!!st.gas.txHash,errorPresent:!!st.gas.errorNote}));
}else if(action==='registry'){
const found=await call('registry?network=Preprod&filterPaymentSourceType=Web3CardanoV2&limit=100');const matches=found.Assets.filter(a=>a.name==='Origins Preprod Commerce Coordinator');if(matches.length>1)throw new Error('Registry ambiguous');
if(matches.length)st.registry=matches[0];else if(!st.registry){if(st.registryAttempt)throw new Error('Ambiguous registration; reconcile only');st.registryAttempt=new Date().toISOString();save();st.registry=await call('registry',{network:'Preprod',type:'Standard',sellingWalletVkey:seller.walletVkey,supportedPaymentSources:[{chain:'Cardano',network:'Preprod',paymentSourceType:'Web3CardanoV2',address:source.smartContractAddress,pricing:{pricingType:'Fixed',fixed:[{asset:unit,amount:'10000'}]}}],name:'Origins Preprod Commerce Coordinator',description:'Synthetic Preprod coordination test. Task fee is not merchant purchase principal.',apiBaseUrl:'http://127.0.0.1:3013',ExampleOutputs:[],Tags:['commerce','preprod'],Capability:{name:'commerce-coordination',version:'1.0.0'},Author:{name:'Origins Sandbox'}});}
save();console.log(JSON.stringify({action,state:st.registry.state,hasAgentIdentifier:Boolean(st.registry.agentIdentifier),errorPresent:Boolean(st.registry.error),keys:Object.keys(st.registry)}));
}else throw new Error('Choose fund or registry');
