import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Architecture guard: the MCP channel is a separate process that talks to the gateway over HTTP.
 * It may use the zod contracts and redact(), but never core, the database layer, or client apps.
 */
const DIR = join(import.meta.dirname, '..', '..', 'src', 'channels', 'mcp');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sourceFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : []));
}

/** Every import / export-from / dynamic import specifier in a source file. */
function specifiers(src: string): string[] {
  const out: string[] = [];
  const re = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
  for (let m = re.exec(src); m; m = re.exec(src)) out.push(m[1]!);
  return out;
}

describe('MCP channel isolation', () => {
  const files = sourceFiles(DIR);

  it('finds the channel sources', () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it('imports nothing from src/core, the DB layer, or clients/', () => {
    const banned = [/(^|\/)core(\/|$)/, /infrastructure\/db(\.js)?$/, /infrastructure\/auth(\.js)?$/, /infrastructure\/schema/, /(^|\/)clients(\/|$)/, /(^|\/)composition(\.js)?$/, /(^|\/)wiring(\.js)?$/];
    for (const f of files) {
      for (const spec of specifiers(readFileSync(f, 'utf8'))) {
        for (const re of banned) expect(spec, `${f} imports ${spec}`).not.toMatch(re);
      }
    }
  });

  it('does not reference payer key material or database drivers', () => {
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from ['"]pg['"]|@x402\/|evolution-sdk|mnemonic|skey/i);
    }
  });
});
