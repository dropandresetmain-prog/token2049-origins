import { afterEach,describe,it,expect } from 'vitest';
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadHostedMcpConfig } from '../../src/channels/hosted-mcp/config.js';
import { parseSolanaConfig,trustedFacilitator } from '../../src/funding/solana/config.js';
import { facilitatorRequestAllowed } from '../../clients/solana/facilitator.js';
import { assertHostedHistory,hostedSolanaConfig } from '../../clients/solana/hosted.js';
import { SolanaLedger } from '../../clients/solana/ledger.js';
import type { SolanaPayerConfig } from '../../clients/solana/config.js';
import { scenario } from '../support/solana.js';
const dirs:string[]=[];
afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})));
const temp=()=>{const d=mkdtempSync(join(tmpdir(),'hosted-solana-'));dirs.push(d);return d;};
describe('hosted Solana boundaries',()=>{
  it('opts in to exactly one private facilitator origin; existing defaults reject remote HTTP',async()=>{
    const s=await scenario(),origin='http://t2o-solana-payer:8790';
    expect(trustedFacilitator(origin)).toBe(false);
    expect(parseSolanaConfig({...s.env,SOLANA_FACILITATOR_URL:origin,SOLANA_FACILITATOR_TRUSTED_PRIVATE_ORIGIN:origin}).ok).toBe(true);
    for(const url of ['http://other:8790','http://t2o-solana-payer:8791','http://10.1.1.1:8790','http://payer.example.com:8790',origin+'/prepare',origin+'?',origin+'#','http://user@t2o-solana-payer:8790']) expect(trustedFacilitator(url,undefined,origin),url).toBe(false);
  });
  it('requires private peer, exact Host and no browser Origin for facilitator access',()=>{
    const access={allowedHosts:['t2o-solana-payer:8790']};
    expect(facilitatorRequestAllowed('10.2.3.4','t2o-solana-payer:8790',undefined,access)).toBe(true);
    for(const [peer,host,origin] of [['8.8.8.8','t2o-solana-payer:8790',undefined],['10.2.3.4','evil:8790',undefined],['10.2.3.4','t2o-solana-payer:8790','null']])expect(facilitatorRequestAllowed(peer,host,origin,access)).toBe(false);
  });
  it('configures independent hosted payer bridges and credentials without altering Cardano',()=>{
    const d=temp(),pass=join(d,'pass'),token=join(d,'token'),solanaToken=join(d,'solana-token');writeFileSync(solanaToken,'solana-bridge-0123456789012345');writeFileSync(pass,'owner-passcode-01234567890');writeFileSync(token,'bridge-token-0123456789012345');
    const env={MCP_HOSTED_ENABLED:'true',MCP_PUBLIC_URL:'https://capsule.example',PUBLIC_BASE_URL:'https://capsule.example',MCP_OAUTH_OWNER_PASSCODE_FILE:pass,CARDANO_PAYER_BRIDGE_URL:'https://cardano-payer.example',CARDANO_PAYER_BRIDGE_TOKEN_FILE:token,SOLANA_PAYER_BRIDGE_URL:'http://solana:8789',SOLANA_PAYER_BRIDGE_TOKEN_FILE:solanaToken,MCP_PAYER_GATEWAY_TOKEN_SHA256:'a'.repeat(64),MCP_SOLANA_PAYER_GATEWAY_TOKEN_SHA256:'b'.repeat(64)};
    expect(loadHostedMcpConfig(env)).toMatchObject({cardanoBridge:{url:'https://cardano-payer.example'},solanaBridge:{url:'http://solana:8789'},solanaPayerClientId:'cli_HOSTEDSOLANAPAYER'});
    expect(()=>loadHostedMcpConfig({...env,SOLANA_PAYER_BRIDGE_TOKEN_FILE:token})).toThrow(/distinct/);
    expect(()=>loadHostedMcpConfig({...env,SOLANA_PAYER_BRIDGE_URL:env.CARDANO_PAYER_BRIDGE_URL})).toThrow(/private-network/);
    expect(()=>loadHostedMcpConfig({...env,MCP_SOLANA_PAYER_GATEWAY_TOKEN_SHA256:env.MCP_PAYER_GATEWAY_TOKEN_SHA256})).toThrow(/distinct/);
  });
  it('retains both histories across restart and fails closed for reservations, locks, missing or corrupt files',()=>{
    const d=temp();SolanaLedger.protectDirectory(d);
    const cfg={payerLedger:join(d,'payer.json'),sponsorLedger:join(d,'sponsor.json'),payer:'payer',sponsor:'sponsor',maxTotal:1000n,maxFees:10000n} as SolanaPayerConfig;
    const p=new SolanaLedger(cfg.payerLedger,cfg.payer),s=new SolanaLedger(cfg.sponsorLedger,cfg.sponsor);p.initialize([]);s.initialize([]);
    p.upsert({id:'one',signature:'immutable',amount:'100',fee:'0',header:'signed',createdAt:'2026-10-07T00:00:00Z'});
    assertHostedHistory(cfg);expect(new SolanaLedger(p.path,'payer').read()[0]?.signature).toBe('immutable');
    writeFileSync(s.path+'.lock','');expect(()=>assertHostedHistory(cfg)).toThrow(/lock/);rmSync(s.path+'.lock');
    s.upsert({id:'reservation',signature:null,amount:'0',fee:'1000',header:null,createdAt:'2026-10-07T00:00:00Z'});expect(()=>assertHostedHistory(cfg)).toThrow(/reservation/);
    writeFileSync(s.path,'corrupt');expect(()=>assertHostedHistory(cfg)).toThrow(/history/);rmSync(s.path);expect(()=>assertHostedHistory(cfg)).toThrow();
  });
  it('rejects non-durable hosted data, public facilitator and aliased signer identities',async()=>{
    const s=await scenario(),d=temp(),bridge=join(d,'bridge'),gateway=join(d,'gateway'),facilitator=join(d,'facilitator');
    writeFileSync(bridge,'bridge-'+ 'b'.repeat(32));writeFileSync(gateway,'gateway-'+'g'.repeat(32));writeFileSync(facilitator,'facilitator-'+'f'.repeat(32));
    const t=s.transfer,env={...s.env,SOLANA_FACILITATOR_URL:'http://solana:8790',SOLANA_FACILITATOR_TRUSTED_PRIVATE_ORIGIN:'http://solana:8790',SOLANA_FACILITATOR_TOKEN_FILE:facilitator,SOLANA_PAYER_RPC_URL:s.env.SOLANA_RPC_URL,SOLANA_PAYER_ADDRESS:t.payer,SOLANA_PAYER_TOKEN_ACCOUNT:t.source,SOLANA_PAYER_KEY_FILE:'unused',SOLANA_SPONSOR_KEY_FILE:'unused',SOLANA_LEDGER_DIRECTORY:d,SOLANA_HOSTED_DATA_DIRECTORY:d,SOLANA_PAYER_MAX_PURCHASE_BASE_UNITS:'10000',SOLANA_PAYER_MAX_TOTAL_BASE_UNITS:'10000',SOLANA_PAYER_MAX_COMMERCIAL_USD_MINOR:'1000',SOLANA_SPONSOR_MAX_TOTAL_FEE_LAMPORTS:'100000',SOLANA_GATEWAY_URL:'https://capsule.example',SOLANA_GATEWAY_TOKEN_FILE:gateway,SOLANA_PAYER_BRIDGE_TOKEN_FILE:bridge,SOLANA_PAYER_BRIDGE_PORT:'8789',SOLANA_PAYER_BRIDGE_ALLOWED_HOSTS:'solana:8789'};
    expect(hostedSolanaConfig(env).facilitatorPort).toBe(8790);
    expect(()=>hostedSolanaConfig({...env,SOLANA_HOSTED_DATA_DIRECTORY:join(d,'other')})).toThrow(/persistent/);
    expect(()=>hostedSolanaConfig({...env,SOLANA_GATEWAY_URL:'http://127.0.0.1:8787'})).toThrow(/gateway/);
    expect(()=>hostedSolanaConfig({...env,SOLANA_PAYER_ADDRESS:s.env.SOLANA_TREASURY_ADDRESS})).toThrow(/distinct/);
  });
});
