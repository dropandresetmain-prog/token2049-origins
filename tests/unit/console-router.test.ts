import http, { type Server } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CoreError } from '../../src/core/errors.js';
import { CONSOLE_CSP, createConsoleRouter, defaultConsoleDir } from '../../src/console/router.js';

const INDEX = '<!doctype html><html><head><script type="module" src="/console/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>';
const SECRET = 'TOP-SECRET-OUTSIDE-THE-BUILD';

let root: string;
let buildDir: string;
const servers: Server[] = [];

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'console-router-'));
  buildDir = path.join(root, 'console');
  mkdirSync(path.join(buildDir, 'assets', 'nested'), { recursive: true });
  writeFileSync(path.join(buildDir, 'index.html'), INDEX);
  writeFileSync(path.join(buildDir, 'assets', 'index-abc123.js'), 'console.log("console")');
  writeFileSync(path.join(buildDir, 'assets', 'index-abc123.css'), 'body{margin:0}');
  writeFileSync(path.join(buildDir, 'assets', '.hidden.js'), 'DOTFILE-BODY');
  writeFileSync(path.join(buildDir, 'assets', 'nested', 'deep.js'), 'NESTED-BODY');
  writeFileSync(path.join(buildDir, 'mark-crop.webp'), 'RIFF....WEBP');
  writeFileSync(path.join(buildDir, 'notes.txt'), 'not public');
  writeFileSync(path.join(buildDir, '.env'), 'KEY=1');
  writeFileSync(path.join(root, 'secret.txt'), SECRET);
});
afterAll(() => rmSync(root, { recursive: true, force: true }));
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))));
});

/** A small app with the gateway's error shape: unknown paths end in a not_found ErrorBody. */
async function serve(dir: string): Promise<string> {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/console', createConsoleRouter({ dir }));
  app.use((req, _res, next) => next(new CoreError('not_found', `no route ${req.method} ${req.path}`)));
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const e = err as CoreError;
    res.status(e.status ?? 500).json({ error: { code: e.code ?? 'internal', message: e.message, requestId: 'test' } });
  });
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** fetch() normalises dot segments; node:http lets the test send the raw request target. */
function raw(base: string, target: string): Promise<{ status: number; body: string }> {
  const u = new URL(base);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: u.hostname, port: u.port, method: 'GET', path: target }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function expectSecurityHeaders(res: globalThis.Response) {
  expect(res.headers.get('content-security-policy')).toBe(CONSOLE_CSP);
  expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  expect(res.headers.get('x-frame-options')).toBe('DENY');
}

