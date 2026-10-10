import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {Db} from '../../src/infrastructure/db.js';
import {parseSuiConfig} from '../../src/funding/sui/config.js';
import {SuiLedgerSnapshotSchema} from '../../clients/sui/ledger.js';
import {suiHistoryVerifier} from '../../clients/sui/history.js';
import {importSuiHistory} from '../../clients/sui/pg-ledger.js';
// Default is offline verification only. --apply requires the separately approved DB import and retired local signer.
const Manifest=z.object({owner:z.string(),snapshotFile:z.string(),snapshotSha256:z.string().regex(/^[a-f0-9]{64}$/),
 requirementsFile:z.string(),requirementsSha256:z.string().regex(/^[a-f0-9]{64}$/),gatewayOrigins:z.array(z.string()).min(1)}).strict();
export async function runHistoryImport(args:string[],env:NodeJS.ProcessEnv) {
 if(!args.length || args.some(a=>!['--apply','--manifest'].includes(a)&&a!==args[args.indexOf('--manifest')+1]))throw Error('use --manifest PATH [--apply]');
 const apply=args.includes('--apply');
 if(apply&&env.CAPSULE_APPROVED_SUI_IMPORT!=='true')throw Error('approved Sui import required');
 const m=Manifest.parse(JSON.parse(readFileSync(args[args.indexOf('--manifest')+1]??'','utf8')));
 const readPinned=(file:string,hash:string)=>{const text=readFileSync(file,'utf8');if(createHash('sha256').update(text).digest('hex')!==hash)throw Error('protected import source hash mismatch');return text;};
 const text=readPinned(m.snapshotFile,m.snapshotSha256),requirements=JSON.parse(readPinned(m.requirementsFile,m.requirementsSha256));
 const snapshot=SuiLedgerSnapshotSchema.parse(JSON.parse(text));
 if(snapshot.owner!==m.owner||!Array.isArray(requirements))throw Error('import identity or requirements invalid');
 const cfg=parseSuiConfig(env);if(!cfg.ok)throw Error('historical public Sui configuration missing');
 const verifyEntry=suiHistoryVerifier({owner:m.owner,requirements,gatewayOrigins:m.gatewayOrigins,config:cfg.config});
 for(const entry of snapshot.entries)await verifyEntry(entry);
 const summary={noSpend:true,mode:apply?'apply':'verify-only',owner:m.owner,sourceSha256:m.snapshotSha256,entryCount:snapshot.entries.length,
 amount:snapshot.entries.reduce((n,e)=>n+BigInt(e.amount),0n).toString(),gas:snapshot.entries.reduce((n,e)=>n+BigInt(e.gasBudget),0n).toString(),
 uncertain:snapshot.entries.filter(e=>e.status!=='accepted').length};
 if(apply){const db=new Db(env.DATABASE_URL??'');try{await importSuiHistory(db,{text,owner:m.owner,expectedSha256:m.snapshotSha256,verifyEntry});}finally{await db.close();}}
 return summary;
}
if(process.argv[1]?.endsWith('import-history.ts')||process.argv[1]?.endsWith('import-history.js')){
 runHistoryImport(process.argv.slice(2),process.env).then(result=>console.log(JSON.stringify(result))).catch(()=>{console.error('Sui import refused; verify approval, protected manifest hashes, requirements, identity and DB history');process.exitCode=1;});
}
