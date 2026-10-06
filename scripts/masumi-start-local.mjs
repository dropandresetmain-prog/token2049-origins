import {spawn} from 'node:child_process';
import {openSync,writeFileSync} from 'node:fs';
const log=openSync('.runtime/mps.log','a');
const child=spawn('C:/Program Files/nodejs/node.exe',['C:/Dev/token2049-setup/masumi-payment-service/node_modules/tsx/dist/cli.mjs','src/index.ts'],{cwd:'C:/Dev/token2049-setup/masumi-payment-service',env:{...process.env,OTEL_SDK_DISABLED:'true',AUTO_WITHDRAW_PAYMENTS:'true',BATCH_PAYMENT_INTERVAL:'10',CHECK_TX_INTERVAL:'15',CHECK_SUBMIT_RESULT_INTERVAL:'10',CHECK_WALLET_TRANSACTION_HASH_INTERVAL:'10',CHECK_COLLECTION_INTERVAL:'10',REGISTER_AGENT_INTERVAL:'10'},windowsHide:true,stdio:['ignore',log,log]});
writeFileSync('.runtime/mps-pid.json',JSON.stringify({pid:child.pid,at:new Date().toISOString()}));
console.log(JSON.stringify({started: true,pid:child.pid,privateLog:'.runtime/mps.log'}));
child.on('exit',code=>{console.log(JSON.stringify({exited:true,code}));process.exitCode=code??1;});
