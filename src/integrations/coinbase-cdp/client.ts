import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { CdpClient } from '@coinbase/cdp-sdk';
import { CDP_NETWORK, CDP_POLICY_ATTACH_IDEMPOTENCY_KEY, CDP_POLICY_DESCRIPTION, CDP_POLICY_IDEMPOTENCY_KEY, CDP_RECIPIENT_NAME, CDP_TREASURY_NAME, requireAbsoluteFile, validatePair } from './contracts.js';
import type { CdpPublicIdentity, CdpSettings } from './contracts.js';
import { createHistoryOnce, protectHistoryDirectory } from './history.js';

const NATIVE_ETH_ADDRESS = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

export function loadSettings(env: NodeJS.ProcessEnv = process.env): CdpSettings {
  const apiKeyId = env.CDP_API_KEY_ID?.trim();
  const apiKeySecret = env.CDP_API_KEY_SECRET?.trim();
  const walletSecret = env.CDP_WALLET_SECRET?.trim();
  if (!apiKeyId || !apiKeySecret || !walletSecret) throw new Error('CDP credentials are unavailable; set CDP_API_KEY_ID, CDP_API_KEY_SECRET and CDP_WALLET_SECRET in the private environment');
  return {
    apiKeyId,
    apiKeySecret,
    walletSecret,
    identityFile: requireAbsoluteFile(env.CDP_IDENTITY_FILE, 'CDP_IDENTITY_FILE'),
    historyFile: requireAbsoluteFile(env.CDP_ACTION_HISTORY_FILE, 'CDP_ACTION_HISTORY_FILE'),
    rpcUrl: 'https://sepolia.base.org',
  };
}

export function createCdpClient(settings: CdpSettings): CdpClient {
  return new CdpClient({ apiKeyId: settings.apiKeyId, apiKeySecret: settings.apiKeySecret, walletSecret: settings.walletSecret });
}

export function makeAccountPolicy(recipientAddress: `0x${string}`) {
  return {
    scope: 'account' as const,
    description: CDP_POLICY_DESCRIPTION,
    rules: [{
      action: 'accept' as const,
      operation: 'sendEvmTransaction' as const,
      criteria: [
        { type: 'evmAddress' as const, addresses: [recipientAddress], operator: 'in' as const },
        { type: 'ethValue' as const, ethValue: '1000000000000', operator: '<=' as const },
        { type: 'evmNetwork' as const, networks: [CDP_NETWORK], operator: 'in' as const },
      ],
    }, ...(['sendEvmTransaction', 'signEvmTransaction', 'signEvmMessage', 'signEvmTypedData', 'signEvmHash'] as const).map((operation) => ({
      action: 'reject' as const,
      operation,
      criteria: [],
    }))],
  };
}

function readIdentity(path: string): CdpPublicIdentity {
  let value: unknown;
  try { value = JSON.parse(readFileSync(path, 'utf8')); }
  catch { throw new Error('CDP public identity is unavailable or corrupt; run --provision or reconcile manually'); }
  if (!value || typeof value !== 'object') throw new Error('CDP public identity is invalid');
  const identity = value as CdpPublicIdentity;
  if (identity.version !== 1 || identity.network !== CDP_NETWORK || identity.treasuryName !== CDP_TREASURY_NAME || identity.recipientName !== CDP_RECIPIENT_NAME || !identity.policyId) {
    throw new Error('CDP public identity is invalid');
  }
  validatePair(identity.treasuryAddress, identity.recipientAddress);
  return identity;
}

function saveIdentityOnce(path: string, identity: CdpPublicIdentity): CdpPublicIdentity {
  try {
    const fd = openSync(path, 'wx', 0o600);
    try { writeFileSync(fd, JSON.stringify(identity, null, 2) + '\n', 'utf8'); fsyncSync(fd); }
    finally { closeSync(fd); }
    return identity;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Error('could not persist CDP public identity');
    const existing = readIdentity(path);
    if (existing.treasuryAddress.toLowerCase() !== identity.treasuryAddress.toLowerCase() || existing.recipientAddress.toLowerCase() !== identity.recipientAddress.toLowerCase() || existing.policyId !== identity.policyId) {
      throw new Error('CDP public identity differs from the dedicated CDP accounts; operator reconciliation required');
    }
    return existing;
  }
}

