import { chmodSync, closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, lstatSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { NETWORK, TEST_MINT } from '../../src/funding/solana/wire.js';
import type { SolanaRpc } from '../../src/funding/solana/rpc.js';
const Entry = z.object({ id: z.string(), signature: z.string().nullable(), amount: z.string().regex(/^[0-9]+$/), fee: z.string().regex(/^[0-9]+$/), header: z.string().nullable(), createdAt: z.string() }).strict();
const Ledger = z.object({ version: z.literal(1), owner: z.string(), network: z.literal(NETWORK), mint: z.literal(TEST_MINT), entries: z.array(Entry) }).strict();
export type SolanaLedgerEntry = z.infer<typeof Entry>;
/** Persist directory entries as well as file contents on the Linux hosted disk. */
function syncDirectory(path: string): void {
  if (process.platform === 'win32') return; // Windows cannot open directory handles through this API.
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
/** Fail closed on stale locks, missing/corrupt history, or access by other local users. No automatic cap reset. */
export class SolanaLedger {
  constructor(readonly path: string, readonly owner: string) { if (!isAbsolute(path)) throw new Error('absolute ledger path required'); }
  static protectDirectory(path: string): void {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (process.platform === 'win32') {
      const sid = execFileSync('powershell.exe', ['-NoProfile','-Command','[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'], { encoding: 'utf8' }).trim();
      execFileSync('icacls.exe', [path, '/inheritance:r', '/grant:r', '*' + sid + ':(OI)(CI)F'], { stdio: 'pipe' });
    } else chmodSync(path, 0o700);
  }
  assertProtected(): void {
    if (lstatSync(dirname(this.path)).isSymbolicLink() || lstatSync(this.path).isSymbolicLink()) throw new Error('ledger links forbidden');
    if (process.platform === 'win32') {
      const script = "$p='" + this.path.replaceAll("'", "''") + "';" + ' $a=Get-Acl -LiteralPath $p; $me=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $bad=@($a.Access | Where-Object { $_.AccessControlType -eq "Allow" -and $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value -notin @($me,"S-1-5-18","S-1-5-32-544") }); if ($bad.Count -gt 0) { exit 1 }';
      try { execFileSync('powershell.exe', ['-NoProfile','-Command',script], { stdio: 'pipe' }); } catch { throw new Error('ledger access control is not protected'); }
    } else if ((lstatSync(this.path).mode & 0o077) !== 0 || (lstatSync(dirname(this.path)).mode & 0o077) !== 0) throw new Error('ledger permissions unsafe');
  }
  read(): SolanaLedgerEntry[] {
    this.assertProtected();
    let parsed: z.infer<typeof Ledger>; try { parsed = Ledger.parse(JSON.parse(readFileSync(this.path,'utf8'))); } catch { throw new Error('ledger history unavailable; reconciliation required'); }
    if (parsed.owner !== this.owner || new Set(parsed.entries.map(e => e.id)).size !== parsed.entries.length || new Set(parsed.entries.filter(e => e.signature).map(e => e.signature)).size !== parsed.entries.filter(e => e.signature).length) throw new Error('ledger identity or history conflict');
    return parsed.entries;
  }
  initialize(entries: SolanaLedgerEntry[]): void {
    const fd = openSync(this.path,'wx',0o600); try { writeFileSync(fd,JSON.stringify({version:1,owner:this.owner,network:NETWORK,mint:TEST_MINT,entries})); fsyncSync(fd); } finally { closeSync(fd); }
    syncDirectory(dirname(this.path));
  }
  private write(entries: SolanaLedgerEntry[]): void {
    const tmp = this.path + '.tmp', fd = openSync(tmp,'wx',0o600);
    try { writeFileSync(fd,JSON.stringify({version:1,owner:this.owner,network:NETWORK,mint:TEST_MINT,entries})); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp,this.path);
    syncDirectory(dirname(this.path));
  }
  upsert(entry: SolanaLedgerEntry): void { this.write([...this.read().filter(e => e.id !== entry.id),entry]); }
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    this.read(); let fd: number; try { fd = openSync(this.path+'.lock','wx',0o600); } catch { throw new Error('ledger locked; active signer or manual crash recovery required'); }
    try { return await fn(); } finally { closeSync(fd); unlinkSync(this.path+'.lock'); }
  }
  assertCaps(amount: bigint, fee: bigint, maxAmount: bigint, maxFee: bigint): void {
    const entries = this.read();
    if (entries.reduce((sum,e)=>sum+BigInt(e.amount),0n)+amount > maxAmount || entries.reduce((sum,e)=>sum+BigInt(e.fee),0n)+fee > maxFee) throw new Error('Solana cumulative spend or fee cap exceeded');
  }
  async reconcile(rpc: SolanaRpc): Promise<void> {
    const prior = this.read(), known = new Set(prior.map(e => e.signature));
    const history = await scanHistory(rpc,this.owner);
    for (const e of history) if (!known.has(e.signature)) { this.upsert(e); known.add(e.signature); }
  }
}
/** Traverse all retained finalized history. Missing transaction details or excessive history abort setup. */
export async function scanHistory(rpc: SolanaRpc, owner: string): Promise<SolanaLedgerEntry[]> {
  await rpc.assertNetwork(); const entries: SolanaLedgerEntry[] = []; let before: string | undefined;
  for (let page = 0; page < 10; page++) {
    const signatures = await rpc.call<Array<{signature:string}>>('getSignaturesForAddress',[owner,{commitment:'finalized',limit:1000,...(before?{before}:{})}]);
    for (const s of signatures) {
      const tx = await rpc.call<any>('getTransaction',[s.signature,{commitment:'finalized',encoding:'jsonParsed',maxSupportedTransactionVersion:0}]);
      if (!tx?.meta || !tx.transaction?.message?.accountKeys) throw new Error('complete finalized history required');
      const keys = tx.transaction.message.accountKeys.map((k:any)=>typeof k==='string'?k:k.pubkey), fee = keys[0] === owner ? String(tx.meta.fee) : '0';
      const pre = (tx.meta.preTokenBalances ?? []).filter((b:any)=>b.owner===owner&&b.mint===TEST_MINT).reduce((n:bigint,b:any)=>n+BigInt(b.uiTokenAmount.amount),0n);
      const post = (tx.meta.postTokenBalances ?? []).filter((b:any)=>b.owner===owner&&b.mint===TEST_MINT).reduce((n:bigint,b:any)=>n+BigInt(b.uiTokenAmount.amount),0n);
      // Count gross outbound transfers, including same-transaction incoming funds; net wallet changes alone can hide a spend.
      const sourceMints=new Map<string,string>();
      for(const b of tx.meta.preTokenBalances??[])if(b.owner===owner)sourceMints.set(keys[b.accountIndex],b.mint);
      const instructions=[...tx.transaction.message.instructions,...(tx.meta.innerInstructions??[]).flatMap((i:any)=>i.instructions)];
      let outbound=0n;
      for(const ix of instructions){
        const info=ix.parsed?.info,type=ix.parsed?.type;
        if(ix.programId!=='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'||!['transfer','transferChecked'].includes(type)||!info||!sourceMints.has(info.source))continue;
        if((info.mint??sourceMints.get(info.source))===TEST_MINT)outbound+=BigInt(info.tokenAmount?.amount??info.amount);
      }
      const net=pre>post?pre-post:0n;
      entries.push({id:'history:'+s.signature,signature:s.signature,amount:(outbound>net?outbound:net).toString(),fee,header:null,createdAt:new Date((tx.blockTime??0)*1000).toISOString()});
    }
    if (signatures.length < 1000) return entries;
    before = signatures.at(-1)!.signature;
  }
  throw new Error('history exceeds bounded reconciliation; operator review required');
}
