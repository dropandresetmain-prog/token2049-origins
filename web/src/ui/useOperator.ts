import { useCallback, useEffect, useRef, useState } from 'react';
import { ConsoleError } from '../contracts/source.js';
import { errorInfo, isAuthLost, type ErrorInfo } from './errors.js';

/**
 * One operator read. `denied` is its own state, not an error: the access key is valid but lacks operator:read,
 * and the screen must show no operator data and no technical error for it.
 */
export type OperatorState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  | { status: 'denied' }
  | { status: 'error'; error: ErrorInfo };

export interface OperatorRead<T> {
  state: OperatorState<T>;
  reload: () => void;
  /** True while a reload is in flight and earlier data is still on screen. */
  reloading: boolean;
}

/**
 * Runs `read` on mount and on `reload`. Data already on screen is kept while a reload runs, and kept when a
 * reload fails with a transport error. A forbidden answer always clears it: access can be revoked.
 */
export function useOperatorRead<T>(
  read: () => Promise<T>,
  callbacks: { onAuthLost: () => void; onAccess: (allowed: boolean) => void },
): OperatorRead<T> {
  const [state, setState] = useState<OperatorState<T>>({ status: 'loading' });
  const [reloading, setReloading] = useState(false);
  const alive = useRef(true);
  const inflight = useRef(false);
  const cb = useRef(callbacks);
  cb.current = callbacks;
  const hasData = useRef(false);

  const load = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    if (hasData.current) setReloading(true);
    else setState({ status: 'loading' });
    try {
      const data = await read();
      if (!alive.current) return;
      hasData.current = true;
      setState({ status: 'ready', data });
      cb.current.onAccess(true);
    } catch (e) {
      if (!alive.current) return;
      if (isAuthLost(e)) {
        cb.current.onAuthLost();
      } else if (e instanceof ConsoleError && e.code === 'forbidden') {
        hasData.current = false;
        setState({ status: 'denied' });
        cb.current.onAccess(false);
      } else if (!hasData.current) {
        setState({ status: 'error', error: errorInfo(e) });
      }
    } finally {
      inflight.current = false;
      if (alive.current) setReloading(false);
    }
  }, [read]);

  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
      inflight.current = false;
    };
  }, [load]);

  const reload = useCallback(() => void load(), [load]);
  return { state, reload, reloading };
}
