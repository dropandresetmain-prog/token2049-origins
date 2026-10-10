import {afterEach,describe,expect,it} from 'vitest';import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,statSync,existsSync,unlinkSync,rmdirSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {protectedRuntimeFile,disposeRuntimeSecrets} from '../../clients/multiwallet/secret-files.js';import {SolanaLedger} from '../../clients/solana/ledger.js';
const roots:string[]=[];const env={RENDER:'true',MULTIWALLET_RENDER_SECRET_FILES:'true'};
const source=()=>{const root=mkdtempSync(join(tmpdir(),'capsule-secret-fixture-'));roots.push(root);const path=join(root,'consolidated-sui-payer-key');writeFileSync(path,'disposable fixture text');return{root,path};};
afterEach(()=>{disposeRuntimeSecrets();for(const r of roots.splice(0)){for(const name of ['consolidated-sui-payer-key','unrelated'])try{unlinkSync(join(r,name));}catch{}rmdirSync(r);}});
describe('selected Render signer mount compatibility',()=>{
 it('does not access or alter local paths when explicit Render staging is disabled',()=>{expect(protectedRuntimeFile('/missing',{})).toBe('/missing');});
 it('requires the Render runtime and a controlled consolidated secret filename',()=>{const s=source();expect(()=>protectedRuntimeFile(s.path,{MULTIWALLET_RENDER_SECRET_FILES:'true'},{mountRoot:s.root})).toThrow();expect(()=>protectedRuntimeFile(join(s.root,'unrelated'),env,{mountRoot:s.root})).toThrow();expect(()=>protectedRuntimeFile('/unrelated/consolidated-sui-payer-key',env)).toThrow();});
 it('copies the exact selected fixture into protected private storage and removes only its copy',()=>{const s=source(),p=protectedRuntimeFile(s.path,env,{mountRoot:s.root});expect(readFileSync(p,'utf8')).toBe(readFileSync(s.path,'utf8'));new SolanaLedger(p,'fixture').assertProtected();expect(protectedRuntimeFile(s.path,env,{mountRoot:s.root})).toBe(p);disposeRuntimeSecrets();expect(existsSync(p)).toBe(false);expect(existsSync(s.path)).toBe(true);});
 it('refuses oversized mounted content before creating a copy',()=>{const s=source();writeFileSync(s.path,'x'.repeat(8193));expect(()=>protectedRuntimeFile(s.path,env,{mountRoot:s.root})).toThrow('bounded signer secret file required');});
});
