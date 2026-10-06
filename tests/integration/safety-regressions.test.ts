import { describe, it, expect } from 'vitest';
import { startHarness, createFundablePurchase } from '../support/harness.js';
import { Accounts, accountBalance, cryptoAsset, trialBalance } from '../../src/core/journal.js';
import { FIXTURE_NETWORK, FIXTURE_ASSET } from '../support/fixtures.js';
import { capacitySnapshot } from '../../src/core/capacity.js';
import { fiatAsset } from '../../src/core/journal.js';
import { createClient, authenticate } from '../../src/infrastructure/auth.js';
import { Db } from '../../src/infrastructure/db.js';
import { redact } from '../../src/infrastructure/redact.js';

describe('financial safety regressions (local fixtures)', () => {
  it('retains numeric provider references across durable checkpoints while masking PII', async () => {
    const h = await startHarness();
    try {
      const a = await createFundablePurchase(h);
      await h.call('POST', '/v1/purchases/' + a.purchase.purchaseId + '/fund', { token:h.alice.token, headers:{'payment-signature':'fixture:numeric-ref:' + a.required} });
      const reference = '1234567890123456789';
      h.retail.execute = async ctx => {
        await ctx.checkpoint('order', {providerReference:reference,email:'hidden@example.com'});
        return {kind:'unknown',reason:'test interruption',providerReference:reference,evidence:[]};
      };
      await h.gw.worker.tick();
      let readReference: unknown;
      h.retail.retrieve = async ctx => {
        readReference=ctx.checkpoints.order?.providerReference;
        expect(ctx.checkpoints.order?.email).toBe('[REDACTED_PII]');
        return {kind:'unknown',reason:'test readback pending',providerReference:reference,evidence:[]};
      };
      h.clock.advance(20_000);
      await h.gw.worker.tick();
      expect(readReference).toBe(reference);
    } finally {await h.close();h.gw.db.close();}
  });

  it('journals late confirmation after closure as a refundable obligation exactly once', async () => {
    const h=await startHarness();
    try {
      const a=await createFundablePurchase(h);
      h.funding.confirmResult='submitted';
      const funded=await h.call('POST','/v1/purchases/'+a.purchase.purchaseId+'/fund',{token:h.alice.token,headers:{'payment-signature':'fixture:late-confirm:'+a.required+':submitted'}});
      expect(funded.status).toBe(202);
      h.gw.core.expirePurchase(a.purchase.purchaseId,'test quote closure');
      h.funding.confirmResult='confirmed';
      await h.gw.worker.tick();
      await h.gw.worker.tick();
      const asset=cryptoAsset(FIXTURE_NETWORK,FIXTURE_ASSET);
      expect(accountBalance(h.gw.db,Accounts.cryptoTreasury,asset)).toBe(BigInt(a.required));
      expect(accountBalance(h.gw.db,Accounts.customerUnapplied,asset)).toBe(-BigInt(a.required));
      expect(h.retail.executeCalls).toBe(0);
      for(const sum of trialBalance(h.gw.db).values()) expect(sum).toBe(0n);
      expect(h.gw.db.get<{n:number}>("SELECT COUNT(*) n FROM journal_entries WHERE kind='funding_received'")?.n).toBe(1);
    } finally {await h.close();h.gw.db.close();}
  });

  it('accounts for provider test balance without claiming a card liability',async()=>{
    const h=await startHarness();
    try {
      const a=await createFundablePurchase(h);
      await h.call('POST','/v1/purchases/'+a.purchase.purchaseId+'/fund',{token:h.alice.token,headers:{'payment-signature':'fixture:provider-balance:'+a.required}});
      const execute=h.retail.execute.bind(h.retail);
      h.retail.execute=async ctx=>{const r=await execute(ctx);return r.kind==='succeeded'?{...r,merchantPaymentStatus:'test_balance_paid'}:r;};
      await h.gw.worker.tick();
      const asset=fiatAsset('USD',2);
      expect(accountBalance(h.gw.db,Accounts.cardPayable,asset)).toBe(0n);
      expect(accountBalance(h.gw.db,Accounts.providerTestBalanceUsed,asset)).toBe(-4999n);
      expect(capacitySnapshot(h.gw.db,'USD')?.availableMinor).toBe(15001n);
      const receipt=(await h.call('GET','/v1/purchases/'+a.purchase.purchaseId,{token:h.alice.token})).body.purchase.receipt;
      expect(receipt.limitations.join(' ')).toContain('not card spend');
      expect(receipt.treasuryEffect.some((e:{account:string})=>e.account===Accounts.cardPayable)).toBe(false);
    } finally {await h.close();h.gw.db.close();}
  });

  it('does not grant MCP clients funding scope by default',()=>{
    const db=new Db(':memory:');
    try {
      const client=createClient(db,{displayName:'Test MCP',channel:'mcp',label:'mcp'},new Date().toISOString());
      const actor=authenticate(db,'Bearer '+client.token,'test');
      expect(actor.scopes.has('purchases:fund')).toBe(false);
      expect(actor.scopes.has('purchases:write')).toBe(true);
    } finally {db.close();}
  });

  it('redacts gateway bearer tokens even in unstructured messages',()=>{
    expect(redact('token=t2o_ABCDEFGHIJKLMNOP12345678')).toBe('token=[REDACTED_TOKEN]');
  });
});
