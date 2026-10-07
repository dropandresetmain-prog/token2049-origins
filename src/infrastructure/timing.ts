/** Passive wall-time measurement. Callers supply fixed operation names, never request values. */
export async function timedOperation<T>(component: string, step: string, run: () => Promise<T>, sink: (event: Record<string, unknown>) => void): Promise<T> {
  const started = performance.now();
  let outcome = 'error';
  try {
    const result = await run();
    outcome = 'ok';
    return result;
  } finally {
    try {
      const name = (value: string) => /^[a-z][a-z0-9_.-]{0,63}$/.test(value) ? value : 'invalid_name';
      sink({ type: 'operation.timing', component: name(component), step: name(step), durationMs: Math.round(performance.now() - started), outcome });
    } catch { /* Diagnostics cannot alter success, failure or cleanup. */ }
  }
}
