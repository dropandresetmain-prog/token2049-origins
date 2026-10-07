/** Free public Devnet payer. Keys remain here; both durable signer histories live in PostgreSQL. */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { Db } from '../../src/infrastructure/db.js';
import { createBridge, listenHosted } from '../payer/bridge.js';
import { allowedHostsFrom } from '../payer/hosted.js';
import { readSecretFile } from '../payer/config.js';
import { loadSolanaPayerConfig, type SolanaPayerConfig } from './config.js';
import { SolanaBridgePayer } from './bridge.js';
import { PgSolanaLedger } from './pg-ledger.js';
import { importSolanaHistories, verifySolanaImport } from './ledger-import.js';
import { createHostedSponsor } from './hosted-sponsor.js';
import { paySolanaPurchase } from './pay.js';
import { loadSigner } from './signer.js';
import { SolanaRpc } from '../../src/funding/solana/rpc.js';

export function hostedSolanaConfig(env: NodeJS.ProcessEnv) {
  const cfg = loadSolanaPayerConfig(env, { ledger: 'external' });
  if (cfg.settlementMode !== 'payer_broadcast') throw new Error('hosted Solana requires payer_broadcast settlement');
  if (!cfg.gatewayUrl.startsWith('https://') || new URL(cfg.gatewayUrl).pathname !== '/') throw new Error('hosted public gateway origin required');
  if (cfg.payer === cfg.sponsor || cfg.payer === cfg.payee || cfg.source === cfg.tokenAccount) throw new Error('hosted payer/sponsor/treasury identities must be distinct');
  const port = Number(env.PORT ?? '10000');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid hosted Solana PORT');
  const hosts = allowedHostsFrom({ PAYER_BRIDGE_ALLOWED_HOSTS: env.SOLANA_PAYER_BRIDGE_ALLOWED_HOSTS });
  const token = readSecretFile(env.SOLANA_PAYER_BRIDGE_TOKEN_FILE ?? '', 'SOLANA_PAYER_BRIDGE_TOKEN_FILE');
  const gatewayToken = readSecretFile(cfg.tokenFile, 'SOLANA_GATEWAY_TOKEN_FILE');
  if (token.length < 24 || gatewayToken.length < 24 || token === gatewayToken) throw new Error('hosted Solana tokens must be strong and distinct');
  return { cfg, port, hosts, token };
}

export async function solanaHostedSummary(cfg: SolanaPayerConfig, payer: PgSolanaLedger, sponsor: PgSolanaLedger): Promise<Record<string, unknown>> {
  const [p, s] = await Promise.all([payer.summary(), sponsor.summary()]);
  const remaining = cfg.maxTotal - BigInt(p.committedBaseUnits as string);
  const feeRemaining = cfg.maxFees - BigInt(s.committedFeeLamports as string);
  const headroom = remaining < cfg.maxPerPayment ? remaining : cfg.maxPerPayment;
  return { address: cfg.payer, payer: p, sponsor: s, caps: { perPayment: cfg.maxPerPayment.toString(), cumulative: cfg.maxTotal.toString(), sponsorFee: cfg.maxFees.toString() },
    headroomBaseUnits: (headroom > 0n && feeRemaining >= 10001n ? headroom : 0n).toString() };
}

/** An imported unresolved reservation remains a liability and never advertises a connected signer. */
export async function hostedSolanaReady(cfg: SolanaPayerConfig, payer: PgSolanaLedger, sponsor: PgSolanaLedger, rpc = new SolanaRpc(cfg.rpcUrl)): Promise<boolean> {
  try {
    const [p, s] = await Promise.all([payer.summary(), sponsor.summary()]);
    if (p.incomplete || s.incomplete || BigInt(p.committedBaseUnits as string) >= cfg.maxTotal || BigInt(s.committedFeeLamports as string) + 10001n > cfg.maxFees) return false;
    await rpc.assertNetwork();
    await Promise.all([rpc.assertMint(cfg.mint), rpc.assertToken(cfg.source, cfg.mint, cfg.payer), rpc.assertToken(cfg.tokenAccount, cfg.mint, cfg.payee)]);
    const [balance, fees] = await Promise.all([
      rpc.call<{ value: { amount: string } }>('getTokenAccountBalance', [cfg.source, { commitment: 'finalized' }]),
      rpc.call<{ value: number }>('getBalance', [cfg.sponsor, { commitment: 'finalized' }]),
    ]);
    return BigInt(balance.value.amount) > 0n && Number.isSafeInteger(fees.value) && fees.value >= 10001;
  } catch { return false; }
}

