import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,describe,expect,it} from 'vitest';
// @ts-expect-error JavaScript operator helper is verified at runtime with synthetic API fixtures.
import {withSourceAccess,directTls} from '../../scripts/database/migration-tools.mjs';
const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const original=[{cidrBlock:'127.0.0.1/32',description:'external-access-disabled'}];
describe('bounded migration access',()=>{
 for(const failure of ['none','callback','lost-patch-response'])it('restores original allowlist after '+failure,async()=>{
  const root=mkdtempSync(join(tmpdir(),'capsule-access-fixture-'));roots.push(root);let active=original;let patches=0;const seen:unknown[]=[];
  const fake=async(method:string,_path:string,body?:{ipAllowList:typeof original})=>{if(method==='PATCH'){active=body!.ipAllowList;patches++;seen.push(active);if(failure==='lost-patch-response'&&patches===1)throw Error('response lost');}return{data:{ipAllowList:active}};};
  const run=()=>withSourceAccess(root,async()=>{if(failure==='callback')throw Error('export failed');return'ok';},fake,async()=>'203.0.113.9');
  if(failure==='none')await expect(run()).resolves.toBe('ok');else await expect(run()).rejects.toThrow();
  expect(active).toEqual(original);expect(patches).toBe(2);expect(seen[0]).toEqual([...original,{cidrBlock:'203.0.113.9/32',description:'capsule bounded migration export'}]);
 });
 it('refuses a broad source policy before any mutation',async()=>{const root=mkdtempSync(join(tmpdir(),'capsule-access-fixture-'));roots.push(root);let writes=0;const fake=async(method:string)=>{if(method==='PATCH')writes++;return{data:{ipAllowList:[{cidrBlock:'0.0.0.0/0'}]}};};await expect(withSourceAccess(root,async()=>{},fake,async()=>'203.0.113.9')).rejects.toThrow('Unexpected original access policy');expect(writes).toBe(0);});
 it('rejects transaction pooling and preserves verified TLS',()=>{expect(()=>directTls('postgres://synthetic:fixture@ep-fixture-pooler.neon.tech/db')).toThrow('Direct PostgreSQL required');expect(new URL(directTls('postgres://synthetic:fixture@ep-fixture.neon.tech/db?sslmode=require')).searchParams.get('sslmode')).toBe('verify-full');});
});
