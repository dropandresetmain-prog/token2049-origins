export const LIVE_REFRESH_MS = 1500;

/** Wait after each completed read, so slow requests and manual reloads cannot form a request backlog. */
export function startDetailRefresh(read: (quiet: boolean) => Promise<boolean>, refreshMs = LIVE_REFRESH_MS) {
  if (!Number.isInteger(refreshMs) || refreshMs < 1000 || refreshMs > 60_000) throw new Error('detail refresh interval must be between 1000ms and 60000ms');
  let stopped = false;
  let inflight = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refresh = async (quiet = false): Promise<void> => {
    if (stopped || inflight) return;
    clearTimeout(timer);
    inflight = true;
    try {
      const live = await read(quiet);
      if (!stopped && live) timer = setTimeout(() => void refresh(true), refreshMs);
    } finally {
      inflight = false;
    }
  };
  void refresh();
  return {
    reload: () => { void refresh(); },
    stop: () => { stopped = true; clearTimeout(timer); },
  };
}
