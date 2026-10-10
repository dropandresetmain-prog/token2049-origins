import {PgPayerLedger} from '../../clients/payer/pg-ledger.js';
import {describe,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {createTestDb,crashTestDb,newTestSchema} from '../support/database.js';
import {PgSuiLedger,importSuiHistory} from '../../clients/sui/pg-ledger.js';
import {suiHistoryVerifier} from '../../clients/sui/history.js';
import {SuiLedgerSnapshotSchema,type SuiLedgerEntry} from '../../clients/sui/ledger.js';
import {makeSuiCandidate,suiInput,suiEnv} from '../support/sui.js';
import {parseSuiConfig,NETWORK,USDC_TYPE} from '../../src/funding/sui/config.js';
import {PgSolanaLedger} from '../../clients/solana/pg-ledger.js';
import {NETWORK as SOLANA_NETWORK,TEST_MINT} from '../../src/funding/solana/wire.js';
import {assertPinnedPolicy} from '../../clients/multiwallet/policy.js';
const hash=(t:string)=>createHash('sha256').update(t).digest('hex');
async function fixture() {
 const schema=newTestSchema(),db=await createTestDb(schema),input=suiInput(),c=await makeSuiCandidate(input);
 const cfg=parseSuiConfig(suiEnv);if(!cfg.ok)throw Error('fixture config');
 const signed:SuiLedgerEntry={id:input.purchaseId,amount:input.amount.amountBaseUnits,gasBudget:'10000000',header:c.header,digest:c.digest,createdAt:'2026-10-08T00:00:00.000Z',status:'signed'};
 const reserved:SuiLedgerEntry={...signed,id:'pur_reserved00001',header:null,digest:null,status:'reserved'};
 const text=JSON.stringify(SuiLedgerSnapshotSchema.parse({version:1,owner:c.payer,network:NETWORK,asset:USDC_TYPE,entries:[signed,reserved]}));
 const verifyEntry=suiHistoryVerifier({owner:c.payer,requirements:[input],gatewayOrigins:['http://127.0.0.1:8787'],config:cfg.config});
 return {schema,db,input,c,signed,reserved,text,verifyEntry,importArgs:{text,owner:c.payer,expectedSha256:hash(text),verifyEntry}};
}
describe('native PostgreSQL wallet history and serialization',()=>{
 it('imports real disposable-key Sui signatures; preserves reservation, exact bytes, exposure and sequence after restart',async()=>{
  const f=await fixture();
  expect(await importSuiHistory(f.db,f.importArgs)).toMatchObject({entryCount:2,committedAmount:'2000',committedGas:'20000000'});
  const ledger=await PgSuiLedger.open(f.db,f.c.payer);
  await ledger.upsert({...f.signed,status:'accepted'});
  await f.db.close();
  const reopened=await PgSuiLedger.open(await createTestDb(f.schema),f.c.payer);
  expect(await reopened.read()).toEqual([{...f.signed,status:'accepted'},f.reserved]);
  expect(await importSuiHistory(await createTestDb(f.schema),f.importArgs)).toMatchObject({status:'already_imported'});
  expect((await reopened.read()).length).toBe(2); // retained reservations also advance the on-chain nonce sequence.
  await expect(reopened.upsert({...f.signed,status:'accepted',amount:'1001'})).rejects.toThrow('immutable');
  await expect(reopened.upsert({...f.signed,status:'accepted',header:'different'})).rejects.toThrow('immutable');
  await expect(reopened.upsert({...f.signed,status:'reserved',header:null,digest:null})).rejects.toThrow();
  const caps={maxPerPayment:1000n,maxDaily:1000n,maxTotal:10000n,maxGasPerPayment:10000000n,maxGasTotal:50000000n};
  await expect(reopened.assertCaps(1n,1n,caps,new Date('2026-10-10T00:00:00Z'))).rejects.toThrow('24-hour'); // old uncertain reservation counts.
 });
 it('rolls back a failed candidate verification and rejects changed digest/owner/requirement before import',async()=>{
  const f=await fixture(),verify=vi.fn(async()=>{throw Error('invalid signature');});
  await expect(importSuiHistory(f.db,{...f.importArgs,verifyEntry:verify})).rejects.toThrow('invalid signature');
  expect(await f.db.get('SELECT * FROM hosted_sui_identity')).toBeUndefined();
  await expect(f.verifyEntry({...f.signed,digest:'different'})).rejects.toThrow('mismatch');
  const cfg=parseSuiConfig(suiEnv);if(!cfg.ok)throw Error('fixture');
  await expect(suiHistoryVerifier({owner:f.c.payer,requirements:[{...f.input,amount:{...f.input.amount,amountBaseUnits:'1001'}}],gatewayOrigins:['http://127.0.0.1:8787'],config:cfg.config})(f.signed)).rejects.toThrow();
  await importSuiHistory(f.db,f.importArgs);
  await expect(importSuiHistory(f.db,{...f.importArgs,text:f.text+' ',expectedSha256:hash(f.text+' ')})).rejects.toThrow('different Sui history');
  await expect(f.db.run('DELETE FROM hosted_sui_ledger')).rejects.toThrow('cannot be deleted');
  await expect(f.db.run('UPDATE hosted_sui_identity SET entry_count=0')).rejects.toThrow('permanent');
 });
 it('serializes cap races across processes, refuses lost lock sessions, and retains the same signed candidate',async()=>{
  const f=await fixture();await importSuiHistory(f.db,f.importArgs);
  const a=await PgSuiLedger.open(f.db,f.c.payer),other=await createTestDb(f.schema),b=await PgSuiLedger.open(other,f.c.payer);
  let release!:()=>void,enter!:()=>void;const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>enter=r);
  const holding=a.exclusive(async()=>{enter();await gate;});
  await entered;await expect(b.exclusive(async()=>{})).rejects.toThrow('busy');release();await holding;
  const build=vi.fn(),submit=vi.fn();
  await expect(a.exclusive(async()=>{await crashTestDb(f.db);await a.upsert({...f.reserved,id:'pur_crash0000001'});build();submit();})).rejects.toThrow();
  expect(build).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();
  expect((await b.read()).find(e=>e.id===f.signed.id)?.header).toBe(f.signed.header);
  const policy={maxPerPayment:1000n,maxDaily:10000n,maxTotal:2001n,maxGasPerPayment:10000000n,maxGasTotal:50000000n};
  const add=async(l:PgSuiLedger,id:string)=>l.exclusive(async()=>{await l.assertCaps(1n,1n,policy,new Date('2026-10-08T00:00:01Z'));await l.upsert({...f.reserved,id,amount:'1',gasBudget:'1'});});
  const results=await Promise.allSettled([add(b,'pur_race00000001'),add(await PgSuiLedger.open(await createTestDb(f.schema),f.c.payer),'pur_race00000002')]);
  expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
  expect((await b.read()).reduce((n,e)=>n+BigInt(e.amount),0n)).toBe(2001n);
 });
 it('separates same-chain payer caps and preserves one sponsor fee ledger across wallets',async()=>{
  const db=await createTestDb();
  for(const [role,owner] of [['one:payer','payer-one'],['two:payer','payer-two']] as const){
   await db.run('INSERT INTO wallet_solana_identity VALUES($1,$2,$3,$4)',role,owner,SOLANA_NETWORK,TEST_MINT);
   await db.run("INSERT INTO wallet_solana_import VALUES($1,$2,0,'0','0','now')",role,'0'.repeat(64));
  }
  await db.run('INSERT INTO hosted_solana_identity VALUES($1,$2,$3,$4)','sponsor','shared-sponsor',SOLANA_NETWORK,TEST_MINT);
  await db.run("INSERT INTO hosted_solana_import VALUES('sponsor',$1,0,'0','0','now')",'0'.repeat(64));
  const one=await PgSolanaLedger.open(db,'payer','payer-one','one'),two=await PgSolanaLedger.open(db,'payer','payer-two','two'),sponsor=await PgSolanaLedger.open(db,'sponsor','shared-sponsor');
  await one.upsert({id:'pur_1234567890',signature:null,amount:'100',fee:'0',header:null,createdAt:'now'});
  await expect(one.assertCaps(1n,0n,100n,100n)).rejects.toThrow('cap');
  await expect(two.assertCaps(100n,0n,100n,100n)).resolves.toBeUndefined();
  await sponsor.upsert({id:'sponsor-fixture',signature:null,amount:'0',fee:'100',header:null,createdAt:'now'});
  await expect((await PgSolanaLedger.open(db,'sponsor','shared-sponsor')).assertCaps(0n,1n,100n,100n)).rejects.toThrow('cap');
  await db.run("INSERT INTO wallet_sponsor_policy VALUES('shared-sponsor','100')");
  await expect(db.run("UPDATE wallet_sponsor_policy SET max_fee_lamports='101'")).rejects.toThrow('permanent');
  expect(()=>assertPinnedPolicy('{"maxTotal":"100"}',{maxTotal:'101'})).toThrow('policy');
 });
 it('refuses fresh namespaces for wallets with legacy histories',async()=>{
  const db=await createTestDb();
  await expect(PgPayerLedger.openExisting(db,{network:'cardano:preprod',address:'legacy-cardano'})).rejects.toThrow('missing');
  await PgPayerLedger.open(db,{network:'cardano:preprod',address:'legacy-cardano'});
  await db.tx(async()=>{await db.run('SET TRANSACTION READ ONLY');await PgPayerLedger.openExisting(db,{network:'cardano:preprod',address:'legacy-cardano'});});
  await expect(db.run("INSERT INTO wallet_cardano_identity VALUES('fresh','cardano:preprod','legacy-cardano','now')")).rejects.toThrow('canonical history');
  await expect(PgPayerLedger.openWallet(db,'fresh',{network:'cardano:preprod',address:'legacy-cardano'})).rejects.toThrow('canonical ledger');
  await db.run('INSERT INTO hosted_solana_identity VALUES($1,$2,$3,$4)','payer','legacy-solana',SOLANA_NETWORK,TEST_MINT);
  await db.run("INSERT INTO hosted_solana_import VALUES('payer',$1,0,'0','0','now')",'0'.repeat(64));
  await expect(db.run('INSERT INTO wallet_solana_identity VALUES($1,$2,$3,$4)','fresh:payer','legacy-solana',SOLANA_NETWORK,TEST_MINT)).rejects.toThrow('canonical history');
  await expect(PgSolanaLedger.open(db,'payer','legacy-solana','fresh')).rejects.toThrow('canonical ledger');
  await expect(PgSolanaLedger.open(db,'payer','legacy-solana')).resolves.toBeDefined();
 });

});
