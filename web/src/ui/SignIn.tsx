import { useId, useState, type FormEvent } from 'react';
import * as copy from '../copy/en.js';
import type { ConsoleMode, ConsoleSource, PurchaseListResult } from '../contracts/source.js';
import { gatewaySource } from '../source/index.js';
import { errorInfo } from './errors.js';

export interface Connected {
  source: ConsoleSource;
  mode: ConsoleMode;
  list: PurchaseListResult;
}

/**
 * Gateway mode only. The access key lives in this component's state until the source is built, and then only
 * inside that in-memory source. It is never written to storage, a URL or a log.
 */
export function SignIn({ baseUrl, notice, onConnected }: { baseUrl: string; notice: string | null; onConnected: (c: Connected) => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const helpId = useId();
  const errorId = useId();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = key.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    try {
      const source = gatewaySource(baseUrl, value);
      const list = await source.listPurchases();
      const env = await source.environment();
      onConnected({ source, mode: env.mode, list });
    } catch (err) {
      setError(errorInfo(err).message);
      setBusy(false);
    }
  };

  return (
    <main className="signin-wrap" id="main">
      <form className="signin-card" onSubmit={submit}>
        <img className="signin-brand" src={`${import.meta.env.BASE_URL}wordmark-accent-crop.webp`} alt={copy.brand.name} />
        <h1>{copy.signIn.title}</h1>
        <p className="dialog-intro">{copy.signIn.intro}</p>
        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
        <div className="field">
          <label htmlFor={inputId}>{copy.signIn.label}</label>
          <input
            id={inputId}
            type="password"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            aria-describedby={error ? `${errorId} ${helpId}` : helpId}
            aria-invalid={error ? true : undefined}
          />
          {error ? (
            <p className="field-error" id={errorId} role="alert">
              {error}
            </p>
          ) : null}
          <p className="fineprint" id={helpId}>
            {copy.signIn.help}
          </p>
        </div>
        <button type="submit" className="btn primary signin-submit" disabled={busy || key.trim() === ''}>
          {busy ? copy.signIn.connecting : copy.signIn.submit}
        </button>
      </form>
    </main>
  );
}
