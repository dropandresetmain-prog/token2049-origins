import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {createTestDb} from '../support/database.js';
import {registerWallets} from '../../scripts/multiwallet/registration.js';
import {suiPolicy} from '../../clients/multiwallet/policy.js';
import {loadSuiPayerConfig} from '../../clients/sui/config.js';
import {importSuiHistory} from '../../clients/sui/pg-ledger.js';
import {FundingSource} from '../../src/contracts/presentation.js';
import {suiEnv} from '../support/sui.js';
it('owner registration validates pinned policy/import without reading keys; default read-only and applied sources remain disabled',async()=>{
 const db=await createTestDb(),owner='0x'+'a'.repeat(64),customer='cus_1234567890';
 await db.run("INSERT INTO customers VALUES($1,'synthetic owner','now')",customer);
 const e={...suiEnv,SUI_PAYER_ADDRESS:owner,SUI_PAYER_KEY_FILE:'C:/fixture/NO_KEY_EXISTS',SUI_GATEWAY_URL:'https://gateway.example.test',SUI_GATEWAY_TOKEN_FILE:'C:/fixture/NO_TOKEN_EXISTS',
 SUI_PAYER_MAX_PAYMENT_BASE_UNITS:'10000',SUI_PAYER_MAX_DAILY_BASE_UNITS:'20000',SUI_PAYER_MAX_TOTAL_BASE_UNITS:'30000',SUI_PAYER_MAX_TOTAL_GAS_MIST:'30000000',SUI_PAYER_MAX_COMMERCIAL_USD_MINOR:'10000'};
 const cfg=loadSuiPayerConfig(e,{ledger:'external'}),env=Object.fromEntries(Object.entries(e).map(([k,v])=>['DEMO_'+k,v]));
 const source=FundingSource.parse({sourceId:'src_'+'1'.repeat(32),rail:'sui',network:'sui:testnet',assetId:suiEnv.SUI_USDC_TYPE,publicAddress:owner,displayAddress:owner.slice(0,12),readiness:'configured'});
 const manifest={customerId:customer,payerId:'payer_synthetic123',wallets:[{source,signerRef:'DEMO',ledgerNamespace:'demo-sui',policy:suiPolicy(cfg)}]};
 await expect(registerWallets(db,manifest,env)).rejects.toThrow('history import');
 const text=JSON.stringify({version:1,owner,network:source.network,asset:source.assetId,entries:[]});
 await importSuiHistory(db,{text,owner,expectedSha256:createHash('sha256').update(text).digest('hex'),verifyEntry:async()=>{}});
 expect(await registerWallets(db,manifest,env)).toMatchObject({mode:'validate-only',signingGranted:false});
 expect(await db.get('SELECT * FROM payer_profiles')).toBeUndefined();
 await expect(registerWallets(db,manifest,env,true)).rejects.toThrow('approved');
 const approved={...env,CAPSULE_APPROVED_REGISTRATION:'true'};
 expect(await registerWallets(db,manifest,approved,true)).toMatchObject({mode:'registered-disabled',signingGranted:false});
 expect((await db.get<{enabled:boolean}>('SELECT * FROM registered_wallets'))?.enabled).toBe(false);
 expect(await db.get('SELECT * FROM wallet_signing_authority')).toBeUndefined();
 await registerWallets(db,manifest,approved,true);
 await expect(registerWallets(db,manifest,{...approved,DEMO_SUI_PAYER_MAX_TOTAL_BASE_UNITS:'40000'},true)).rejects.toThrow('policy');
 await expect(db.run("UPDATE registered_wallets SET policy_json='{}'")).rejects.toThrow('immutable');
});

it('starts the real consolidated HTTP entry without keys and denies signing by default',async()=>{
 const {startMultiWalletPayer}=await import('../../clients/multiwallet/hosted.js');
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const db=await createTestDb(),root=mkdtempSync(join(tmpdir(),'capsule-startup-')),file=join(root,'bridge-token'),token='disposable-bridge-token-0123456789';writeFileSync(file,token,{mode:0o600});
 const app=await startMultiWalletPayer({MULTIWALLET_INSTANCE_ID:'fixture-candidate',MULTIWALLET_ALLOWED_HOSTS:'payer.example.test',MULTIWALLET_PAYER_TOKEN_FILE:file},{db,port:0});
 try {
  const address=app.server.address();if(!address||typeof address==='string')throw Error('test listener');
  const {request}=await import('node:http');
  const call=(url:string,init:{method?:string;headers?:Record<string,string>;body?:string}={})=>new Promise<{status:number;json:()=>Promise<any>}>((resolve,reject)=>{
   const req=request(url,{method:init.method,headers:init.headers},res=>{const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode!,json:async()=>JSON.parse(Buffer.concat(chunks).toString())}));});req.on('error',reject);req.end(init.body);
  });
  const url='http://127.0.0.1:'+address.port,headers={Host:'payer.example.test','x-forwarded-proto':'https',Authorization:'Bearer '+token};
  expect(await (await call(url+'/health')).json()).toEqual({ok:true});
  expect(await (await call(url+'/status',{headers})).json()).toEqual({ok:true,source:null});
  expect((await call(url+'/status',{headers:{...headers,Authorization:'Bearer wrong'}})).status).toBe(401);
  expect((await call(url+'/pay',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({purchaseId:'pur_1234567890'})})).status).toBe(403);
  expect((await call(url+'/sign',{method:'POST',headers})).status).toBe(404);
 }finally{await app.close();rmSync(root,{recursive:true,force:true});}
});
