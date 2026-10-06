import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConsoleMode, ConsoleSource } from '../contracts/source.js';
import { defaultFormatContext } from '../model/format.js';
import { presentDetail } from '../model/present.js';
import type { PurchaseDetailVM } from '../model/types.js';
import { errorInfo, isAuthLost, type ErrorInfo } from './errors.js';

export const LIVE_REFRESH_MS = 5000;

export interface DetailState {
  vm: PurchaseDetailVM | null;
  error: ErrorInfo | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Loads one purchase and presents it. While the outcome can still change (vm.live) and the source is a gateway,
 * it re-fetches every few seconds, and stops when the purchase becomes final or the screen goes away.
 */
export function useDetail(source: ConsoleSource, mode: ConsoleMode, id: string, onAuthLost: () => void): DetailState {
  const [vm, setVm] = useState<PurchaseDetailVM | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const inflight = useRef(false);
  const alive = useRef(true);
  const authLost = useRef(onAuthLost);
  authLost.current = onAuthLost;

  const load = useCallback(
    async (quiet: boolean) => {
      if (inflight.current) return;
      inflight.current = true;
      if (!quiet) {
        setLoading(true);
        setError(null);
      }
      try {
        const bundle = await source.getPurchase(id);
        if (!alive.current) return;
        setVm(presentDetail(bundle, { ...defaultFormatContext(), mode }));
        setError(null);
      } catch (e) {
        if (!alive.current) return;
        if (isAuthLost(e)) authLost.current();
        // A failed background refresh keeps what is on screen; only a first load shows an error.
        else if (!quiet) setError(errorInfo(e));
      } finally {
        inflight.current = false;
        if (alive.current && !quiet) setLoading(false);
      }
    },
    [source, mode, id],
  );

  useEffect(() => {
    alive.current = true;
    void load(false);
    return () => {
      alive.current = false;
      inflight.current = false;
    };
  }, [load]);

  const live = vm?.live === true;
  useEffect(() => {
    if (source.kind !== 'gateway' || !live) return;
    const t = window.setInterval(() => void load(true), LIVE_REFRESH_MS);
    return () => window.clearInterval(t);
  }, [source, live, load]);

  const reload = useCallback(() => void load(false), [load]);
  return { vm, error, loading, reload };
}
