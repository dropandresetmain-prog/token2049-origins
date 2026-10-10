/** Stage only selected Render signer files; financial histories remain in PostgreSQL. */
import { fstatSync, readSync, mkdtempSync, openSync, writeFileSync, fsyncSync, closeSync, unlinkSync, rmdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { SolanaLedger } from '../solana/ledger.js';

const staged = new Map<string, { path: string; directory: string }>();
export function protectedRuntimeFile(source: string, env: NodeJS.ProcessEnv, opts: { mountRoot?: string } = {}) {
  if (env.MULTIWALLET_RENDER_SECRET_FILES !== 'true') return source;
  if (env.RENDER !== 'true') throw Error('Render secret staging requires the Render runtime');
  const mount = opts.mountRoot ?? '/etc/secrets';
  if (resolve(source) !== resolve(mount, basename(source)) || !/^consolidated-[a-z0-9-]+$/.test(basename(source))) {
    throw Error('approved consolidated secret mount required');
  }
  const cached = staged.get(source);
  if (cached) return cached.path;

  // Render controls the mount and may use symlinks. Read one opened file, bound its contents,
  // then preserve the rail's existing public-identity and protected-file checks on our copy.
  let input: number | undefined, output: number | undefined, bytes: Buffer | undefined;
  let directory: string | undefined, path: string | undefined;
  const extra = Buffer.alloc(1);
  try {
    input = openSync(source, 'r');
    const before = fstatSync(input);
    if (!before.isFile() || before.size < 1 || before.size > 8192) throw Error('bounded signer secret file required');
    bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(input, bytes, offset, bytes.length - offset, null);
      if (!count) throw Error('signer secret changed while staging');
      offset += count;
    }
    const after = fstatSync(input);
    if (readSync(input, extra, 0, 1, null) || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) {
      throw Error('signer secret changed while staging');
    }
    closeSync(input); input = undefined;
    directory = mkdtempSync(join(tmpdir(), 'capsule-signer-'));
    SolanaLedger.protectDirectory(directory);
    path = join(directory, 'signer');
    output = openSync(path, 'wx', 0o600);
    writeFileSync(output, bytes); fsyncSync(output); closeSync(output); output = undefined;
    new SolanaLedger(path, 'runtime-secret').assertProtected();
    staged.set(source, { path, directory });
    return path;
  } catch (error) {
    if (output !== undefined) { closeSync(output); output = undefined; }
    if (path) try { unlinkSync(path); } catch {}
    if (directory) try { rmdirSync(directory); } catch {}
    throw error;
  } finally {
    if (input !== undefined) closeSync(input);
    bytes?.fill(0); extra.fill(0);
  }
}

/** Remove only files and directories created by this process, never mounts or ledger history. */
export function disposeRuntimeSecrets() {
  for (const { path, directory } of staged.values()) {
    try { unlinkSync(path); } catch {}
    try { rmdirSync(directory); } catch {}
  }
  staged.clear();
}
