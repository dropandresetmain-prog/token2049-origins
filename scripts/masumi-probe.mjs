import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import pg from 'pg';
const file='C:/Dev/token2049-setup/masumi-payment-service/.env'; const e={};
for(const l of readFileSync(file,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m)e[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
const c=new pg.Client({connectionString:e.DATABASE_URL});await c.connect();await c.query('BEGIN READ ONLY');
const cols=await c.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_name IN ('HotWallet','PaymentSource') ORDER BY table_name,column_name");
console.log(JSON.stringify({columns:cols.rows}));
try{
const w=await c.query('SELECT id,"walletAddress","walletVkey",type,"paymentSourceId","collectionAddress","deletedAt" FROM "HotWallet"');
const s=await c.query('SELECT id,network,"smartContractAddress","policyId","paymentSourceType","deletedAt" FROM "PaymentSource"');
const hash=v=>createHash('sha256').update(String(v)).digest('hex').slice(0,16);
writeFileSync('.runtime/mps-public-state.json',JSON.stringify({wallets:w.rows,sources:s.rows},null,2));
console.log(JSON.stringify({wallets:w.rows.map(r=>({idHash:hash(r.id),publicAddressFingerprint:hash(r.walletAddress),type:r.type,sourceIdHash:hash(r.paymentSourceId),collectionFingerprint:hash(r.collectionAddress),active:!r.deletedAt})),sources:s.rows.map(r=>({sourceIdHash:hash(r.id),network:r.network,type:r.paymentSourceType,active:!r.deletedAt}))},null,2));
}catch(err){console.log(JSON.stringify({errorCode:err.code}));}
await c.query('ROLLBACK');await c.end();
