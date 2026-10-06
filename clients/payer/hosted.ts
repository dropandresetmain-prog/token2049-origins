/**
 * Hosted Cardano Preprod payer: the existing bounded payer + bridge, run as a private-network-only service.
 *
 *   MCP (Render web service) -> private network -> this process -> POST {public gateway}/v1/purchases/{id}/fund
 *
 * Nothing about payment logic changes here: this entrypoint only wires `Payer` (policy, caps, durable ledger, identical-header
 * resend) behind `createBridge` in private-access mode. The mnemonic comes from a Render secret file; the ledger lives on a
 * persistent disk, so cumulative/daily history survives restarts and redeploys. A missing or unreadable ledger stops the
 * service from signing (it is never silently recreated); a crash lock is reported and left for the operator, never cleared.
 *
 * One-time provisioning (operator, from the payer service shell, never automatic):  npm run payer:hosted:init-ledger
 */
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createBridge, listenPrivate } from './bridge.js';
import { loadBridgeConfig, loadPayerConfig, readSecretFile } from './config.js';
import { Payer } from './payer.js';
import { PayerLedger } from './ledger.js';

const log = (e: Record<string, unknown>) => process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), ...e })}\n`);

/** Exact `host[:port]` values the MCP service uses to reach this bridge (Render private hostname). */
export function allowedHostsFrom(env: NodeJS.ProcessEnv): string[] {
  const hosts = String(env.PAYER_BRIDGE_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (!hosts.length) throw new Error('invalid bridge configuration: PAYER_BRIDGE_ALLOWED_HOSTS');
  for (const h of hosts) if (!/^[a-z0-9][a-z0-9-]{0,62}(?::[0-9]{1,5})?$/.test(h)) throw new Error('invalid bridge configuration: PAYER_BRIDGE_ALLOWED_HOSTS');
  return hosts;
}

export async function startHostedPayer(env: NodeJS.ProcessEnv) {
  const config = loadPayerConfig(env);
  const bridge = loadBridgeConfig(env);
  const token = readSecretFile(bridge.tokenFile, 'PAYER_BRIDGE_TOKEN_FILE');
  if (token.length < 24) throw new Error('PAYER_BRIDGE_TOKEN_FILE must hold a token of at least 24 characters');
  const allowedHosts = allowedHostsFrom(env);
  // The payer's own gateway client resolves the 402 challenge against this URL, so it must be the public https gateway.
  if (!config.gatewayUrl.startsWith('https://')) throw new Error('invalid payer configuration: PAYER_GATEWAY_URL (https required when hosted)');
  if (!existsSync(config.ledgerFile)) throw new Error('payer ledger is missing; run payer:hosted:init-ledger once. Refusing to start with empty history.');
  if (existsSync(`${config.ledgerFile}.lock`)) log({ type: 'payer.crash_lock_present', note: 'a previous payment did not finish; operator reconciliation required before paying' });

  const payer = new Payer({ config, log });
  const server = createBridge({ payer, token, access: { mode: 'private', allowedHosts }, source: () => payer.source(), log });
  await listenPrivate(server, bridge.port);
  return server;
}

/** One-time creation of the empty ledger on the persistent disk. Refuses to touch an existing ledger. */
export function initHostedLedger(env: NodeJS.ProcessEnv): string {
  const config = loadPayerConfig(env);
  PayerLedger.initialize(config.ledgerFile);
  return config.ledgerFile;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--init-ledger')) {
    try {
      process.stdout.write(`created empty payer ledger at ${initHostedLedger(process.env)}\n`);
    } catch (e) {
      process.stderr.write(`${e instanceof Error && /EEXIST/.test(e.message) ? 'ledger already exists; refusing to reset history' : e instanceof Error ? e.message : 'init failed'}\n`);
      process.exitCode = 1;
    }
  } else {
    startHostedPayer(process.env)
      .then((s) => {
        const a = s.address();
        log({ type: 'payer.hosted.listening', port: typeof a === 'object' && a ? a.port : null });
      })
      .catch((e) => {
        process.stderr.write(`${e instanceof Error ? e.message : 'hosted payer failed to start'}\n`);
        process.exitCode = 1;
      });
  }
}
