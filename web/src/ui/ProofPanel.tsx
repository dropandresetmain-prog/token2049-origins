import { Fragment, useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import * as copy from '../copy/en.js';
import type { ProofSectionVM, PurchaseDetailVM } from '../model/types.js';
import { Badge, StatusBadge } from './Badge.js';
import { useUi } from './context.js';
import { Icon } from './Icon.js';

export type ProofTab = 'summary' | 'activity';
const TABS: readonly ProofTab[] = ['summary', 'activity'];
const INERT_SELECTOR = '.shell, .review-dock, .skip-link';
const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), a[href], summary, [tabindex]:not([tabindex="-1"])';

function Section({ section }: { section: ProofSectionVM }) {
  const ui = useUi();
  const reference = section.reference;
  return (
    <section className="proof-block">
      <div className="proof-title">
        <h3>
          <Icon name={section.icon} />
          {section.heading}
        </h3>
        <Badge tone={section.badge.tone}>{section.badge.label}</Badge>
      </div>
      <dl className="evidence-dl">
        {section.fields.map((f) => (
          <Fragment key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.mono ? <span className="mono">{f.value}</span> : f.value}</dd>
          </Fragment>
        ))}
      </dl>
      {reference ? (
        <div className="reference-box">
          <div>
            <p>{reference.label}</p>
            <span className="mono">{reference.value}</span>
          </div>
          <button type="button" className="icon-button" aria-label={reference.copyLabel} onClick={() => ui.copy(reference.value)}>
            <Icon name="copy" />
          </button>
        </div>
      ) : null}
      {section.note ? <p className={section.badge.tone === 'pending' ? 'no-evidence' : 'info-box'}>{section.note}</p> : null}
    </section>
  );
}

/** Right-side drawer. Modal: the page behind it is inert, Tab stays inside, Escape closes, focus comes back. */
export function ProofPanel({
  vm,
  tab,
  onTab,
  onClose,
}: {
  vm: PurchaseDetailVM;
  tab: ProofTab | null;
  onTab: (t: ProofTab) => void;
  onClose: () => void;
}) {
  const ui = useUi();
  const open = tab !== null;
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastTab = useRef<ProofTab>('summary');
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  if (tab) lastTab.current = tab;
  const shown = tab ?? lastTab.current;
  const proof = vm.proof;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const inerted = Array.from(document.querySelectorAll<HTMLElement>(INERT_SELECTOR));
    inerted.forEach((n) => {
      n.inert = true;
    });
    closeRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => {
      // A dialog on top (for example the copy fallback) handles its own Escape.
      if (e.key === 'Escape' && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        onCloseRef.current();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      inerted.forEach((n) => {
        n.inert = false;
      });
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  const trapTab = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return;
    const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((n) => n.offsetParent !== null);
    const first = nodes[0];
    const last = nodes.at(-1);
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onTabKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const i = TABS.indexOf(shown);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    e.preventDefault();
    onTab(TABS[next] ?? 'summary');
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  // What the download contains: everything the panel shows, plus the raw record for support.
  const { downloadName, available: _available, ...record } = proof;

  return createPortal(
    <>
      <div className={open ? 'scrim open' : 'scrim'} aria-hidden="true" onClick={onClose} />
      <aside
        ref={panelRef}
        className={open ? 'inspector open' : 'inspector'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
        inert={!open}
        onKeyDown={trapTab}
      >
        <div className="inspector-top">
          <div className="inspector-title">
            <h2 id={titleId}>{copy.proof.title}</h2>
            <button ref={closeRef} type="button" className="icon-button" aria-label={copy.proof.close} onClick={onClose}>
              <Icon name="close" />
            </button>
          </div>
          <div className="inspector-meta">
            <span className="mono">{vm.displayId}</span>
            <StatusBadge status={vm.status} />
          </div>
        </div>
        <div className="inspector-tabs" role="tablist" aria-label={copy.proof.tabsLabel} onKeyDown={onTabKeys}>
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              id={`proof-tab-${t}`}
              aria-selected={shown === t}
              aria-controls="proof-body"
              tabIndex={shown === t ? 0 : -1}
              className={shown === t ? 'active' : undefined}
              onClick={() => onTab(t)}
            >
              {t === 'summary' ? copy.proof.tabSummary : copy.proof.tabActivity}
            </button>
          ))}
        </div>
        <div className="inspector-body" id="proof-body" role="tabpanel" aria-labelledby={`proof-tab-${shown}`} tabIndex={0}>
          {!proof.available ? (
            <p className="no-evidence">{copy.proof.unavailable}</p>
          ) : shown === 'summary' ? (
            <>
              {proof.disclaimer ? <div className="evidence-disclaimer">{proof.disclaimer}</div> : null}
              {proof.sections.map((s) => (
                <Section key={s.heading} section={s} />
              ))}
            </>
          ) : (
            <>
              {proof.activity.length === 0 ? <p className="no-evidence">{copy.proof.activityEmpty}</p> : null}
              {proof.activity.map((a, i) => (
                <div className="audit-item" key={`${i}-${a.label}`}>
                  <span className="audit-index">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <h3>{a.label}</h3>
                    <p className="mono">{a.time}</p>
                  </div>
                </div>
              ))}
              <details className="raw-details">
                <summary>{copy.proof.technicalDetails}</summary>
                <pre className="raw-audit">{JSON.stringify(proof.technicalRecord, null, 2)}</pre>
              </details>
            </>
          )}
        </div>
        {proof.available ? (
          <div className="inspector-footer">
            <button type="button" className="btn" onClick={() => ui.download(record, downloadName, copy.proof.downloaded)}>
              <Icon name="download" />
              {copy.proof.download}
            </button>
          </div>
        ) : null}
      </aside>
    </>,
    document.body,
  );
}