describe('console router', () => {
  it('uses the specified CSP', () => {
    expect(CONSOLE_CSP).toBe(
      "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    );
  });

  it('serves index.html at /console and /console/ without caching', async () => {
    const base = await serve(buildDir);
    for (const p of ['/console', '/console/']) {
      const res = await fetch(base + p);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toMatch(/text\/html/);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expectSecurityHeaders(res);
      expect(await res.text()).toBe(INDEX);
    }
  });

  it('serves hashed assets as immutable with the right types', async () => {
    const base = await serve(buildDir);
    const js = await fetch(`${base}/console/assets/index-abc123.js`);
    expect(js.status).toBe(200);
    expect(js.headers.get('content-type')).toMatch(/javascript/);
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expectSecurityHeaders(js);
    expect(await js.text()).toBe('console.log("console")');

    const css = await fetch(`${base}/console/assets/index-abc123.css`);
    expect(css.headers.get('content-type')).toMatch(/text\/css/);
    expect(css.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('serves public .webp images with a short cache', async () => {
    const base = await serve(buildDir);
    const res = await fetch(`${base}/console/mark-crop.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
    expectSecurityHeaders(res);
  });

  it('supports HEAD', async () => {
    const base = await serve(buildDir);
    const res = await fetch(`${base}/console/`, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expectSecurityHeaders(res);
  });

  it('404s unknown paths through the normal error handler, with security headers', async () => {
    const base = await serve(buildDir);
    for (const p of ['/console/nope', '/console/assets/missing.js', '/console/assets/', '/console/assets', '/console/notes.txt', '/console/index.html', '/console/a/b/c']) {
      const res = await fetch(base + p);
      expect(res.status, p).toBe(404);
      expect(res.headers.get('content-type'), p).toMatch(/json/);
      expect(((await res.json()) as { error: { code: string } }).error.code, p).toBe('not_found');
      expectSecurityHeaders(res);
    }
  });

  it('does not list directories, serve dotfiles or serve nested files', async () => {
    const base = await serve(buildDir);
    for (const p of ['/console/assets/', '/console/assets/nested', '/console/assets/nested/', '/console/assets/nested/deep.js', '/console/assets/.hidden.js', '/console/.env', '/console/%2eenv']) {
      const res = await fetch(base + p);
      expect(res.status, p).toBe(404);
      const text = await res.text();
      expect(text, p).not.toContain('NESTED-BODY');
      expect(text, p).not.toContain('DOTFILE-BODY');
      expect(text, p).not.toContain('KEY=1');
    }
  });

  it('rejects path traversal in raw and encoded forms', async () => {
    const base = await serve(buildDir);
    const targets = [
      '/console/assets/../../secret.txt',
      '/console/assets/..%2f..%2fsecret.txt',
      '/console/assets/%2e%2e%2f%2e%2e%2fsecret.txt',
      '/console/assets/..%5c..%5csecret.txt',
      '/console/assets/%2e%2e/%2e%2e/secret.txt',
      '/console/..%2fsecret.txt',
      '/console/../secret.txt',
      '/console/assets/%00.js',
      '/console/assets/index-abc123.js%00.png',
      '/console/assets/%',
      '/console/%2e%2e%2fsecret.txt.webp',
    ];
    for (const t of targets) {
      const res = await raw(base, t);
      expect(res.status, t).toBe(404);
      expect(res.body, t).not.toContain(SECRET);
    }
  });

  it('rejects methods other than GET and HEAD', async () => {
    const base = await serve(buildDir);
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await fetch(`${base}/console/`, { method });
      expect(res.status, method).toBe(404);
    }
  });

  it('answers 503 with a plain explanation when the build is missing', async () => {
    const base = await serve(path.join(root, 'does-not-exist'));
    for (const p of ['/console', '/console/', '/console/assets/index-abc123.js', '/console/mark-crop.webp']) {
      const res = await fetch(base + p);
      expect(res.status, p).toBe(503);
      expect(res.headers.get('content-type')).toMatch(/text\/plain/);
      const text = await res.text();
      expect(text).toMatch(/not been built/);
      expect(text).not.toMatch(/\bat\s.+\(.+:\d+:\d+\)|Error:|node_modules/);
      expect(text).not.toContain(root);
      expectSecurityHeaders(res);
    }
  });

  it('picks up a build that appears after startup', async () => {
    const lateDir = path.join(root, 'late');
    const base = await serve(lateDir);
    expect((await fetch(`${base}/console/`)).status).toBe(503);
    mkdirSync(lateDir, { recursive: true });
    writeFileSync(path.join(lateDir, 'index.html'), INDEX);
    expect((await fetch(`${base}/console/`)).status).toBe(200);
  });

  it('locates dist/console for both the source and the compiled layout', () => {
    const repo = path.join(root, 'repo');
    mkdirSync(path.join(repo, 'dist', 'console'), { recursive: true });
    writeFileSync(path.join(repo, 'dist', 'console', 'index.html'), INDEX);
    // tsx: <root>/src/console
    expect(defaultConsoleDir(path.join(repo, 'src', 'console'))).toBe(path.join(repo, 'dist', 'console'));
    // node dist/src/main.js: <root>/dist/src/console
    expect(defaultConsoleDir(path.join(repo, 'dist', 'src', 'console'))).toBe(path.join(repo, 'dist', 'console'));
  });
});
