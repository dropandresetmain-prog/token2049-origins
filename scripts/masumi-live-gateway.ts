import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { Pool } from 'pg';
import { Db } from '../src/infrastructure/db.js';
import { buildGateway } from '../src/composition.js';
import { systemClock } from '../src/infrastructure/clock.js';
import { createClient } from '../src/infrastructure/auth.js';
import { FixtureExecutor, FixtureFundingAdapter } from '../tests/support/fixtures.js';
const env: Record<string,string>={};for(const p of ['C:/Dev/token2049-origins/.env.local','C:/Dev/token2049-setup/masumi-payment-service/.env'])for(const l of readFileSync(p,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m&&!env[m[1]!])env[m[1]!]=m[2]!.replace(/^(['"])(.*)\1$/,'$2');}
const setup=JSON.parse(readFileSync('.runtime/native-setup.json','utf8')),pub=JSON.parse(readFileSync('.runtime/mps-public-state.json','utf8'));if(setup.registry.state!=='RegistrationConfirmed')throw new Error('Registration must be confirmed');
const schema='masumi_acceptance_20261006';const admin=new Pool({connectionString:env.DATABASE_URL});await admin.query('CREATE SCHEMA IF NOT EXISTS '+schema);await admin.end();
const db=new Db(env.DATABASE_URL!,schema);const hotel=new FixtureExecutor('nuitee','hotel',systemClock,12000n),funding=new FixtureFundingAdapter(systemClock);
const gw=await buildGateway({executors:[hotel],fundingAdapters:[funding],bankAdapters:[]},{env:{APP_ENV:'test',DATABASE_URL:env.DATABASE_URL,PUBLIC_BASE_URL:'http://127.0.0.1:3014',DEMO_PER_PURCHASE_LIMIT_USD_MINOR:'50000',SIMULATED_CARD_CAPACITY_USD_MINOR:'60000'},clock:systemClock,db,log:()=>{}});
gw.core.deps.config.serviceFeeBps=0;
const configPath='.runtime/live-config.json';let state: any=existsSync(configPath)?JSON.parse(readFileSync(configPath,'utf8')):null;
if(!state){const identity=await createClient(db,{displayName:'Masumi Synthetic Owner',channel:'sokosumi',label:'native-acceptance'},new Date().toISOString());state={owner:identity.customerId,gatewayToken:identity.token,channelToken:randomBytes(32).toString('hex'),nonce:randomBytes(12).toString('hex')};writeFileSync(configPath,JSON.stringify(state));}
const coreServer=gw.app.listen(3014,'127.0.0.1');await gw.worker.start(1000);
const w=pub.wallets.find((w:any)=>w.type==='Selling'),source=pub.sources.find((s:any)=>s.network==='Preprod');const log=openSync('.runtime/wrapper.log','a');
const child=spawn(process.execPath,['node_modules/tsx/dist/cli.mjs','src/channels/sokosumi/main.ts'],{cwd:process.cwd(),windowsHide:true,stdio:['ignore',log,log],env:{...process.env,SOKOSUMI_DATABASE_URL:env.DATABASE_URL,SOKOSUMI_DATABASE_SCHEMA:schema,MASUMI_PAYMENT_SERVICE_URL:'http://127.0.0.1:3012',MASUMI_PAYMENT_API_KEY:env.MASUMI_PAYMENT_API_KEY,MASUMI_AGENT_ID:setup.registry.agentIdentifier,MASUMI_SELLER_VKEY:w.walletVkey,MASUMI_SELLER_ADDRESS:w.walletAddress,MASUMI_CONTRACT_ADDRESS:source.smartContractAddress,MASUMI_PAYMENT_ASSET_UNIT:'16a55b2a349361ff88c03788f93e1e966e5d689605d044fef722ddde0014df10745553444d',MASUMI_SERVICE_FEE_BASE_UNITS:'10000',MASUMI_BLOCKFROST_PROJECT_ID:env.BLOCKFROST_API_KEY_PREPROD,MASUMI_NETWORK:'preprod',SOKOSUMI_PORT:'3013',GATEWAY_URL:'http://127.0.0.1:3014',SOKOSUMI_CUSTOMER_ID:state.owner,MASUMI_CHANNEL_AUTH_TOKEN:state.channelToken,GATEWAY_API_TOKEN:state.gatewayToken}});
writeFileSync('.runtime/live-pid.json',JSON.stringify({pid:process.pid,wrapperPid:child.pid}));console.log(JSON.stringify({coreStarted:true,wrapperSpawned:true,dependencies:'fixture merchant and direct principal only'}));
process.on('SIGTERM',async()=>{child.kill();await gw.worker.stop();coreServer.close();await db.close();});
