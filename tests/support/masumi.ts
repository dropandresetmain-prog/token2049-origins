import { MasumiClient, TUSDM, type FeePayment, type MasumiConfig } from '../../src/integrations/masumi/client.js';
import type { FeeBinding } from '../../src/funding/masumi/index.js';
export const config: MasumiConfig = { baseUrl: 'http://127.0.0.1:3012', token: 'private-test-token', agentIdentifier: 'ab'.repeat(60), sellerVkey: 'cd'.repeat(28), sellerAddress: 'addr_test1seller', contractAddress: 'addr_test1fixturecontract', assetUnit: TUSDM, feeBaseUnits: '10000', blockfrostKey: 'private-test-blockfrost', blockfrostBaseUrl: 'https://cardano-preprod.blockfrost.io/api/v0' };
export const nonce = 'abcdef012345abcdef012345';
export const lockHash = '11'.repeat(32), resultTxHash = '22'.repeat(32), withdrawalHash = '77'.repeat(32), inputHash = '33'.repeat(32), buyerVkey = '44'.repeat(28);
export const binding: FeeBinding = { identifier: 'native-identifier', inputHash, nonce, payBy: 1000000, submitBy: 1400000, unlockAt: 2300000, disputeUntil: 3200000, expectedPayerVkey: buyerVkey };
const tx = (hash: string, state: string, previous: string | null) => ({ txHash: hash, status: 'Confirmed', confirmations: 20, blockTime: 100, layer: 'L1' as const, newOnChainState: state, previousOnChainState: previous });
export function makeMasumiFixture() {
  const p: FeePayment = { id: 'native-payment', blockchainIdentifier: binding.identifier, agentIdentifier: config.agentIdentifier, inputHash, payByTime: String(binding.payBy), submitResultTime: String(binding.submitBy), unlockTime: String(binding.unlockAt), externalDisputeUnlockTime: String(binding.disputeUntil), forceLayer: 'L1', onChainState: 'FundsLocked', RequestedFunds: [{ unit: TUSDM, amount: '10000' }], WithdrawnForSeller: [], WithdrawnForBuyer: [], sellerReturnAddress: null, resultHash: null, SmartContractWallet: { walletVkey: config.sellerVkey, walletAddress: 'addr_test1seller' }, PaymentSource: { network: 'Preprod', smartContractAddress: config.contractAddress, paymentSourceType: 'Web3CardanoV2' }, BuyerWallet: { walletVkey: buyerVkey }, CurrentTransaction: tx(lockHash, 'FundsLocked', null), TransactionHistory: [tx(lockHash, 'FundsLocked', null)], NextAction: { requestedAction: 'WaitingForExternalAction', resultHash: null } };
  const calls: Array<{ url: string; body?: any }> = [];
  let datumOverride: ((v:any,state:number)=>any) | undefined; let inputKind: 'spend'|'reference'|'collateral'='spend'; let payoutKind: 'spend'|'reference'|'collateral'='spend', tagHash=resultTxHash, tagIndex=0, payoutAddress=config.sellerAddress; let tagged = true; let spent = false, height = 1000, submitError = 0, createError = false, chainError = false;
  const output = (hash: string) => ({ tx_hash: hash, output_index: 0, address: config.contractAddress, amount: [{ unit: TUSDM, quantity: '10000' }], data_hash: hash, inline_datum: null });
  const datum = (state: number) => { const fields: any[] = Array.from({ length: 19 }, () => ({ bytes: '' })); fields[0] = { constructor: 0, fields: [{ constructor: 0, fields: [{ bytes: p.BuyerWallet!.walletVkey }] }, {constructor:1,fields:[]}] }; fields[2] = { constructor: 0, fields: [{constructor:0,fields:[{ bytes: config.sellerVkey }]}, {constructor:1,fields:[]}] }; fields[3]={constructor:1,fields:[]}; fields[7] = { bytes: nonce }; fields[8] = { bytes: p.agentIdentifier }; fields[10] = { bytes: p.inputHash }; fields[11] = { bytes: state ? p.resultHash : '' }; [p.payByTime,p.submitResultTime,p.unlockTime,p.externalDisputeUnlockTime].forEach((v,i) => fields[12+i] = { int: Number(v) }); fields[18] = { constructor: state, fields: [] }; return { json_value: { constructor: 0, fields } }; };
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = String(url), body = init?.body ? JSON.parse(String(init.body)) : undefined; calls.push({ url: u, body });
    const json = (data: unknown, status = 200) => Response.json(data, { status });
    if (u.includes('blockfrost')) {
      if (chainError) throw new Error('private chain failure');
      if (u.endsWith('/blocks/latest')) return json({ height });
      if (u.includes('/scripts/datum/') && u.endsWith(withdrawalHash)) return json({json_value:{constructor:0,fields:[{bytes:tagHash},{int:tagIndex}]}});
      if (u.includes('/scripts/datum/')) {const state=u.endsWith(resultTxHash)?1:0;const d=datum(state);return json(datumOverride?datumOverride(d,state):d);}
      if (u.includes('/addresses/')) return json(spent ? [] : [output(p.onChainState === 'ResultSubmitted' ? resultTxHash : lockHash)]);
      const hash = u.includes(withdrawalHash) ? withdrawalHash : u.includes(resultTxHash) ? resultTxHash : lockHash;
      if (hash === withdrawalHash && u.endsWith('/utxos')) return json({ outputs: [{ ...output(hash), address: payoutAddress, inline_datum: tagged ? 'reference-cbor' : null }], inputs: [{ tx_hash: resultTxHash, output_index: 0,reference:payoutKind==='reference',collateral:payoutKind==='collateral' }] });
      if (u.endsWith('/utxos')) return json({ outputs: [output(hash)], inputs: hash === resultTxHash ? [{ tx_hash: lockHash, output_index: 0,reference:inputKind==='reference',collateral:inputKind==='collateral' }] : [] });
      return json({ hash, block: 'block', block_height: 980, valid_contract: true });
    }
    if (u.endsWith('/payment') && body) {
      if (createError) throw new Error('secret lost response');
      p.inputHash = body.inputHash; p.payByTime = String(Date.parse(body.payByTime)); p.submitResultTime = String(Date.parse(body.submitResultTime)); p.unlockTime = String(Date.parse(body.unlockTime)); p.externalDisputeUnlockTime = String(Date.parse(body.externalDisputeUnlockTime));
      return json({ status: 'success', data: p });
    }
    if (u.includes('/payment?')) return json({ status: 'success', data: { Payments: [p] } });
    if (u.endsWith('/submit-result')) {
      if (submitError) return json({ error: { message: 'private credentials provider details' } }, submitError);
      p.resultHash = body.submitResultHash; p.onChainState = 'ResultSubmitted'; p.TransactionHistory = [tx(resultTxHash, 'ResultSubmitted', 'FundsLocked'), tx(lockHash, 'FundsLocked', null)]; p.CurrentTransaction = tx(resultTxHash, 'ResultSubmitted', 'FundsLocked');
      return json({ status: 'success', data: p });
    }
    return json({ status: 'success', data: p });
  };
  return { payoutAs:(kind:'spend'|'reference'|'collateral')=>{payoutKind=kind;}, wrongTag:(hash:string,index:number)=>{tagHash=hash;tagIndex=index;}, redirectPayout:()=>{payoutAddress='addr_test1attacker';}, alterDatum:(fn:(d:any,state:number)=>any)=>{datumOverride=fn;}, inputAs:(kind:'spend'|'reference'|'collateral')=>{inputKind=kind;}, untagPayout:()=>{tagged=false;}, withdraw: () => { p.onChainState = 'Withdrawn'; p.WithdrawnForSeller = [{unit:TUSDM,amount:'10000'}]; p.TransactionHistory = [tx(withdrawalHash,'Withdrawn','ResultSubmitted'), ...(p.TransactionHistory ?? [])]; p.CurrentTransaction = tx(withdrawalHash,'Withdrawn','ResultSubmitted'); }, client: new MasumiClient(config, fetchImpl as typeof fetch), p, calls, spend: () => { spent = true; }, loseFinality: () => { height = 990; }, failSubmit: (status: number) => { submitError = status; }, failCreate: () => { createError = true; }, failChain: () => { chainError = true; } };
}
