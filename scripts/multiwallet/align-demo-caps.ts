import {Db} from '../../src/infrastructure/db.js';
import {walletRecord} from '../../src/core/wallets.js';
import {digestOf} from '../../src/infrastructure/ids.js';
const CUSTOMER='cus_HOSTEDMCPDEMO';
const SOURCES={cardano:'src_21f098873f368133fc671af8b3716703',solana:'src_5f44db62376459a75a564e4d3bc8099a',sui:'src_fb5d190ec0b7abf66d5ff65f2e37af86'};
/** Owner-operated, default read-only. Baselines remain immutable; amendments are appended only while authority is fenced. */
export async function alignDemoCaps(db:Db,opts:{apply?:boolean;authorizationReference:string}) {
 if(!/^[A-Za-z0-9_: -]{8,200}$/.test(opts.authorizationReference))throw Error('explicit owner authorization reference required');
 return db.tx(async()=>{
  const rows=[];
  for(const [rail,id] of Object.entries(SOURCES)){
   if(opts.apply)await db.get('SELECT source_id FROM registered_wallets WHERE source_id=$1 FOR UPDATE',id);
   const w=await walletRecord(db,id);
   if(!w||w.customer_id!==CUSTOMER||w.payer_id!=='payer_HOSTEDMCPDEMO'||w.rail!==rail||w.ledger_namespace!==(rail==='sui'?'sui-demo':'legacy'))throw Error('canonical demo ownership/ledger mismatch');
   rows.push(w);
  }
  const reference=JSON.parse(rows[0]!.policy_json) as Record<string,string>;
  if(['maxPerPayment','maxDaily','maxTotal'].some(k=>reference[k]!=='5100000'))throw Error('Cardano cap reference differs from explicit approval');
  if(opts.apply){
   if(rows.some(w=>w.enabled))throw Error('wallets must be disabled before cap amendment');
   if(await db.get('SELECT source_id FROM wallet_signing_authority WHERE enabled LIMIT 1'))throw Error('signing grants must be fenced');
   const active=await db.get<{n:string}>("SELECT ((SELECT count(*) FROM jobs WHERE status IN ('pending','claimed'))+(SELECT count(*) FROM purchases WHERE state NOT IN ('succeeded','failed','expired'))+(SELECT count(*) FROM funding_attempts WHERE status='pending')+(SELECT count(*) FROM execution_attempts WHERE status IN ('started','unknown'))+(SELECT count(*) FROM payment_handoffs WHERE status='running'))::text AS n");
   if(active?.n!=='0')throw Error('in-flight activity requires reconciliation before amendment');
  }
  const result=[];
  for(const w of rows.slice(1)){
   const old=JSON.parse(w.policy_json) as Record<string,string>;
   const policy={...old,maxPerPayment:reference.maxPerPayment,maxDaily:reference.maxDaily,maxTotal:reference.maxTotal,maxCommercial:'510000',...(w.rail==='sui'?{maxAmount:reference.maxPerPayment}:{})};
   const before=digestOf(old),after=digestOf(policy);
   const last=await db.get<{revision:number}>('SELECT revision FROM wallet_policy_amendments WHERE source_id=$1 ORDER BY revision DESC LIMIT 1',w.source_id);
   if(opts.apply&&before!==after)await db.run('INSERT INTO wallet_policy_amendments(source_id,revision,previous_policy_json,policy_json,authorization_reference,created_at) VALUES($1,$2,$3,$4,$5,$6)',w.source_id,(last?.revision??0)+1,w.policy_json,JSON.stringify(policy),opts.authorizationReference,new Date().toISOString());
   result.push({sourceId:w.source_id,rail:w.rail,beforePolicyDigest:before,afterPolicyDigest:after,changed:before!==after,policy});
  }
  return {mode:opts.apply?'amended-disabled':'plan-only',customerId:CUSTOMER,referenceSource:SOURCES.cardano,sources:result,signingGranted:false};
 });
}
