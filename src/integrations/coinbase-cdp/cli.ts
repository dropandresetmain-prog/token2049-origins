import { CDP_EXPLORER, CDP_TRANSFER_WEI_TEXT } from './contracts.js';
import { createCdpClient, loadProvisioned, loadSettings, provision } from './client.js';
import { readCdpTreasury } from './adapter.js';
import { executeTestTransfer } from './transfer.js';

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (args.length !== 1 || !['--provision', '--read', '--test-transfer'].includes(command ?? '')) {
    throw new Error('usage: npm run cdp:treasury -- --provision | --read | --test-transfer');
  }
  const settings = loadSettings();
  const client = createCdpClient(settings);
  if (command === '--provision') {
    const identity = await provision(client, settings);
    print({ status: 'provisioned', network: identity.network, treasuryAddress: identity.treasuryAddress, recipientAddress: identity.recipientAddress, policyId: identity.policyId });
    return;
  }
  const identity = await loadProvisioned(client, settings);
  if (command === '--read') {
    print(await readCdpTreasury(client, settings));
    return;
  }
  const action = await executeTestTransfer(client, settings, identity);
  print({
    status: action.status,
    network: action.network,
    amountWei: CDP_TRANSFER_WEI_TEXT,
    treasuryAddress: action.treasuryAddress,
    recipientAddress: action.recipientAddress,
    transactionHash: action.txHash,
    explorerUrl: action.txHash ? `${CDP_EXPLORER}/tx/${action.txHash}` : null,
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'CDP operation failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
