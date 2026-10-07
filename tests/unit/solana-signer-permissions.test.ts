import { afterEach, describe, expect, it, vi } from 'vitest';
import { lstatSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { assertPrivateKeyFile } from '../../clients/solana/signer.js';

vi.mock('node:fs', () => ({ readFileSync: vi.fn(), lstatSync: vi.fn() }));
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }));
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
afterEach(() => { Object.defineProperty(process, 'platform', platform); vi.resetAllMocks(); });

describe('local Solana key upload permission boundary', () => {
  it('rejects symbolic links before checking permissions', () => {
    vi.mocked(lstatSync).mockReturnValue({ isSymbolicLink: () => true } as ReturnType<typeof lstatSync>);
    expect(() => assertPrivateKeyFile('synthetic-key.json')).toThrow('links forbidden');
    expect(execFileSync).not.toHaveBeenCalled();
  });
  it('requires a completed Windows ACL check, including its exact success marker', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.mocked(lstatSync).mockReturnValue({ isSymbolicLink: () => false } as ReturnType<typeof lstatSync>);
    vi.mocked(execFileSync).mockReturnValue('');
    expect(() => assertPrivateKeyFile('synthetic-key.json')).toThrow('access control unsafe');
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('ACL unavailable'); });
    expect(() => assertPrivateKeyFile('synthetic-key.json')).toThrow('access control unsafe');
    vi.mocked(execFileSync).mockReturnValue('protected\r\n');
    expect(() => assertPrivateKeyFile('synthetic-key.json')).not.toThrow();
    expect(String(vi.mocked(execFileSync).mock.calls.at(-1)?.[1]?.[2])).toContain("$ErrorActionPreference='Stop'");
  });
  it('refuses Unix group or world access', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.mocked(lstatSync).mockReturnValue({ isSymbolicLink: () => false, mode: 0o640 } as ReturnType<typeof lstatSync>);
    expect(() => assertPrivateKeyFile('synthetic-key.json')).toThrow('permissions unsafe');
    vi.mocked(lstatSync).mockReturnValue({ isSymbolicLink: () => false, mode: 0o600 } as ReturnType<typeof lstatSync>);
    expect(() => assertPrivateKeyFile('synthetic-key.json')).not.toThrow();
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
