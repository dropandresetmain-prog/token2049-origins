import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {SuiLedger} from '../../clients/sui/ledger.js';
import {SolanaLedger} from '../../clients/solana/ledger.js';
import {runSuiRetirement} from '../../scripts/sui/retire-history.js';
import {runHistoryImport} from '../../scripts/sui/import-history.js';
import {makeSuiCandidate,suiInput,suiEnv} from '../support/sui.js';
const roots:string[]=[];
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
afterEach(()=>{vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
async function setup() {
 const root=mkdtempSync(join(tmpdir(),'sui-retirement-'));roots.push(root);
 SolanaLedger.protectDirectory(root);
 // Real protected directory; file ACL mechanics are covered by the ledger tests.
 vi.spyOn(SolanaLedger.prototype,'assertProtected').mockImplementation(()=>{});
 const input=suiInput(),c=await makeSuiCandidate(input),ledger=new SuiLedger(join(root,'history.json'),c.payer);
 ledger.initialize();
 await ledger.exclusive(async()=>ledger.upsert({id:input.purchaseId,amount:input.amount.amountBaseUnits,gasBudget:'10000000',header:c.header,digest:c.digest,createdAt:'2026-10-08T00:00:00.000Z',status:'signed'}));
 const text=readFileSync(ledger.path,'utf8'),requirements=JSON.stringify([input]),reqFile=join(root,'requirements.json');
 writeFileSync(reqFile,requirements,{mode:0o600});
 const manifest=join(root,'manifest.json');
 writeFileSync(manifest,JSON.stringify({owner:c.payer,snapshotFile:ledger.path,snapshotSha256:hash(text),requirementsFile:reqFile,requirementsSha256:hash(requirements),gatewayOrigins:['http://127.0.0.1:8787']}),{mode:0o600});
 return {ledger,manifest,text,args:['--manifest',manifest],env:{...suiEnv}};
}
describe('approved Sui retirement and read-only import command',()=>{
 it('defaults to independent offline verification without changing authority',async()=>{
  const f=await setup();
  expect(await runSuiRetirement(f.args,f.env)).toMatchObject({authorityChanged:false,noSpend:true,mode:'verify-only',entryCount:1});
  expect(f.ledger.read()).toHaveLength(1);
  await expect(runHistoryImport([...f.args,'--apply'],{...f.env,CAPSULE_APPROVED_SUI_IMPORT:'true'})).rejects.toThrow(); // No DB connection before permanent fence.
 });
 it('requires both explicit retirement approval and verified backup/restore',async()=>{
  const f=await setup();
  await expect(runSuiRetirement([...f.args,'--retire'],f.env)).rejects.toThrow(/approved retirement/);
  await expect(runSuiRetirement([...f.args,'--retire'],{...f.env,CAPSULE_APPROVED_SUI_RETIREMENT:'true'})).rejects.toThrow(/backup/);
  expect(f.ledger.read()).toHaveLength(1);
 });
 it('verifies actual disposable-key signatures after retirement without resetting or signing again',async()=>{
  const f=await setup();
  expect(await runSuiRetirement([...f.args,'--retire'],{...f.env,CAPSULE_APPROVED_SUI_RETIREMENT:'true',CAPSULE_BACKUP_RESTORE_VERIFIED:'true'})).toMatchObject({authorityChanged:true,mode:'permanently-retired'});
  expect(()=>f.ledger.read()).toThrow(/retired/);
  expect(await runHistoryImport(f.args,f.env)).toMatchObject({noSpend:true,mode:'verify-only',entryCount:1,amount:'1000',gas:'10000000',uncertain:1});
  expect(readFileSync(f.ledger.path,'utf8')).toBe(f.text);
 });
 it('rejects changed arguments and pinned history before authority change',async()=>{
  const f=await setup();
  await expect(runSuiRetirement([...f.args,'--apply'],f.env)).rejects.toThrow(/use --manifest/);
  await expect(runHistoryImport([f.manifest,'--apply'],{...f.env,CAPSULE_APPROVED_SUI_IMPORT:'true'})).rejects.toThrow(/use --manifest/);
  writeFileSync(f.ledger.path,f.text+' ');
  await expect(runSuiRetirement([...f.args,'--retire'],{...f.env,CAPSULE_APPROVED_SUI_RETIREMENT:'true',CAPSULE_BACKUP_RESTORE_VERIFIED:'true'})).rejects.toThrow(/hash mismatch/);
 });
});