export interface HostedSolanaHandle { server: Server; db: Db; close(): Promise<void>; }
export async function startHostedSolana(env: NodeJS.ProcessEnv, opts: { db?: Db; port?: number; rpc?: SolanaRpc } = {}): Promise<HostedSolanaHandle> {
  const { cfg, port, hosts, token } = hostedSolanaConfig(env);
  await Promise.all([loadSigner(cfg.keyFile, cfg.payer), loadSigner(cfg.sponsorKeyFile, cfg.sponsor)]);
  const db = opts.db ?? new Db(String(env.DATABASE_URL ?? ''));
  let server: Server | undefined;
  try {
    if (!opts.db) await db.initialize();
    // Frozen snapshots are secret files only for one-time import, never the canonical runtime ledger.
    if (env.SOLANA_LEGACY_PAYER_LEDGER_FILE || env.SOLANA_LEGACY_SPONSOR_LEDGER_FILE) {
      if (env.SOLANA_LEGACY_SIGNERS_RETIRED !== 'true') throw new Error('legacy Solana signers must be retired before hosted startup');
      const rpc = opts.rpc ?? new SolanaRpc(cfg.rpcUrl);
      await importSolanaHistories(db, [
        { role: 'payer', owner: cfg.payer, text: readFileSync(env.SOLANA_LEGACY_PAYER_LEDGER_FILE ?? '', 'utf8'), expectedSha256: env.SOLANA_LEGACY_PAYER_LEDGER_SHA256 ?? '' },
        { role: 'sponsor', owner: cfg.sponsor, text: readFileSync(env.SOLANA_LEGACY_SPONSOR_LEDGER_FILE ?? '', 'utf8'), expectedSha256: env.SOLANA_LEGACY_SPONSOR_LEDGER_SHA256 ?? '' },
      ], (owner, entries) => verifySolanaImport(rpc, owner, entries));
    }
    const payerLedger = await PgSolanaLedger.open(db, 'payer', cfg.payer);
    const sponsorLedger = await PgSolanaLedger.open(db, 'sponsor', cfg.sponsor);
    const sponsor = await createHostedSponsor(cfg, sponsorLedger, { rpc: opts.rpc });
    const payer = new SolanaBridgePayer({ config: cfg, ready: () => hostedSolanaReady(cfg, payerLedger, sponsorLedger, opts.rpc),
      pay: (config, purchaseId) => paySolanaPurchase(config, purchaseId, { ledger: payerLedger, ...sponsor }) });
    server = createBridge({ payer, token, access: { mode: 'hosted', allowedHosts: hosts }, source: () => payer.source(), summary: () => solanaHostedSummary(cfg, payerLedger, sponsorLedger) });
    await listenHosted(server, opts.port ?? port);
    const running = server;
    return { server: running, db, close: async () => { await new Promise<void>(resolve => running.close(() => resolve())); if (!opts.db) await db.close(); } };
  } catch (error) {
    if (server) server.close();
    if (!opts.db) await db.close();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHostedSolana(process.env).then(handle => {
    console.log('Free hosted Solana payer listening');
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void handle.close().then(() => process.exit(0)));
  }).catch(() => { console.error('Hosted Solana configuration, identity or history rejected; no reset or automatic payment retry'); process.exitCode = 1; });
}
