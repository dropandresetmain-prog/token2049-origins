import type { ReactNode } from 'react';
import * as op from '../copy/operator.js';
import type { Tone } from '../copy/en.js';
import { Badge } from './Badge.js';
import { Icon, type IconKey } from './Icon.js';
import { navigate, listHref } from './route.js';

/** Page title row with a Reload button. Reload only re-reads stored data. */
export function OperatorHeading({ title, subhead, onReload, reloading, extra }: { title: string; subhead: string; onReload?: () => void; reloading?: boolean; extra?: ReactNode }) {
  return (
    <div className="history-heading">
      <div>
        <h1>{title}</h1>
        <p className="history-subhead">{subhead}</p>
      </div>
      <div className="op-heading-tools">
        {extra}
        {onReload ? (
          <button type="button" className="btn" onClick={onReload} disabled={reloading} aria-busy={reloading || undefined}>
            {reloading ? op.gate.reloading : op.gate.reload}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A note that must stay visible, with an icon so it is not mistaken for body copy. */
export function OperatorNote({ icon = 'info', title, children, tone = 'neutral' }: { icon?: IconKey; title?: string; children: ReactNode; tone?: 'neutral' | 'caution' }) {
  return (
    <div className={tone === 'caution' ? 'op-note caution' : 'op-note'} role="note">
      <Icon name={icon} />
      <div>
        {title ? <strong>{title}</strong> : null}
        <p>{children}</p>
      </div>
    </div>
  );
}

export function ToneBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <Badge tone={tone}>{children}</Badge>;
}

/** Shown instead of any operator data when the access key lacks operator:read. Nothing about the data is named. */
export function OperatorDenied() {
  return (
    <div className="empty op-denied" role="alert">
      <h2>{op.gate.deniedTitle}</h2>
      <p>{op.gate.deniedBody}</p>
      <div className="error-actions">
        <button type="button" className="btn" onClick={() => navigate(listHref('all'))}>
          {op.gate.back}
        </button>
      </div>
    </div>
  );
}

export function OperatorSkeleton({ label }: { label: string }) {
  const bar = (width: string, height?: string) => <span className="skeleton" style={{ width, ...(height ? { height } : {}) }} />;
  return (
    <div className="skeleton-page" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="history-heading">
        <div>
          {bar('180px', '32px')}
          <div className="sk-gap">{bar('360px')}</div>
        </div>
      </div>
      <div className="sk-block" />
      <div className="sk-table">
        {[0, 1, 2].map((i) => (
          <div className="sk-row" key={i}>
            <div className="sk-row-main">
              {bar('40%')}
              {bar('24%')}
            </div>
            {bar('84px')}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Support/audit disclosure. The value is the parsed response, never a free-form raw body. */
export function TechnicalDetails({ summary, note, value }: { summary: string; note: string; value: unknown }) {
  return (
    <details className="raw-details">
      <summary>{summary}</summary>
      <p className="fineprint">{note}</p>
      <pre className="raw-audit">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}
