/**
 * Capsule console static host. Serves the built single-page console (web/, `npm run console:build:gateway`)
 * from dist/console at /console.
 *
 * The page contains no private data: it asks for an access key in the browser and reads the authenticated
 * API on the same origin, so this router is mounted without authentication.
 *
 * Only an allowlist of files is served: index.html, files directly under assets/ and root-level .webp images.
 * No directory listing, no dotfiles, no path traversal. Everything else falls through to the app's normal
 * not-found handler.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { CoreError } from '../core/errors.js';

export interface ConsoleRouterOptions {
  /** Directory holding the built console (contains index.html). Defaults to dist/console, found relative to this module. */
  dir?: string;
}

/** Everything the Vite build emits is same-origin: scripts, styles and images load from 'self'. */
export const CONSOLE_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const IMMUTABLE = 'public, max-age=31536000, immutable';
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const UNBUILT_MESSAGE = 'The Capsule console has not been built on this server. Run "npm run build" and restart.\n';

/**
 * `tsx src/main.ts` runs this file from <root>/src/console; `node dist/src/main.js` from <root>/dist/src/console.
 * The build output is <root>/dist/console either way, so check both layouts, then the working directory.
 */
export function defaultConsoleDir(moduleDir: string = path.dirname(fileURLToPath(import.meta.url))): string {
  const candidates = [
    path.resolve(moduleDir, '..', '..', 'dist', 'console'), // source layout
    path.resolve(moduleDir, '..', '..', 'console'), // compiled layout: dist/src/console -> dist/console
    path.resolve(process.cwd(), 'dist', 'console'),
  ];
  return candidates.find((c) => existsSync(path.join(c, 'index.html'))) ?? candidates[0]!;
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Returns a file name that is safe to join onto a directory, or undefined. Single path segment only. */
function safeName(raw: string): string | undefined {
  let name: string;
  try {
    name = decodeURIComponent(raw);
  } catch {
    return undefined;
  }
  return SAFE_NAME.test(name) && !name.includes('..') ? name : undefined;
}

export function createConsoleRouter(opts: ConsoleRouterOptions = {}): Router {
  const dir = path.resolve(opts.dir ?? defaultConsoleDir());
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Content-Security-Policy', CONSOLE_CSP);
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') return next(new CoreError('not_found', `no route ${req.method} ${req.path}`));
    // Checked per request so a build that lands after startup is picked up without a restart.
    if (!isFile(path.join(dir, 'index.html'))) {
      res.status(503).type('text/plain').send(UNBUILT_MESSAGE);
      return;
    }
    next();
  });

  const sendFrom = (res: Response, next: NextFunction, root: string, name: string, cacheControl: string) => {
    const target = path.join(root, name);
    if (!isFile(target)) return next(new CoreError('not_found', 'not found'));
    res.setHeader('Cache-Control', cacheControl);
    res.sendFile(name, { root, dotfiles: 'deny', cacheControl: false, index: false }, (err) => {
      if (err && !res.headersSent) next(new CoreError('not_found', 'not found'));
    });
  };

  // Routing is done on the raw path rather than with Express route params: params are URL-decoded by Express
  // (and a malformed escape would become a 400 outside the gateway's error shape). Here every segment is
  // matched literally first and decoded only inside safeName().
  router.use((req: Request, res: Response, next: NextFunction) => {
    const notFound = () => next(new CoreError('not_found', 'not found'));
    if (req.path === '/') return sendFrom(res, next, dir, 'index.html', 'no-store');

    const asset = /^\/assets\/([^/]+)$/.exec(req.path);
    if (asset) {
      const name = safeName(asset[1]!);
      // Vite content-hashes everything under assets/, so these never change under the same URL.
      return name ? sendFrom(res, next, path.join(dir, 'assets'), name, IMMUTABLE) : notFound();
    }

    // Public images copied from web/public. Not content-hashed, so a short cache.
    const top = /^\/([^/]+)$/.exec(req.path);
    const name = top ? safeName(top[1]!) : undefined;
    if (name && name.toLowerCase().endsWith('.webp')) return sendFrom(res, next, dir, name, 'public, max-age=3600');
    return notFound();
  });

  return router;
}
