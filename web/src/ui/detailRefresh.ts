export const LIVE_REFRESH_MS = 1500;

/** Wait after each completed read, so slow requests and manual reloads cannot form a request backlog. */
export function startDetailRefresh(read: (quiet: boolean) => Promise<boolean>, refreshMs = LIVE_REFRESH_MS, visibility = typeof document === 'undefined' ? undefined : document) {
  if (!Number.isInteger(refreshMs) || refreshMs < 1000 || refreshMs > 60_000) throw new Error('detail refresh interval must be between 1000ms and 60000ms');
  const hidden = () => visibility?.visibilityState === 'hidden';
  let stopped = false;
  let inflight = false;
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async (quiet = false): Promise<void> => {
    if (stopped || inflight || hidden()) return;
    clearTimeout(timer);
    inflight = true;
    try {
      live = await read(quiet);
      if (!stopped && live && !hidden()) timer = setTimeout(() => void refresh(true), refreshMs);
    } finally {
      inflight = false;
    }
  };
  const onVisibility = () => {
    clearTimeout(timer);
    if (!hidden() && live) void refresh(true);
  };
  visibility?.addEventListener('visibilitychange', onVisibility);
  void refresh();
  return {
    reload: () => { void refresh(); },
    stop: () => { stopped = true; clearTimeout(timer); visibility?.removeEventListener('visibilitychange', onVisibility); },
  };
}
