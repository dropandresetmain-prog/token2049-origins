import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {SuiLedger, assertSuiFileRetired, retireSuiFileLedger} from '../../clients/sui/ledger.js';
import {runHistoryImport, SuiHistoryManifest} from './import-history.js';

/** Offline validation by default. Retirement is an approved, permanent authority change, never a smoke test. */
export async function runSuiRetirement(args: string[], env: NodeJS.ProcessEnv) {
  const apply = args.includes('--retire');
  const verificationArgs = args.filter(arg => arg !== '--retire');
  if (verificationArgs.length !== 2 || verificationArgs[0] !== '--manifest' || args.length !== (apply ? 3 : 2)) {
    throw new Error('use --manifest PATH [--retire]');
  }
  if (apply && (env.CAPSULE_APPROVED_SUI_RETIREMENT !== 'true' || env.CAPSULE_BACKUP_RESTORE_VERIFIED !== 'true')) {
    throw new Error('approved retirement and verified backup/restore required');
  }
  const summary = await runHistoryImport(verificationArgs, env);
  const manifest = SuiHistoryManifest.parse(JSON.parse(readFileSync(verificationArgs[1]!, 'utf8')));
  if (summary.sourceSha256 !== manifest.snapshotSha256 || summary.owner !== manifest.owner) throw new Error('retirement manifest changed');
  const ledger = new SuiLedger(manifest.snapshotFile, manifest.owner);
  ledger.readForImport(); // Fail on unprotected, missing or wrong-identity local history even in verify-only mode.
  if (apply) {
    retireSuiFileLedger(ledger, manifest.snapshotSha256);
    assertSuiFileRetired(ledger, manifest.snapshotSha256);
  }
  return {...summary, mode: apply ? 'permanently-retired' : 'verify-only', authorityChanged: apply};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSuiRetirement(process.argv.slice(2), process.env).then(result => console.log(JSON.stringify(result))).catch(() => {
    console.error('Sui retirement refused; verify approval, backup/restore, pinned protected history and signer quiescence');
    process.exitCode = 1;
  });
}
