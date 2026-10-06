import { GENESIS, TOKEN_PROGRAM } from './wire.js';
import { trustedRpc } from './config.js';
export class SolanaRpc {
  constructor(readonly url: string, private readonly fetchImpl: typeof fetch = fetch) { if (!trustedRpc(url)) throw new Error('official Devnet RPC required'); }
  async call<T>(method: string, params: unknown[] = []): Promise<T> {
    for(let attempt=0;attempt<4;attempt++){
    const response = await this.fetchImpl(this.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), redirect: 'error', signal: AbortSignal.timeout(15000) });
    const body = await response.json() as { result?: T; error?: unknown };
    if(response.status===429 && attempt<3){await new Promise(resolve=>setTimeout(resolve,Math.min(15000,2000*2**attempt)));continue;}
    if (!response.ok || body.error || !('result' in body)) throw new Error('Solana RPC unavailable');
    return body.result as T;
    }
    throw new Error('Solana RPC retry budget exhausted');
  }
  async assertNetwork(): Promise<void> { if (await this.call('getGenesisHash') !== GENESIS) throw new Error('Devnet genesis mismatch'); }
  async account(key: string): Promise<{ owner: string; type: string; info: Record<string, any> }> {
    const r = await this.call<{ value: { owner: string; data: { parsed: { type: string; info: Record<string, any> } } } | null }>('getAccountInfo', [key, { commitment: 'finalized', encoding: 'jsonParsed' }]);
    if (!r.value || r.value.owner !== TOKEN_PROGRAM || !r.value.data?.parsed) throw new Error('SPL account unavailable or wrong program');
    return { owner: r.value.owner, ...r.value.data.parsed };
  }
  async assertMint(mint: string): Promise<void> { const a = await this.account(mint); if (a.type !== 'mint' || a.info.decimals !== 6 || a.info.isInitialized !== true) throw new Error('mint mismatch'); }
  async assertToken(key: string, mint: string, owner: string): Promise<void> {
    const a = await this.account(key); if (a.type !== 'account' || a.info.mint !== mint || a.info.owner !== owner || a.info.state !== 'initialized' || a.info.tokenAmount?.decimals !== 6) throw new Error('token account mismatch');
  }
}
export interface ChainTransaction { blockTime: number | null; slot: number; transaction: [string, string]; meta: { err: unknown; fee: number; preTokenBalances: TokenBalance[]; postTokenBalances: TokenBalance[]; innerInstructions?: Array<{ instructions: unknown[] }> | null } | null; }
export interface TokenBalance { accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string; decimals: number }; }
