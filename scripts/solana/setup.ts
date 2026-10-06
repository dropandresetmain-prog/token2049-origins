import { existsSync,writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve,dirname } from 'node:path';
import { loadSolanaPayerConfig } from '../../clients/solana/config.js';
import { SolanaLedger,scanHistory } from '../../clients/solana/ledger.js';
import { SolanaRpc } from '../../src/funding/solana/rpc.js';
const cfg=loadSolanaPayerConfig(process.env);
if(resolve(dirname(cfg.facilitatorTokenFile))!==cfg.ledgerDirectory)throw new Error('facilitator token must reside inside protected ledger directory');
SolanaLedger.protectDirectory(cfg.ledgerDirectory);
if(!existsSync(cfg.facilitatorTokenFile))writeFileSync(cfg.facilitatorTokenFile,randomBytes(32).toString('hex'),{mode:0o600,flag:'wx'});
const rpc=new SolanaRpc(cfg.rpcUrl);
for(const [path,owner] of [[cfg.payerLedger,cfg.payer],[cfg.sponsorLedger,cfg.sponsor]]){
  const ledger=new SolanaLedger(path!,owner!);
  if(!existsSync(path!))ledger.initialize(await scanHistory(rpc,owner!));
  await ledger.exclusive(()=>ledger.reconcile(rpc));
}
console.log('Solana payer and sponsor history reconciled; no keys loaded or transactions signed/submitted');
