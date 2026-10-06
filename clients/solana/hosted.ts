/** Private hosted Devnet service. Reuses the proven payer/sponsor; never owns commerce execution. */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { createBridge, listenPrivate } from '../payer/bridge.js';
import { readSecretFile } from '../payer/config.js';
import { loadSolanaPayerConfig, type SolanaPayerConfig } from './config.js';
import { SolanaBridgePayer } from './bridge.js';
import { startSolanaFacilitator } from './facilitator.js';
import { SolanaLedger, scanHistory } from './ledger.js';
import { loadSigner } from './signer.js';
import { SolanaRpc } from '../../src/funding/solana/rpc.js';
import { NETWORK } from '../../src/funding/solana/wire.js';
import { privateFacilitatorOrigin } from '../../src/funding/solana/config.js';
import { createSolanaFacilitatorClient } from '../../src/funding/solana/facilitator.js';

export function hostedSolanaConfig(env: NodeJS.ProcessEnv) {
  const cfg=loadSolanaPayerConfig(env);
  const pinned=env.SOLANA_FACILITATOR_TRUSTED_PRIVATE_ORIGIN;
  const origin=pinned ? privateFacilitatorOrigin(pinned) : null;
  const port=Number(env.SOLANA_PAYER_BRIDGE_PORT ?? '8789');
  const facilitatorPort=Number(origin?.port);
  const hosts=(env.SOLANA_PAYER_BRIDGE_ALLOWED_HOSTS ?? '').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
  if (!origin || cfg.facilitatorUrl !== origin.origin || !Number.isInteger(facilitatorPort) || facilitatorPort<1 || facilitatorPort>65535 || !Number.isInteger(port) || port<1 || port>65535 || port===facilitatorPort) throw new Error('hosted private Solana origins/ports invalid');
  if (!hosts.length || hosts.some(h=>! /^[a-z0-9][a-z0-9-]{0,62}:[0-9]{1,5}$/.test(h) || Number(h.split(':')[1])!==port)) throw new Error('SOLANA_PAYER_BRIDGE_ALLOWED_HOSTS invalid');
  if (!env.SOLANA_HOSTED_DATA_DIRECTORY || resolve(env.SOLANA_HOSTED_DATA_DIRECTORY)!==cfg.ledgerDirectory || dirname(cfg.payerLedger)!==cfg.ledgerDirectory || dirname(cfg.sponsorLedger)!==cfg.ledgerDirectory) throw new Error('persistent hosted data directory required');
  if (!cfg.gatewayUrl.startsWith('https://') || new URL(cfg.gatewayUrl).pathname!=='/') throw new Error('hosted public gateway origin required');
  if (new Set([cfg.payer,cfg.sponsor,cfg.payee]).size!==3 || cfg.source===cfg.tokenAccount) throw new Error('hosted payer/sponsor/treasury identities must be distinct');
  const token=readSecretFile(env.SOLANA_PAYER_BRIDGE_TOKEN_FILE ?? '', 'SOLANA_PAYER_BRIDGE_TOKEN_FILE');
  const facilitatorToken=readSecretFile(cfg.facilitatorTokenFile,'SOLANA_FACILITATOR_TOKEN_FILE');
  const gatewayToken=readSecretFile(cfg.tokenFile,'SOLANA_GATEWAY_TOKEN_FILE');
  if (token.length<24 || facilitatorToken.length<24 || gatewayToken.length<24 || new Set([token,facilitatorToken,gatewayToken]).size!==3) throw new Error('hosted Solana tokens must be strong and distinct');
  return { cfg, port, facilitatorPort, hosts, facilitatorHosts:[origin.host], token };
}

/** Missing, corrupt, incomplete, locked or exhausted history never advertises a connected wallet. */
export function assertHostedHistory(cfg: SolanaPayerConfig): void {
  for (const [path,owner] of [[cfg.payerLedger,cfg.payer],[cfg.sponsorLedger,cfg.sponsor]] as const) {
    if (existsSync(path+'.lock')) throw new Error('Solana crash lock requires reconciliation');
    const ledger=new SolanaLedger(path,owner), rows=ledger.read();
    if (rows.some(e=>!e.signature && (BigInt(e.amount)>0n || BigInt(e.fee)>0n))) throw new Error('incomplete Solana reservation requires reconciliation');
    const amount=rows.reduce((n,e)=>n+BigInt(e.amount),0n), fees=rows.reduce((n,e)=>n+BigInt(e.fee),0n);
    if (amount>=cfg.maxTotal || fees>=cfg.maxFees) throw new Error('Solana cumulative budget exhausted');
  }
}

