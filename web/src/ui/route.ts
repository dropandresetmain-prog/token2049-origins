/**
 * Hash routes: #/purchases (optionally ?filter=attention) and #/purchases/<id>. Anything else is "home",
 * which resolves to the current purchase. Hash routing needs no server support under /console.
 */
import { useSyncExternalStore } from 'react';
import type { ListFilter } from '../model/types.js';

export type Route =
  | { kind: 'home' }
  | { kind: 'list'; filter: ListFilter }
  | { kind: 'detail'; id: string };

const FILTERS: readonly ListFilter[] = ['all', 'in_progress', 'attention', 'completed'];

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '');
  const at = raw.indexOf('?');
  const path = at < 0 ? raw : raw.slice(0, at);
  const query = at < 0 ? '' : raw.slice(at + 1);
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'purchases') {
    if (parts.length === 1) {
      const f = new URLSearchParams(query).get('filter');
      return { kind: 'list', filter: FILTERS.includes(f as ListFilter) ? (f as ListFilter) : 'all' };
    }
    if (parts.length === 2) {
      try {
        return { kind: 'detail', id: decodeURIComponent(parts[1] ?? '') };
      } catch {
        return { kind: 'home' };
      }
    }
  }
  return { kind: 'home' };
}

export const listHref = (filter: ListFilter): string => (filter === 'all' ? '/purchases' : `/purchases?filter=${filter}`);
export const detailHref = (id: string): string => `/purchases/${encodeURIComponent(id)}`;

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  const hash = `#${to}`;
  if (opts.replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = to;
  }
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash, () => '');
  return parseHash(hash);
}

export function routeKey(r: Route): string {
  return r.kind === 'detail' ? `detail:${r.id}` : r.kind === 'list' ? 'list' : 'home';
}
