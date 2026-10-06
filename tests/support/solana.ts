import { generateKeyPairSigner, createTransactionMessage, pipe, setTransactionMessageFeePayerSigner, appendTransactionMessageInstructions, setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners, getBase64EncodedWireTransaction, blockhash, address } from '@solana/kit';
import { getSetComputeUnitLimitInstruction, getSetComputeUnitPriceInstruction } from '@solana-program/compute-budget';
import { getTransferCheckedInstruction } from '@solana-program/token';
import { MEMO_PROGRAM_ADDRESS } from '@x402/svm';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import type { PaymentPayload,PaymentRequirements } from '@x402/core/types';
import { createSolanaFundingAdapter } from '../../src/funding/solana/adapter.js';
import { NETWORK,TEST_MINT,TOKEN_PROGRAM,GENESIS,commitment,decodeTransaction } from '../../src/funding/solana/wire.js';
import type { FundingRequirementInput } from '../../src/contracts/ports.js';
import { ManualClock } from '../../src/infrastructure/clock.js';
export const clock=new ManualClock(Date.parse('2026-10-06T14:00:00Z'));
export async function scenario(changes: {amount?:string;mint?:string;destination?:string;memo?:string}={}) {
  const [payer,sponsor,source,destination,payee]=await Promise.all(Array.from({length:5},()=>generateKeyPairSigner()));
  let input:FundingRequirementInput={purchaseId:'pur_1234567890',quoteId:'quo_1234567890',quoteDigest:'digest',amount:{network:NETWORK,assetId:TEST_MINT,decimals:6,amountBaseUnits:'1000'},payTo:payee!.address,resourceUrl:'http://127.0.0.1:8787/v1/purchases/pur_1234567890/fund',description:'test',expiresAt:'2026-10-06T14:10:00Z',settlement:{policy:{mode:'scaled_testnet',numerator:1,denominator:1000},commercialPrincipal:{currency:'USD',amountMinor:'100',scale:2},commercialServiceFee:{currency:'USD',amountMinor:'0',scale:2},commercialTotal:{currency:'USD',amountMinor:'100',scale:2},principalBaseUnits:'1000',feeBaseUnits:'0',totalBaseUnits:'1000'}};
  const env={SOLANA_FACILITATOR_TOKEN_FILE:'unused-test-token',SOLANA_NETWORK:'devnet',SOLANA_RPC_URL:'https://api.devnet.solana.com',SOLANA_USDC_MINT:TEST_MINT,SOLANA_ASSET_DECIMALS:'6',SOLANA_TREASURY_ADDRESS:payee!.address,SOLANA_TREASURY_TOKEN_ACCOUNT:destination!.address,SOLANA_FEE_PAYER_ADDRESS:sponsor!.address,SOLANA_FACILITATOR_URL:'http://127.0.0.1:9876',SOLANA_MAX_PAYMENT_BASE_UNITS:'10000'};
  async function signForInput(input:FundingRequirementInput){
  const message=pipe(createTransactionMessage({version:0}),m=>setTransactionMessageFeePayerSigner(sponsor!,m),m=>setTransactionMessageLifetimeUsingBlockhash({blockhash:blockhash('11111111111111111111111111111111'),lastValidBlockHeight:100n},m),m=>appendTransactionMessageInstructions([
    getSetComputeUnitLimitInstruction({units:20000}),getSetComputeUnitPriceInstruction({microLamports:1}),
    getTransferCheckedInstruction({source:source!.address,mint:(changes.mint??TEST_MINT) as ReturnType<typeof address>,destination:(changes.destination??destination!.address) as ReturnType<typeof address>,authority:payer!,amount:BigInt(changes.amount??input.amount.amountBaseUnits),decimals:6}),
    {programAddress:address(MEMO_PROGRAM_ADDRESS),accounts:[],data:Buffer.from(changes.memo??commitment(input,destination!.address))}],m));
  const signed=await signTransactionMessageWithSigners(message),transaction=getBase64EncodedWireTransaction(signed),transfer=decodeTransaction(transaction);return {transaction,transfer};
  }
  let {transaction,transfer}=await signForInput(input);
  let finalized=true,throwSettle=false,submissions=0,accountsClosed=false;
  const fetchImpl=(async (_url:unknown,init:any)=>{
    const {method,params}=JSON.parse(init.body); let result:any;
    if(method==='getGenesisHash')result=GENESIS;
    if(method==='getAccountInfo'){const k=params[0];result={value:accountsClosed?null:{owner:TOKEN_PROGRAM,data:{parsed:k===TEST_MINT?{type:'mint',info:{decimals:6,isInitialized:true}}:{type:'account',info:{mint:TEST_MINT,owner:k===destination!.address?payee!.address:payer!.address,state:'initialized',tokenAmount:{decimals:6}}}}}};}
    if(method==='getTransaction')result=finalized?{slot:100,blockTime:Math.floor(clock.now().getTime()/1000),transaction:[transaction,'base64'],meta:{err:null,fee:10001,innerInstructions:[],preTokenBalances:[{accountIndex:transfer.accounts.indexOf(source!.address),mint:TEST_MINT,owner:payer!.address,uiTokenAmount:{amount:'20000',decimals:6}},{accountIndex:transfer.accounts.indexOf(destination!.address),mint:TEST_MINT,owner:payee!.address,uiTokenAmount:{amount:'20000',decimals:6}}],postTokenBalances:[{accountIndex:transfer.accounts.indexOf(source!.address),mint:TEST_MINT,owner:payer!.address,uiTokenAmount:{amount:(20000n-BigInt(transfer.amount)).toString(),decimals:6}},{accountIndex:transfer.accounts.indexOf(destination!.address),mint:TEST_MINT,owner:payee!.address,uiTokenAmount:{amount:(20000n+BigInt(transfer.amount)).toString(),decimals:6}}]}}:null;
    return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}),{status:200});
  }) as typeof fetch;
  const facilitator={verify:async()=>({isValid:true,payer:payer!.address}),settle:async()=>{submissions++;finalized=true;if(throwSettle)throw new Error('response lost');return {success:true,transaction:transfer.signature!,network:NETWORK as `${string}:${string}`,payer:payer!.address};},getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:NETWORK as `${string}:${string}`,extra:{feePayer:sponsor!.address}}],extensions:[],signers:{}})};
  const adapter=createSolanaFundingAdapter(env,{clock,fetchImpl,facilitator});
  const challenge=adapter.paymentRequirements(input),accepted=(challenge.accepts as PaymentRequirements[])[0]!;
  const payload:PaymentPayload={x402Version:2,resource:{url:input.resourceUrl},accepted,payload:{transaction}};
  const header=encodePaymentSignatureHeader(payload);
  return {adapter,input,header,transfer,transaction,env,fetchImpl,facilitator,forRequirement:async(next:FundingRequirementInput)=>{input=next;const signed=await signForInput(input);transaction=signed.transaction;transfer=signed.transfer;const accepted=(adapter.paymentRequirements(input).accepts as PaymentRequirements[])[0]!;return {header:encodePaymentSignatureHeader({x402Version:2,resource:{url:input.resourceUrl},accepted,payload:{transaction}}),transfer};},closeAccounts:()=>accountsClosed=true,setFinalized:(v:boolean)=>finalized=v,loseResponse:()=>throwSettle=true,submissions:()=>submissions};
}