export async function provision(client: CdpClient, settings: CdpSettings): Promise<CdpPublicIdentity> {
  const hasIdentity = existsSync(settings.identityFile);
  const hasHistory = existsSync(settings.historyFile);
  if (hasIdentity) {
    if (!hasHistory) throw new Error('CDP action history is missing for an existing identity; provisioning blocked before API writes');
    const existing = readIdentity(settings.identityFile);
    const { readHistory } = await import('./history.js');
    readHistory(settings.historyFile, existing);
    return loadProvisioned(client, settings);
  }
  if (hasHistory) throw new Error('CDP action history exists without its public identity; provisioning blocked for reconciliation');
  protectHistoryDirectory(settings.historyFile);

  const recipient = await client.evm.getOrCreateAccount({ name: CDP_RECIPIENT_NAME });
  const treasury = await client.evm.getOrCreateAccount({ name: CDP_TREASURY_NAME });
  const pair = validatePair(treasury.address, recipient.address);
  if (treasury.policies?.length) throw new Error('dedicated CDP treasury already has an attached policy; refusing to alter wallet authority');

  const policy = await client.policies.createPolicy({
    policy: makeAccountPolicy(pair.recipientAddress),
    idempotencyKey: CDP_POLICY_IDEMPOTENCY_KEY,
  });
  if (!treasury.policies?.includes(policy.id)) {
    const attached = await client.evm.updateAccount({
      address: pair.treasuryAddress,
      update: { accountPolicy: policy.id },
      idempotencyKey: CDP_POLICY_ATTACH_IDEMPOTENCY_KEY,
    });
    if (!attached.policies?.includes(policy.id)) throw new Error('CDP treasury policy attachment could not be verified');
  }
  const confirmed = await client.evm.getAccount({ address: pair.treasuryAddress });
  if (!confirmed.policies?.includes(policy.id)) throw new Error('CDP treasury policy is not active');

  const identity = saveIdentityOnce(settings.identityFile, {
    version: 1,
    network: CDP_NETWORK,
    treasuryName: CDP_TREASURY_NAME,
    treasuryAddress: pair.treasuryAddress,
    recipientName: CDP_RECIPIENT_NAME,
    recipientAddress: pair.recipientAddress,
    policyId: policy.id,
    createdAt: new Date().toISOString(),
  });
  createHistoryOnce(settings.historyFile, identity);
  return identity;
}

export async function loadProvisioned(client: CdpClient, settings: CdpSettings): Promise<CdpPublicIdentity> {
  const identity = readIdentity(settings.identityFile);
  const [treasury, recipient] = await Promise.all([
    client.evm.getAccount({ address: identity.treasuryAddress }),
    client.evm.getAccount({ address: identity.recipientAddress }),
  ]);
  if (treasury.name !== CDP_TREASURY_NAME || recipient.name !== CDP_RECIPIENT_NAME) throw new Error('CDP accounts do not match the configured Capsule identities');
  if (treasury.policies?.length !== 1 || treasury.policies[0] !== identity.policyId) throw new Error('CDP treasury policy set is not the single approved Capsule policy');
  const policy = await client.policies.getPolicyById({ id: identity.policyId });
  const expected = makeAccountPolicy(identity.recipientAddress).rules;
  const actualRules = policy.rules as unknown as typeof expected;
  if (policy.scope !== 'account' || JSON.stringify(actualRules) !== JSON.stringify(expected)) throw new Error('CDP treasury policy differs from the approved recipient, limits, and deny rules');
  return identity;
}

export async function readNativeEthBalance(client: CdpClient, identity: CdpPublicIdentity): Promise<string> {
  const account = await client.evm.getAccount({ address: identity.treasuryAddress });
  const scoped = await account.useNetwork(CDP_NETWORK);
  let pageToken: string | undefined;
  do {
    const result = await scoped.listTokenBalances({ pageSize: 100, ...(pageToken ? { pageToken } : {}) });
    const native = result.balances.find((item) => item.token.network === CDP_NETWORK && item.token.contractAddress.toLowerCase() === NATIVE_ETH_ADDRESS);
    if (native) return native.amount.amount.toString();
    pageToken = result.nextPageToken;
  } while (pageToken);
  return '0';
}
