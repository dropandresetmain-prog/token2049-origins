import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as copy from '../copy/en.js';
import { ModalDialog } from './Modal.js';

interface UiApi {
  toast(text: string): void;
  /** Copy text; when the browser blocks the clipboard, show it in a dialog to copy by hand. */
  copy(text: string): void;
  /** Download a value as a JSON file, then show a toast. */
  download(value: unknown, fileName: string, toastText: string): void;
}

const Ctx = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('UiProvider is missing');
  return api;
}

const TOAST_MS = 3500;

export function UiProvider({ children }: { children: ReactNode }) {
  const [toastText, setToastText] = useState('');
  const [shown, setShown] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const [fallback, setFallback] = useState<string | null>(null);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const toast = useCallback((text: string) => {
    setToastText(text);
    setShown(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(false), TOAST_MS);
  }, []);

  const copyText = useCallback(
    (text: string) => {
      let write: Promise<void> | undefined;
      try {
        write = navigator.clipboard?.writeText(text);
      } catch {
        write = undefined;
      }
      if (!write) {
        setFallback(text);
        return;
      }
      write.then(
        () => toast(copy.detail.copied),
        () => setFallback(text),
      );
    },
    [toast],
  );

  const download = useCallback(
    (value: unknown, fileName: string, toastText: string) => {
      const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.append(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(toastText);
    },
    [toast],
  );

  const api = useMemo<UiApi>(() => ({ toast, copy: copyText, download }), [toast, copyText, download]);

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className={shown ? 'toast show' : 'toast'} role="status" aria-live="polite">
        {toastText}
      </div>
      {fallback !== null ? (
        <ModalDialog title={copy.detail.copyUnavailableTitle} onClose={() => setFallback(null)}>
          <p className="dialog-intro">{copy.detail.copyUnavailableIntro}</p>
          <textarea
            className="copy-textarea"
            readOnly
            data-autofocus
            aria-label={copy.detail.copyUnavailableTitle}
            value={fallback}
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="modal-footer">
            <button type="button" className="btn" onClick={() => setFallback(null)}>
              {copy.common.close}
            </button>
          </div>
        </ModalDialog>
      ) : null}
    </Ctx.Provider>
  );
}
