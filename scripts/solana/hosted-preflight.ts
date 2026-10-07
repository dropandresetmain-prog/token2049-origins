/** Read-only keyless preflight: shared bounded readiness, exact identity/network/mint and durable import summaries. */
import { loadHostedMcpConfig } from '../../src/channels/hosted-mcp/config.js';
import { BridgeClient } from '../../src/channels/mcp/bridge.js';
import { parseSolanaConfig } from '../../src/funding/solana/config.js';
import { NETWORK } from '../../src/funding/solana/wire.js';

try {
  const hosted = loadHostedMcpConfig(process.env);
  const parsed = parseSolanaConfig(process.env);
  if (!hosted?.solanaBridge || !hosted.solanaPayerTokenSha256 || !parsed.ok || parsed.config.settlementMode !== 'payer_broadcast') throw new Error('configuration');
  const status = await new BridgeClient('solana', { ...hosted.solanaBridge, statusTimeoutMs: 60000 }).status();
  if (!status || status.source.network !== NETWORK || status.source.assetId !== parsed.config.mint || status.source.readiness !== 'configured' || status.headroomBaseUnits === undefined || status.headroomBaseUnits <= 0n) throw new Error('readiness');
  console.log(JSON.stringify({ noSpend: true, supported: 'exact/devnet/v2', source: status.source, headroomBaseUnits: status.headroomBaseUnits.toString() }));
} catch {
  console.error('Hosted Solana read-only preflight failed; no spend attempted. Check HTTPS authentication, PostgreSQL imports, caps and readiness.');
  process.exitCode = 1;
}
