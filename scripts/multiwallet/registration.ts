import {z} from 'zod';
import type {Db} from '../../src/infrastructure/db.js';
import {FundingSource} from '../../src/contracts/presentation.js';
import {CustomerId} from '../../src/contracts/common.js';
import {digestOf} from '../../src/infrastructure/ids.js';
import {walletRecord,type WalletRecord} from '../../src/core/wallets.js';
import {sourceEnv} from '../../clients/multiwallet/engines.js';
import {cardanoPolicy,solanaPolicy,suiPolicy,assertPinnedPolicy} from '../../clients/multiwallet/policy.js';
export const RegistrationManifest=z.object({
 customerId:CustomerId,payerId:z.string().regex(/^payer_[A-Za-z0-9_-]{8,80}$/),
 wallets:z.array(z.object({source:FundingSource,signerRef:z.string().regex(/^[A-Z][A-Z0-9_]{1,60}$/),
 ledgerNamespace:z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),policy:z.record(z.string(),z.unknown())}).strict()).min(1)
}).strict();
/** Owner-side tool only. Default is read-only validation; registration never grants signing authority. */
export async function registerWallets(db:Db,raw:unknown,env:NodeJS.ProcessEnv,apply=false) {
 if(apply&&env.CAPSULE_APPROVED_REGISTRATION!=='true')throw Error('approved wallet registration required');
 const manifest=RegistrationManifest.parse(raw);
 if(!(await db.get('SELECT id FROM customers WHERE id=$1',manifest.customerId)))throw Error('existing authenticated customer required');
 const records:WalletRecord[]=[];
 for(const w of manifest.wallets){
  if(w.source.readiness!=='configured')throw Error('supported registered testnet source required');
  const row:WalletRecord={source_id:w.source.sourceId,payer_id:manifest.payerId,customer_id:manifest.customerId,rail:w.source.rail,
   network:w.source.network,asset_id:w.source.assetId,public_address:w.source.publicAddress,signer_ref:w.signerRef,
   ledger_namespace:w.ledgerNamespace,policy_json:JSON.stringify(w.policy),public_json:JSON.stringify(w.source),enabled:false};
  const e=sourceEnv(env,row);
  if(row.rail==='cardano'){
   const {loadPayerConfig}=await import('../../clients/payer/config.js');const cfg=loadPayerConfig(e,{ledger:'external'});
   if(cfg.walletAddress!==row.public_address||cfg.network!==row.network||cfg.allowedAsset!==row.asset_id)throw Error('Cardano registration config mismatch');
   assertPinnedPolicy(row.policy_json,cardanoPolicy(cfg));
   if(row.ledger_namespace!=='legacy'&&await db.get('SELECT public_address FROM hosted_payer_identity WHERE public_address=$1',row.public_address))throw Error('legacy Cardano wallet must retain its canonical ledger namespace');
   const identity=await db.get<{network:string;public_address:string}>(row.ledger_namespace==='legacy'?'SELECT * FROM hosted_payer_identity WHERE singleton':'SELECT * FROM wallet_cardano_identity WHERE singleton=$1',...(row.ledger_namespace==='legacy'?[]:[row.ledger_namespace]));
   if(identity?.public_address!==row.public_address||identity.network!==row.network)throw Error('Cardano preserved identity missing');
  }else if(row.rail==='solana'){
   const {loadSolanaPayerConfig}=await import('../../clients/solana/config.js');const cfg=loadSolanaPayerConfig(e,{ledger:'external'});
   if(cfg.payer!==row.public_address||cfg.mint!==row.asset_id||cfg.settlementMode!=='payer_broadcast')throw Error('Solana registration config mismatch');
   assertPinnedPolicy(row.policy_json,solanaPolicy(cfg));
   const {PgSolanaLedger}=await import('../../clients/solana/pg-ledger.js');
   await PgSolanaLedger.open(db,'payer',cfg.payer,row.ledger_namespace==='legacy'?undefined:row.ledger_namespace);
   await PgSolanaLedger.open(db,'sponsor',cfg.sponsor);
   const prior=await db.get<{max_fee_lamports:string}>('SELECT max_fee_lamports FROM wallet_sponsor_policy WHERE owner=$1',cfg.sponsor);
   if(prior&&prior.max_fee_lamports!==String(cfg.maxFees))throw Error('shared sponsor cap differs');
  }else{
   const {loadSuiPayerConfig}=await import('../../clients/sui/config.js');const cfg=loadSuiPayerConfig(e,{ledger:'external'});
   if(cfg.payer!==row.public_address)throw Error('Sui registration config mismatch');
   assertPinnedPolicy(row.policy_json,suiPolicy(cfg));
   const {PgSuiLedger}=await import('../../clients/sui/pg-ledger.js');await PgSuiLedger.open(db,cfg.payer);
  }
  records.push(row);
 }
 if(apply)await db.tx(async()=>{
  await db.run('INSERT INTO payer_profiles(id,customer_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',manifest.payerId,manifest.customerId,new Date().toISOString());
  const profile=await db.get<{customer_id:string}>('SELECT customer_id FROM payer_profiles WHERE id=$1',manifest.payerId);
  if(profile?.customer_id!==manifest.customerId)throw Error('payer ownership conflict');
  for(const row of records){
   const previous=await walletRecord(db,row.source_id);
   if(previous){
    for(const field of ['payer_id','customer_id','rail','network','asset_id','public_address','signer_ref','ledger_namespace'] as const)if(previous[field]!==row[field])throw Error('registration ownership/identity conflict');
    if(digestOf(JSON.parse(previous.policy_json))!==digestOf(JSON.parse(row.policy_json))||digestOf(JSON.parse(previous.public_json))!==digestOf(JSON.parse(row.public_json)))throw Error('registered policy/source conflict');
   }else await db.run('INSERT INTO registered_wallets(source_id,payer_id,rail,network,asset_id,public_address,signer_ref,ledger_namespace,policy_json,public_json) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    row.source_id,row.payer_id,row.rail,row.network,row.asset_id,row.public_address,row.signer_ref,row.ledger_namespace,row.policy_json,row.public_json);
   if(row.rail==='solana'){
    const p=JSON.parse(row.policy_json) as {sponsor:string;maxSponsorFees:string};
    await db.run('INSERT INTO wallet_sponsor_policy VALUES($1,$2) ON CONFLICT DO NOTHING',p.sponsor,p.maxSponsorFees);
    if((await db.get<{max_fee_lamports:string}>('SELECT * FROM wallet_sponsor_policy WHERE owner=$1',p.sponsor))?.max_fee_lamports!==p.maxSponsorFees)throw Error('shared sponsor cap conflict');
   }
  }
 });
 return {mode:apply?'registered-disabled':'validate-only',customerId:manifest.customerId,sources:records.map(r=>({sourceId:r.source_id,rail:r.rail,publicAddress:r.public_address,policyDigest:digestOf(JSON.parse(r.policy_json))})),signingGranted:false};
}