export async function hostedSolanaReady(cfg: SolanaPayerConfig): Promise<boolean> {
  try {
    assertHostedHistory(cfg);
    await Promise.all([loadSigner(cfg.keyFile,cfg.payer),loadSigner(cfg.sponsorKeyFile,cfg.sponsor)]);
    const rpc=new SolanaRpc(cfg.rpcUrl);
    await rpc.assertNetwork();
    await rpc.assertMint(cfg.mint);
    await rpc.assertToken(cfg.source,cfg.mint,cfg.payer);
    await rpc.assertToken(cfg.tokenAccount,cfg.mint,cfg.payee);
    const [balance,sponsor,supported]=await Promise.all([
      rpc.call<{value:{amount:string}}>('getTokenAccountBalance',[cfg.source,{commitment:'finalized'}]),
      rpc.call<{value:number}>('getBalance',[cfg.sponsor,{commitment:'finalized'}]),
      createSolanaFacilitatorClient(cfg).getSupported(),
    ]);
    const preparation=supported.kinds[0]?.extra?.preparation as Record<string,unknown> | undefined;
    return preparation?.url===cfg.facilitatorUrl+'/prepare' && preparation.method==='POST' && preparation.authentication==='Bearer' && preparation.requiresFullySignedTransaction===true && BigInt(balance.value.amount)>0n && sponsor.value>=10001 && supported.kinds.length===1 &&
      supported.kinds[0]?.x402Version===2 && supported.kinds[0]?.scheme==='exact' && supported.kinds[0]?.network===NETWORK && supported.kinds[0]?.extra?.feePayer===cfg.sponsor &&
      supported.signers[NETWORK]?.length===1 && supported.signers[NETWORK]?.[0]===cfg.sponsor;
  } catch { return false; }
}

/** Explicit one-time initialization scans finalized history before creating either file. No reset path. */
export async function initializeHostedSolanaHistory(cfg: SolanaPayerConfig): Promise<void> {
  if (existsSync(cfg.payerLedger)||existsSync(cfg.sponsorLedger)) throw new Error('hosted history already exists; refusing initialization');
  await Promise.all([loadSigner(cfg.keyFile,cfg.payer),loadSigner(cfg.sponsorKeyFile,cfg.sponsor)]);
  const rpc=new SolanaRpc(cfg.rpcUrl);
  const payer=await scanHistory(rpc,cfg.payer), sponsor=await scanHistory(rpc,cfg.sponsor);
  SolanaLedger.protectDirectory(cfg.ledgerDirectory);
  new SolanaLedger(cfg.payerLedger,cfg.payer).initialize(payer);
  new SolanaLedger(cfg.sponsorLedger,cfg.sponsor).initialize(sponsor);
}

export async function startHostedSolana(env: NodeJS.ProcessEnv): Promise<Server[]> {
  const {cfg,port,facilitatorPort,hosts,facilitatorHosts,token}=hostedSolanaConfig(env);
  assertHostedHistory(cfg);
  const facilitator=await startSolanaFacilitator(cfg,facilitatorPort,{allowedHosts:facilitatorHosts});
  try {
    const payer=new SolanaBridgePayer({config:cfg,ready:()=>hostedSolanaReady(cfg)});
    const bridge=createBridge({payer,token,access:{mode:'private',allowedHosts:hosts},source:()=>payer.source()});
    await listenPrivate(bridge,port);
    return [bridge,facilitator];
  } catch (e) { await new Promise<void>(r=>facilitator.close(()=>r())); throw e; }
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.includes('--history-fingerprint')) {
      const cfg=hostedSolanaConfig(process.env).cfg;
      assertHostedHistory(cfg);
      console.log(JSON.stringify({ noSpend:true, histories:[['payer',cfg.payerLedger,cfg.payer],['sponsor',cfg.sponsorLedger,cfg.sponsor]].map(([role,path,owner])=>({role,owner,sha256:createHash('sha256').update(readFileSync(path!)).digest('hex'),entries:new SolanaLedger(path!,owner!).read().length})) }));
    }
    else if (process.argv.includes('--init-history')) { await initializeHostedSolanaHistory(hostedSolanaConfig(process.env).cfg); console.log('Hosted Solana histories initialized from finalized chain; no spend'); }
    else { const servers=await startHostedSolana(process.env); console.log('Private hosted Solana service listening');
      for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{for (const server of servers)server.close();}); }
  } catch { console.error('Hosted Solana configuration, history or readiness failed; no automatic reset/retry'); process.exitCode=1; }
}
