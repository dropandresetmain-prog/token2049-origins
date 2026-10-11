#!/usr/bin/env node
/**
 * Deterministic fingerprint of a BUILT artifact tree (not of sources).
 *
 *   node scripts/release/fingerprint-dist.mjs <dir> [--manifest <file>]
 *
 * Method: walk <dir>, take every regular file (symlinks are refused), record `<posix relative path>\t<sha256 of bytes>`,
 * sort the lines bytewise by path, join with "\n" (trailing newline), and print the sha256 of that manifest.
 * File modes, mtimes and ownership are excluded so the same bytes always give the same fingerprint. Contents are
 * hashed only and never printed, so no secret can leak through the manifest.
 */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const [dir, flag, out] = process.argv.slice(2);
if (!dir) { console.error('usage: fingerprint-dist.mjs <dir> [--manifest <file>]'); process.exit(2); }
const root = resolve(dir);
const lines = [];
(function walk(current) {
  for (const name of readdirSync(current)) {
    const full = join(current, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) throw new Error(`refusing symlink in artifact: ${relative(root, full)}`);
    if (st.isDirectory()) walk(full);
    else if (st.isFile()) lines.push(`${relative(root, full).split(sep).join('/')}\t${createHash('sha256').update(readFileSync(full)).digest('hex')}`);
  }
})(root);
lines.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const manifest = lines.join('\n') + '\n';
if (flag === '--manifest' && out) writeFileSync(out, manifest);
console.log(JSON.stringify({ files: lines.length, fingerprintSha256: createHash('sha256').update(manifest).digest('hex') }));
