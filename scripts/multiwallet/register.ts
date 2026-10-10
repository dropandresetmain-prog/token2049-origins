import {readFileSync} from 'node:fs';
import {Db} from '../../src/infrastructure/db.js';
import {registerWallets} from './registration.js';
const args=process.argv.slice(2);
if(!args[0]||args.length>2||(args[1]!==undefined&&args[1]!=='--apply'))throw Error('usage: register.ts protected-manifest.json [--apply]');
const db=new Db(process.env.DATABASE_URL??'');
try{console.log(JSON.stringify(await registerWallets(db,JSON.parse(readFileSync(args[0],'utf8')),process.env,args[1]==='--apply')));}
catch{console.error('Registration refused; verify existing customer, imported identities, pinned policy and approval');process.exitCode=1;}
finally{await db.close();}
