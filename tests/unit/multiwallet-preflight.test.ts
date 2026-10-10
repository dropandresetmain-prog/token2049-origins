import {beforeEach,describe,expect,it,vi} from 'vitest';
import type {Db} from '../../src/infrastructure/db.js';
const hooks=vi.hoisted(()=>({load:vi.fn(),balance:vi.fn(),config:vi.fn()}));
vi.mock('../../clients/multiwallet/engines.js',async original=>({...await original<typeof import('../../clients/multiwallet/engines.js')>(),loadWalletEngine:hooks.load}));
vi.mock('../../clients/solana/hosted.js',()=>({solanaHostedBalances:hooks.balance}));
vi.mock('../../clients/solana/config.js',()=>({loadSolanaPayerConfig:hooks.config}));
import {preflightSource,readSourceReadiness} from '../../scripts/multiwallet/preflight.js';
const id='src_'+ '1'.repeat(32);
const wallet={source_id:id,payer_id:'payer_HOSTEDMCPDEMO',customer_id:'cus_HOSTEDMCPDEMO',rail:'solana',network:'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
 asset_id:'4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',public_address:'5iSWoZSucVSaNjtxeVC5TCJTN1RQBC6nScw8P32X5MZ6',signer_ref:'DEMO_SOLANA',ledger_namespace:'legacy',enabled:false,
 public_json:JSON.stringify({sourceId:id,rail:'solana',network:'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',publicAddress:'5iSWoZSucVSaNjtxeVC5TCJTN1RQBC6nScw8P32X5MZ6',displayAddress:'demo',assetId:'4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',readiness:'configured'})};
const db=(row:unknown=wallet)=>({get:vi.fn().mockResolvedValue(row)} as unknown as Db);
beforeEach(()=>{vi.clearAllMocks();hooks.load.mockResolvedValue({});hooks.config.mockReturnValue({payer:wallet.public_address});hooks.balance.mockResolvedValue({verified:true});});
describe('operator-only source preflight',()=>{
 it('refuses enabled signing before accessing storage or keys',async()=>{const d=db();await expect(preflightSource(d,{MULTIWALLET_SIGNING_ENABLED:'true'},id)).rejects.toThrow();expect(d.get).not.toHaveBeenCalled();expect(hooks.load).not.toHaveBeenCalled();});
 it('refuses invalid, missing and other-customer sources without initialization',async()=>{await expect(preflightSource(db(),{},'arbitrary')).rejects.toThrow();await expect(preflightSource(db(null),{},id)).rejects.toThrow();await expect(preflightSource(db({...wallet,customer_id:'cus_ANOTHER'}),{},id)).rejects.toThrow();expect(hooks.load).not.toHaveBeenCalled();expect(hooks.balance).not.toHaveBeenCalled();});
 it('initialization is offline and accesses only the explicitly named source',async()=>{const d=db();await preflightSource(d,{},id);expect(hooks.load).toHaveBeenCalledOnce();expect(hooks.load.mock.calls[0]?.[2]).toEqual(wallet);expect(d.get).toHaveBeenCalledWith(expect.any(String),id);expect(hooks.balance).not.toHaveBeenCalled();});
 it('readiness initializes and checks only the selected rail with its own environment',async()=>{const env={DEMO_SOLANA_SOLANA_PAYER_ADDRESS:wallet.public_address,DEMO_SUI_SUI_PAYER_ADDRESS:'unrelated'};const r=await readSourceReadiness(db(),env,id);expect(r.noSpend).toBe(true);expect(hooks.config).toHaveBeenCalledWith({SOLANA_PAYER_ADDRESS:wallet.public_address},{ledger:'external'});expect(hooks.balance).toHaveBeenCalledOnce();expect(hooks.load).toHaveBeenCalledOnce();});
 it('a selected-chain failure fails closed without another source attempt',async()=>{hooks.balance.mockResolvedValue({verified:false});await expect(readSourceReadiness(db(),{},id)).rejects.toThrow('Devnet readiness unavailable');expect(hooks.balance).toHaveBeenCalledOnce();expect(hooks.load).toHaveBeenCalledOnce();});
});
