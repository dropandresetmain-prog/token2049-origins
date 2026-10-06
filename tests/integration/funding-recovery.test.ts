import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startHarness,createFundablePurchase,type Harness} from '../support/harness.js';
import type {VerifiedFunding} from '../../src/contracts/ports.js';
import {Accounts,accountBalance,cryptoAsset,trialBalance} from '../../src/core/journal.js';
import {FIXTURE_ASSET,FIXTURE_NETWORK} from '../support/fixtures.js';
import {ManualClock} from '../../src/infrastructure/clock.js';

const asset=cryptoAsset(FIXTURE_NETWORK,FIXTURE_ASSET);
async function fund(h:Harness,id:string,amount:string,ref='recovery-test',state='confirmed') {
  return h.call('POST','/v1/purchases/'+id+'/fund',{token:h.alice.token,headers:{'payment-signature':'fixture:'+ref+':'+amount+':'+state}});
}
function purchase(h:Harness,id:string) {return h.gw.db.get<{state:string;payment_state:string;commerce_status:string;receipt_json:string}>('SELECT * FROM purchases WHERE id = ?',id)!;}
function balanced(h:Harness) {for(const v of trialBalance(h.gw.db).values()) expect(v).toBe(0n);}

describe('durable funding recovery and authority (local fixtures)',()=>{
  it('recovers an externally accepted transfer after process restart without settling or journaling twice',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'t2o-funding-')),path=join(dir,'gateway.db'),clock=new ManualClock();
    let h=await startHarness({dbPath:path,clock});
    try {
      const a=await createFundablePurchase(h),id=a.purchase.purchaseId;
      const verify=h.funding.verify.bind(h.funding);let chain:VerifiedFunding|undefined;
      Object.assign(h.funding,{prepare:()=>({ok:true,transferReference:'restart'}),recover:async()=>({ok:true,funding:chain!})});
      h.funding.verify=async(header,input)=>{
        expect(h.gw.db.get('SELECT id FROM funding_attempts WHERE purchase_id = ?',id)).toBeDefined();
        const result=await verify(header,input);if(!result.ok) throw Error('fixture rejected');chain=result.funding;
        throw Error('simulated process loss after external acceptance');
      };
      expect((await fund(h,id,a.required,'restart')).status).toBe(500);
      expect(accountBalance(h.gw.db,Accounts.cryptoTreasury,asset)).toBe(0n);
      await h.close();h.gw.db.close();h=await startHarness({dbPath:path,clock});
      h.gw.core.deps.config.publicBaseUrl='https://moved.example';
      Object.assign(h.funding,{recover:async(ref:string,input:{resourceUrl:string})=>{expect(ref).toBe('restart');expect(input.resourceUrl).toBe('http://127.0.0.1:0/v1/purchases/'+id+'/fund');return {ok:true,funding:chain!};}});
      clock.advance(16_000);await h.gw.worker.tick();await h.gw.worker.tick();
      expect(purchase(h,id).state).toBe('succeeded');expect(h.funding.verifyCalls).toBe(0);expect(h.retail.executeCalls).toBe(1);
      expect(h.gw.db.get<{n:number}>("SELECT COUNT(*) n FROM journal_entries WHERE kind='funding_received'")!.n).toBe(1);
      expect(accountBalance(h.gw.db,Accounts.cryptoTreasury,asset)).toBe(BigInt(a.required));balanced(h);
    } finally {await h.close();h.gw.db.close();rmSync(dir,{recursive:true,force:true});}
  });

  it('allows a new payment after a proven pre-settlement rejection, but locks ambiguous settlement',async()=>{
    const h=await startHarness();try {
      const a=await createFundablePurchase(h),id=a.purchase.purchaseId,verify=h.funding.verify.bind(h.funding);
      Object.assign(h.funding,{prepare:(header:string)=>({ok:true,transferReference:header.split(':')[1]!}),recover:async()=>({ok:false,code:'payment_invalid',reason:'not on chain'})});
      h.funding.verify=async()=>({ok:false,code:'payment_invalid',reason:'signature rejected',settlementAttempted:false});
      expect((await fund(h,id,a.required,'unsigned')).status).toBe(402);
      expect(purchase(h,id).payment_state).toBe('not_received');expect(h.gw.db.get('SELECT id FROM funding_attempts WHERE purchase_id = ?',id)).toBeUndefined();
      h.clock.advance(16_000);await h.gw.worker.tick();
      h.funding.verify=async()=>({ok:false,code:'payment_invalid',reason:'settlement timed out'});
      expect((await fund(h,id,a.required,'unsigned')).status).toBe(402);
      expect(purchase(h,id).payment_state).toBe('unknown');
      expect(h.gw.db.get<{n:number}>("SELECT COUNT(*) n FROM jobs WHERE kind='recover_funding' AND status='pending'")!.n).toBe(1);
      h.gw.db.run("UPDATE jobs SET status='dead' WHERE kind='recover_funding'");expect(h.gw.worker.recoverOrphans()).toBe(1);
      h.funding.verify=verify;
      expect((await fund(h,id,a.required,'second')).status).toBe(409);
      h.clock.advance(3_600_000);await h.gw.worker.tick();
      expect(purchase(h,id).state).toBe('expired');expect(h.retail.executeCalls).toBe(0);
      expect(h.gw.db.get<{status:string}>('SELECT status FROM reservations WHERE purchase_id = ?',id)!.status).toBe('released');
    } finally {await h.close();h.gw.db.close();}
  });

  it('records late recovered confirmation as unapplied and never executes expired authority',async()=>{
    const h=await startHarness();try {
      const a=await createFundablePurchase(h),id=a.purchase.purchaseId,verify=h.funding.verify.bind(h.funding);let chain:VerifiedFunding|undefined;
      Object.assign(h.funding,{prepare:()=>({ok:true,transferReference:'late-recovery'}),recover:async()=>({ok:true,funding:chain!})});
      h.funding.verify=async(header,input)=>{const r=await verify(header,input);if(r.ok)chain=r.funding;throw Error('response lost');};
      await fund(h,id,a.required,'late-recovery');h.clock.advance(3_600_000);await h.gw.worker.tick();
      expect(purchase(h,id).state).toBe('expired');expect(purchase(h,id).payment_state).toBe('confirmed');
      expect(accountBalance(h.gw.db,Accounts.customerUnapplied,asset)).toBe(-BigInt(a.required));expect(h.retail.executeCalls).toBe(0);balanced(h);
    } finally {await h.close();h.gw.db.close();}
  });

  it.each(['confirmed','submitted'])('retains %s funding returned after closure, including a confirmation job',async(state)=>{
    const h=await startHarness();try {
      const a=await createFundablePurchase(h),id=a.purchase.purchaseId,verify=h.funding.verify.bind(h.funding);
      h.funding.verify=async(header,input)=>{const r=await verify(header,input);h.clock.advance(3_600_000);return r;};
      expect((await fund(h,id,a.required,'late-response',state)).status).toBe(202);
      expect(purchase(h,id).state).toBe('expired');await h.gw.worker.tick();
      expect(purchase(h,id).payment_state).toBe('confirmed');expect(h.retail.executeCalls).toBe(0);
      expect(accountBalance(h.gw.db,Accounts.customerUnapplied,asset)).toBe(-BigInt(a.required));balanced(h);
    } finally {await h.close();h.gw.db.close();}
  });

  it('continues read-only confirmation after the retry threshold and handles expiry during confirmation',async()=>{
    const h=await startHarness();try {
      const a=await createFundablePurchase(h),id=a.purchase.purchaseId;
      await fund(h,id,a.required,'delayed','submitted');h.funding.confirmResult='submitted';
      h.gw.db.run("UPDATE jobs SET attempts = 11 WHERE kind='confirm_funding'");await h.gw.worker.tick();
      expect(h.gw.db.get<{status:string}>("SELECT status FROM jobs WHERE kind='confirm_funding'")!.status).toBe('pending');
      expect(h.gw.db.get("SELECT id FROM purchase_events WHERE type='funding.manual_required'")).toBeDefined();
      h.funding.confirm=async()=>{h.clock.advance(3_600_000);return {paymentState:'confirmed',confirmations:3,observedAt:h.clock.now().toISOString()};};
      h.gw.db.run("UPDATE jobs SET run_after = ? WHERE kind='confirm_funding'",h.clock.now().toISOString());await h.gw.worker.tick();
      expect(purchase(h,id).state).toBe('expired');expect(h.retail.executeCalls).toBe(0);
      expect(accountBalance(h.gw.db,Accounts.customerUnapplied,asset)).toBe(-BigInt(a.required));balanced(h);
    } finally {await h.close();h.gw.db.close();}
  });

  it('rechecks quote expiry after awaited readiness before starting a provider attempt',async()=>{
    const h=await startHarness();try {
      const a=await createFundablePurchase(h),id=a.purchase.purchaseId;await fund(h,id,a.required);
      const ready=h.retail.readiness.bind(h.retail);h.retail.readiness=async()=>{h.clock.advance(3_600_000);return ready();};
      await h.gw.worker.tick();expect(purchase(h,id).state).toBe('requires_reauthorization');expect(h.retail.executeCalls).toBe(0);
      expect(h.gw.db.get('SELECT id FROM execution_attempts WHERE purchase_id = ?',id)).toBeUndefined();
      expect(accountBalance(h.gw.db,Accounts.customerPrepayment,asset)).toBe(-BigInt(a.required));balanced(h);
    } finally {await h.close();h.gw.db.close();}
  });

  it.each([{currency:'EUR',scale:2,amountMinor:'4999'},{currency:'USD',scale:3,amountMinor:'49990'},{currency:'USD',scale:2,amountMinor:'9000'}])('holds exposure for unauthorized charge %j and keeps reconciliation live',async(charged)=>{
    const h=await startHarness();try {
      const a=await createFundablePurchase(h),id=a.purchase.purchaseId;await fund(h,id,a.required);
      const exec=h.retail.execute.bind(h.retail),retrieve=h.retail.retrieve.bind(h.retail);
      h.retail.execute=async ctx=>{const r=await exec(ctx);return r.kind==='succeeded'?{...r,chargedAmount:charged}:r;};
      h.retail.retrieve=async ctx=>{const r=await retrieve(ctx);return r.kind==='succeeded'?{...r,chargedAmount:charged}:r;};
      await h.gw.worker.tick();h.clock.advance(20_000);await h.gw.worker.tick();
      expect(purchase(h,id).state).toBe('unresolved');expect(purchase(h,id).receipt_json).toBeNull();
      const res=h.gw.db.get<{status:string;amount_minor:string}>('SELECT * FROM reservations WHERE purchase_id = ?',id)!;
      expect(res.status).toBe('held_unresolved');expect(res.amount_minor).toBe(charged.amountMinor==='9000'?'9000':'4999');
      expect(accountBalance(h.gw.db,Accounts.principalApplied,asset)).toBe(0n);
      expect(h.gw.db.get<{status:string}>("SELECT status FROM jobs WHERE kind='reconcile_purchase'")!.status).toBe('pending');
      h.retail.retrieve=retrieve;h.clock.advance(31_000);await h.gw.worker.tick();
      expect(purchase(h,id).state).toBe('unresolved');expect(h.gw.db.get<{amount_minor:string}>('SELECT amount_minor FROM reservations WHERE purchase_id = ?',id)!.amount_minor).toBe(res.amount_minor);
      h.retail.retrieve=async()=>({kind:'failed_definite',reason:'provider now claims cancelled',providerReference:null,evidence:[]});h.clock.advance(31_000);await h.gw.worker.tick();expect(purchase(h,id).state).toBe('unresolved');expect(h.gw.db.get<{status:string}>('SELECT status FROM reservations WHERE purchase_id = ?',id)!.status).toBe('held_unresolved');balanced(h);
    } finally {await h.close();h.gw.db.close();}
  });

  it('refreshes ticket issuance only with consistent paid readback and never regresses financial facts',async()=>{
    const h=await startHarness();try {
      const a=await createFundablePurchase(h),id=a.purchase.purchaseId;await fund(h,id,a.required);
      const exec=h.retail.execute.bind(h.retail),retrieve=h.retail.retrieve.bind(h.retail);
      h.retail.execute=async ctx=>{const r=await exec(ctx);return r.kind==='succeeded'?{...r,commerceStatus:'ticketing'}:r;};
      await h.gw.worker.tick();const journal=h.gw.db.get<{n:number}>('SELECT COUNT(*) n FROM journal_entries')!.n;
      h.retail.retrieve=async ctx=>{const r=await retrieve(ctx);return r.kind==='succeeded'?{...r,commerceStatus:'held',merchantPaymentStatus:'none'}:r;};
      h.clock.advance(31_000);await h.gw.worker.tick();expect(purchase(h,id).commerce_status).toBe('ticketing');
      expect(h.gw.db.get<{status:string}>("SELECT status FROM jobs WHERE kind='refresh_outcome'")!.status).toBe('pending');
      h.retail.retrieve=async()=>({kind:'unknown',reason:'pending',providerReference:null,evidence:[]});h.clock.advance(31_000);await h.gw.worker.tick();
      expect(h.gw.db.get<{status:string}>("SELECT status FROM jobs WHERE kind='refresh_outcome'")!.status).toBe('pending');
      h.retail.retrieve=async()=>{throw Error('provider transport failure');};
      h.gw.db.run("UPDATE jobs SET attempts=11 WHERE kind='refresh_outcome'");h.clock.advance(31_000);await h.gw.worker.tick();
      expect(h.gw.db.get<{status:string}>("SELECT status FROM jobs WHERE kind='refresh_outcome'")!.status).toBe('pending');expect(h.gw.db.get("SELECT id FROM purchase_events WHERE type='outcome.manual_required'")).toBeDefined();
      h.gw.db.run("UPDATE jobs SET run_after=? WHERE kind='refresh_outcome'",h.clock.now().toISOString());
      h.retail.retrieve=async ctx=>{const r=await retrieve(ctx);return r.kind==='succeeded'?{...r,commerceStatus:'ticketed'}:r;};
      h.clock.advance(31_000);await h.gw.worker.tick();expect(purchase(h,id).commerce_status).toBe('ticketed');
      expect(JSON.parse(purchase(h,id).receipt_json).commerceStatus).toBe('ticketed');
      expect(h.gw.db.get<{n:number}>('SELECT COUNT(*) n FROM journal_entries')!.n).toBe(journal);balanced(h);
    } finally {await h.close();h.gw.db.close();}
  });
});


describe('provider side-effect authority checkpoints (local fixtures)',()=>{
  it.each(['create_attempt','book_attempt','pay_attempt','pay_click'])('refuses expired %s before the external side effect',async step=>{
    const h=await startHarness();try {
      const a=await createFundablePurchase(h);await fund(h,a.purchase.purchaseId,a.required);let sends=0;
      h.retail.execute=async ctx=>{h.clock.set(ctx.quote.expiresAt);await ctx.checkpoint(step,{});sends++;return {kind:'unknown',reason:'must not send',providerReference:null,evidence:[]};};
      await h.gw.worker.tick();expect(sends).toBe(0);expect(purchase(h,a.purchase.purchaseId).state).toBe('failed');
      expect(accountBalance(h.gw.db,Accounts.customerPrepayment,asset)).toBe(-BigInt(a.required));balanced(h);
    } finally {await h.close();h.gw.db.close();}
  });
});
