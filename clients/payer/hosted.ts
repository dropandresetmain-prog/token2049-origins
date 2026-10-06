/**
 * Hosted Cardano Preprod payer on a FREE Render web service (no disk, no private network):
 *
 *   MCP (gateway web service) --HTTPS + bearer--> this service --> POST {public gateway}/v1/purchases/{id}/fund --> Cardano Preprod
 *
 * Nothing about payment logic changes here: this entrypoint wires the existing bounded `Payer` (policy, caps, identical-header
 * resend) to a PostgreSQL ledger (migration 0005) behind `createBridge` in public-hosted access mode. The mnemonic comes from a
 * Render secret file; spend history lives in the shared Render Postgres, so it survives sleeping, restarts and redeploys.
 *
 * Startup is idempotent and fail-closed: the ledger is bound to the expected wallet address; a mnemonic that derives a different
 * address, or a database that already belongs to a different wallet, refuses to start. History is never reset or reassigned.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Db } from '../../src/infrastructure/db.js';
import { createBridge, listenHosted } from './bridge.js';
import { loadPayerConfig, readSecretFile, type PayerConfig } from './config.js';
import { createBoundSigner } from './signer.js';
import { PgPayerLedger } from './pg-ledger.js';
import { Payer } from './payer.js';

const log = (e: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), ...e })}\n`);

/** Exact public hostnames (no scheme/port/path) the gateway uses to reach this service. */
export function allowedHostsFrom(env: NodeJS.ProcessEnv): string[] {
  const hosts = String(env.PAYER_BRIDGE_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!hosts.length) throw new Error('invalid bridge configuration: PAYER_BRIDGE_ALLOWED_HOSTS');
  for (const h of hosts) if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) throw new Error('invalid bridge configuration: PAYER_BRIDGE_ALLOWED_HOSTS');
  return hosts;
}

/** Public address of the wallet in the mnemonic secret file. Derived offline; no provider request, nothing printed. */
export function deriveWalletAddress(config: PayerConfig): string {
  const mnemonic = readFileSync(config.mnemonicFile, 'utf8');
  return String(createBoundSigner(config, mnemonic, 'public-identity-only').getAddress());
}

export interface HostedPayerHandle {
  server: import('node:http').Server;
  db: Db;
  address: string;
  close(): Promise<void>;
}

export async function startHostedPayer(env: NodeJS.ProcessEnv, opts: { db?: Db; port?: number } = {}): Promise<HostedPayerHandle> {
  const config = loadPayerConfig(env, { ledger: 'external' });
  if (!config.walletAddress) throw new Error('invalid payer configuration: PAYER_WALLET_ADDRESS');
  if (!config.gatewayUrl.startsWith('https://')) throw new Error('invalid payer configuration: PAYER_GATEWAY_URL (https required when hosted)');
  const token = readSecretFile(String(env.PAYER_BRIDGE_TOKEN_FILE ?? ''), 'PAYER_BRIDGE_TOKEN_FILE');
  if (token.length < 24) throw new Error('PAYER_BRIDGE_TOKEN_FILE must hold a token of at least 24 characters');
  const allowedHosts = allowedHostsFrom(env);
  const port = opts.port ?? Number(env.PORT ?? '10000');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('invalid bridge configuration: PORT');

  // The signing wallet must be exactly the configured one before anything touches the ledger.
  const address = deriveWalletAddress(config);
  if (address !== config.walletAddress) throw new Error('payer wallet does not match PAYER_WALLET_ADDRESS; refusing to start');

  const db = opts.db ?? new Db(String(env.DATABASE_URL ?? ''));
  if (!opts.db) await db.initialize(); // append-only migrations; idempotent and safe alongside the gateway's own start-up
  const ledger = await PgPayerLedger.open(db, { network: config.network, address });

  const payer = new Payer({ config, ledger, log });
  const server = createBridge({ payer, token, access: { mode: 'hosted', allowedHosts }, source: () => payer.source(), log });
  await listenHosted(server, port);
  log({ type: 'payer.hosted.ready', network: config.network });
  return {
    server, db, address,
    close: async () => { await new Promise<void>((r) => server.close(() => r())); if (!opts.db) await db.close(); },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startHostedPayer(process.env)
    .then((h) => {
      const stop = () => void h.close().then(() => process.exit(0));
      process.on('SIGTERM', stop);
      process.on('SIGINT', stop);
    })
    .catch((e) => {
      // Messages here name variables and states only; they never carry secret values.
      process.stderr.write(`${e instanceof Error ? e.message : 'hosted payer failed to start'}\n`);
      process.exitCode = 1;
    });
}
