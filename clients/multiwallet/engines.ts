import {protectedRuntimeFile} from './secret-files.js';
import { SUI_TESTNET_NETWORK, SUI_TESTNET_USDC_TYPE } from '../../src/contracts/presentation.js';
import type { Db } from '../../src/infrastructure/db.js';
import type { WalletRecord } from '../../src/core/wallets.js';
import type { BridgePayer } from '../payer/bridge.js';
import { XLAYER_TESTNET_NETWORK, XLAYER_TESTNET_USDT0 } from '../../src/contracts/presentation.js';
import { assertPinnedPolicy,cardanoPolicy,solanaPolicy,suiPolicy,xlayerPolicy } from './policy.js';
import { PayerError } from '../payer/errors.js';

/** Protected registration stores an environment prefix, never a caller-supplied URL or key path. */
export function sourceEnv(env:NodeJS.ProcessEnv,w:WalletRecord):NodeJS.ProcessEnv {
 if(!/^[A-Z][A-Z0-9_]{1,60}$/.test(w.signer_ref)) throw new PayerError('policy_violation','invalid registered signer reference');
 const selected:NodeJS.ProcessEnv={};
 const prefix=w.signer_ref+'_';
 for(const [k,v] of Object.entries(env)) if(k.startsWith(prefix)) selected[k.slice(prefix.length)]=v;
 return selected;
}
export async function loadWalletEngine(db:Db,env:NodeJS.ProcessEnv,w:WalletRecord):Promise<BridgePayer> {
 const e=sourceEnv(env,w);
 if(w.rail==='cardano'){
  const [{loadPayerConfig},{Payer},{PgPayerLedger},{deriveWalletAddress}]=await Promise.all([import('../payer/config.js'),import('../payer/payer.js'),import('../payer/pg-ledger.js'),import('../payer/hosted.js')]);
  const parsed=loadPayerConfig(e,{ledger:'external'});
  const config={...parsed,mnemonicFile:protectedRuntimeFile(parsed.mnemonicFile,env)};
  if(config.walletAddress!==w.public_address || config.network!==w.network || config.allowedAsset!==w.asset_id || deriveWalletAddress(config)!==w.public_address) throw new PayerError('policy_violation','registered Cardano signer mismatch');
  assertPinnedPolicy(w.policy_json,cardanoPolicy(config));
  // Legacy identity must already exist; consolidation must never initialize an empty replacement history.
  if(w.ledger_namespace==='legacy' && !(await db.get('SELECT public_address FROM hosted_payer_identity WHERE public_address=$1',w.public_address)))throw new PayerError('policy_violation','legacy Cardano identity missing');
  const ledger=w.ledger_namespace==='legacy' ? await PgPayerLedger.openExisting(db,{network:config.network,address:w.public_address}) : await PgPayerLedger.openWallet(db,w.ledger_namespace,{network:config.network,address:w.public_address});
  return new Payer({config,ledger});
 }
 if(w.rail==='solana'){
  const [{loadSolanaPayerConfig},{PgSolanaLedger},{createHostedSponsor},{paySolanaPurchase},{loadSigner}]=await Promise.all([import('../solana/config.js'),import('../solana/pg-ledger.js'),import('../solana/hosted-sponsor.js'),import('../solana/pay.js'),import('../solana/signer.js')]);
  const parsed=loadSolanaPayerConfig(e,{ledger:'external'});
  const config={...parsed,keyFile:protectedRuntimeFile(parsed.keyFile,env),sponsorKeyFile:protectedRuntimeFile(parsed.sponsorKeyFile,env)};
  if(config.payer!==w.public_address || w.network!=='solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' || config.mint!==w.asset_id || config.settlementMode!=='payer_broadcast' || config.payer===config.payee || config.source===config.tokenAccount) throw new PayerError('policy_violation','registered Solana signer mismatch');
  assertPinnedPolicy(w.policy_json,solanaPolicy(config));
  const feePolicy=await db.get<{max_fee_lamports:string}>('SELECT max_fee_lamports FROM wallet_sponsor_policy WHERE owner=$1',config.sponsor);
  if(feePolicy?.max_fee_lamports!==String(config.maxFees))throw new PayerError('policy_violation','shared sponsor policy missing or mismatched');
  await loadSigner(config.keyFile,config.payer);
  const payer=await PgSolanaLedger.open(db,'payer',config.payer,w.ledger_namespace==='legacy'?undefined:w.ledger_namespace);
  // The same sponsor identity must keep one canonical fee history across all wallets.
  const sponsor=await PgSolanaLedger.open(db,'sponsor',config.sponsor);
  const hooks=await createHostedSponsor(config,sponsor);
  return {pay:async id=>{await payer.assertAllowed(id);const r=await paySolanaPurchase(config,id,{ledger:payer,...hooks});if(r.status!==202)throw new PayerError('payment_rejected','Solana funding needs purchase readback');return {transferReference:r.signature,resumed:false};}};
 }
 if(w.rail==='sui'){
  const [{loadSuiPayerConfig},{PgSuiLedger},{paySuiPurchase},{loadSigner}]=await Promise.all([import('../sui/config.js'),import('../sui/pg-ledger.js'),import('../sui/pay.js'),import('../sui/signer.js')]);
  const parsed=loadSuiPayerConfig(e,{ledger:'external'});
  const config={...parsed,keyFile:protectedRuntimeFile(parsed.keyFile,env)};
  if(config.payer!==w.public_address || w.network!==SUI_TESTNET_NETWORK || w.asset_id!==SUI_TESTNET_USDC_TYPE) throw new PayerError('policy_violation','registered Sui signer mismatch');
  assertPinnedPolicy(w.policy_json,suiPolicy(config));
  loadSigner(config.keyFile,config.payer);
  const ledger=await PgSuiLedger.open(db,config.payer);
  return {pay:async id=>{const r=await paySuiPurchase(config,id,{ledger});if(r.status!==202)throw new PayerError('payment_rejected','Sui funding needs purchase readback');return {transferReference:r.digest,resumed:r.resumed};}};
 }
 if(w.rail==='xlayer'){
  const [{loadXLayerPayerConfig},{PgXLayerLedger},{payXLayerPurchase},{loadSigner}]=await Promise.all([import('../xlayer/config.js'),import('../xlayer/pg-ledger.js'),import('../xlayer/pay.js'),import('../xlayer/signer.js')]);
  const parsed=loadXLayerPayerConfig(e,{ledger:'external'});
  const config={...parsed,keyFile:protectedRuntimeFile(parsed.keyFile,env)};
  if(config.payer!==w.public_address || w.network!==XLAYER_TESTNET_NETWORK || w.asset_id!==XLAYER_TESTNET_USDT0) throw new PayerError('policy_violation','registered X Layer signer mismatch');
  assertPinnedPolicy(w.policy_json,xlayerPolicy(config));
  loadSigner(config.keyFile,config.payer);
  const ledger=await PgXLayerLedger.open(db,config.payer);
  return {pay:async id=>{const r=await payXLayerPurchase(config,id,{ledger});if(r.status!==202)throw new PayerError('payment_rejected','X Layer funding needs purchase readback');return {transferReference:r.hash,resumed:r.resumed};}};
 }
 throw new PayerError('policy_violation','registered rail unavailable');
}
