import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConsoleMode, ConsoleSource } from '../contracts/source.js';
import { defaultFormatContext } from '../model/format.js';
import { presentDetail } from '../model/present.js';
import type { PurchaseDetailVM } from '../model/types.js';
import { errorInfo, isAuthLost, type ErrorInfo } from './errors.js';
import { startDetailRefresh, LIVE_REFRESH_MS } from './detailRefresh.js';

export { LIVE_REFRESH_MS } from './detailRefresh.js';

export interface DetailState {
  vm: PurchaseDetailVM | null;
  error: ErrorInfo | null;
  loading: boolean;
  reload: () => void;
}

/** Poll only a live gateway purchase. Cleanup invalidates late responses from an earlier route. */
export function useDetail(source: ConsoleSource, mode: ConsoleMode, id: string, onAuthLost: () => void, refreshMs = LIVE_REFRESH_MS): DetailState {
  const [vm, setVm] = useState<PurchaseDetailVM | null>(null);
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useRef<ReturnType<typeof startDetailRefresh> | null>(null);
  const authLost = useRef(onAuthLost);
  authLost.current = onAuthLost;

  useEffect(() => {
    let disposed = false;
    let live = false;
    let recordedFinal = false;
    setVm(null);
    setError(null);
    setLoading(true);
    const controller = startDetailRefresh(async (quiet) => {
      if (!quiet) { setLoading(true); setError(null); }
      try {
        const bundle = await source.getPurchase(id);
        if (disposed) return false;
        const next = presentDetail(bundle, { ...defaultFormatContext(), mode });
        live = source.kind === 'gateway' && next.live;
        setVm(next);
        setError(null);
        // A bounded, local DevTools mark supplies visibility timing without sending telemetry anywhere.
        if (source.kind === 'gateway' && next.completion && !recordedFinal) {
          recordedFinal = true;
          performance.clearMarks('capsule.purchase_visible');
          performance.mark('capsule.purchase_visible', { detail: {
            purchaseId: id, observedAt: new Date().toISOString(), receiptIssuedAt: bundle.purchase.receipt?.issuedAt ?? null,
          } });
        }
      } catch (e) {
        if (disposed) return false;
        if (isAuthLost(e)) { live = false; authLost.current(); }
        else if (!quiet) setError(errorInfo(e));
      } finally {
        if (!disposed && !quiet) setLoading(false);
      }
      return live;
    }, refreshMs);
    refresh.current = controller;
    return () => { disposed = true; controller.stop(); refresh.current = null; };
  }, [source, mode, id, refreshMs]);

  const reload = useCallback(() => refresh.current?.reload(), []);
  return { vm, error, loading, reload };
}
