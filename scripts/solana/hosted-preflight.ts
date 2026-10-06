/** Read-only checks from the hosted keyless gateway. Never calls /pay or creates a purchase. */
import { loadHostedMcpConfig } from '../../src/channels/hosted-mcp/config.js';
import { parseSolanaConfig } from '../../src/funding/solana/config.js';
import { createSolanaFacilitatorClient } from '../../src/funding/solana/facilitator.js';
import { FundingSource } from '../../src/contracts/presentation.js';
import { NETWORK } from '../../src/funding/solana/wire.js';

try {
  const hosted = loadHostedMcpConfig(process.env);
  const parsed = parseSolanaConfig(process.env);
  if (!hosted?.solanaBridge || !hosted.solanaPayerTokenSha256 || !parsed.ok) throw new Error('configuration');
  const supported = await createSolanaFacilitatorClient(parsed.config).getSupported();
  const kind = supported.kinds[0];
  const preparation = kind?.extra?.preparation as Record<string, unknown> | undefined;
  if (supported.kinds.length !== 1 || kind?.x402Version !== 2 || kind.scheme !== 'exact' || kind.network !== NETWORK ||
      kind.extra?.feePayer !== parsed.config.sponsor || supported.signers[NETWORK]?.length !== 1 || supported.signers[NETWORK]?.[0] !== parsed.config.sponsor ||
      preparation?.url !== parsed.config.facilitatorUrl + '/prepare' || preparation.method !== 'POST' || preparation.authentication !== 'Bearer' || preparation.requiresFullySignedTransaction !== true) throw new Error('supported');
  const response = await fetch(hosted.solanaBridge.url + '/status', {
    headers: { authorization: 'Bearer ' + hosted.solanaBridge.token }, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('status');
  const body = await response.text();
  if (body.length > 16_384) throw new Error('status size');
  const json = JSON.parse(body);
  const source = FundingSource.parse(json.source);
  if (json.ok !== true || source.rail !== 'solana' || source.network !== NETWORK || source.assetId !== parsed.config.mint || source.readiness !== 'configured') throw new Error('readiness');
  console.log(JSON.stringify({ noSpend: true, supported: 'exact/devnet/v2', source }));
} catch {
  console.error('Hosted Solana read-only preflight failed; no spend attempted. Check private connectivity, authentication and readiness.');
  process.exitCode = 1;
}
