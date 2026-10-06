import * as copy from '../copy/en.js';
import type { ErrorInfo } from './errors.js';
import { navigate, listHref } from './route.js';

const bar = (width: string, height?: string) => <span className="skeleton" style={{ width, ...(height ? { height } : {}) }} />;

export function ListSkeleton() {
  return (
    <div className="skeleton-page" role="status" aria-busy="true">
      <span className="sr-only">{copy.loading.purchases}</span>
      <div className="history-heading">
        <div>
          {bar('180px', '32px')}
          <div className="sk-gap">{bar('320px')}</div>
        </div>
      </div>
      <div className="sk-tabs">
        {bar('72px')}
        {bar('96px')}
        {bar('120px')}
        {bar('92px')}
      </div>
      <div className="sk-gap">{bar('min(320px,100%)', '34px')}</div>
      <div className="sk-table">
        {[0, 1, 2, 3, 4].map((i) => (
          <div className="sk-row" key={i}>
            {bar('32px', '32px')}
            <div className="sk-row-main">
              {bar('46%')}
              {bar('30%')}
            </div>
            {bar('64px')}
            {bar('84px', '22px')}
          </div>
        ))}
      </div>
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <div className="skeleton-page" role="status" aria-busy="true">
      <span className="sr-only">{copy.loading.purchase}</span>
      <div className="purchase-heading">
        <div>
          {bar('min(360px,70vw)', '34px')}
          <div className="sk-gap">{bar('min(300px,60vw)')}</div>
        </div>
        <div>{bar('120px', '34px')}</div>
      </div>
      <div className="sk-gap">{bar('min(520px,100%)', '40px')}</div>
      <div className="sk-block" />
      <div className="detail-grid">
        <div className="sk-steps">
          {bar('140px', '22px')}
          {[0, 1, 2, 3].map((i) => (
            <div className="sk-step" key={i}>
              {bar('22px', '22px')}
              <div className="sk-row-main">
                {bar('34%')}
                {bar('62%')}
              </div>
            </div>
          ))}
        </div>
        <div className="properties">
          {bar('100px', '22px')}
          <div className="sk-gap">{bar('100%')}</div>
          <div className="sk-gap">{bar('100%')}</div>
          <div className="sk-gap">{bar('70%')}</div>
        </div>
      </div>
    </div>
  );
}

/** Failure panel with a retry, the support code when the gateway gave one, and a way back. */
export function ErrorPanel({ error, onRetry, showBack }: { error: ErrorInfo; onRetry?: () => void; showBack?: boolean }) {
  return (
    <div className="empty error-panel" role="alert">
      <h2>{error.message}</h2>
      {error.requestId ? <p className="mono">{copy.errors.supportCode(error.requestId)}</p> : null}
      <div className="error-actions">
        {onRetry ? (
          <button type="button" className="btn primary" onClick={onRetry}>
            {copy.errors.retry}
          </button>
        ) : null}
        {showBack ? (
          <button type="button" className="btn" onClick={() => navigate(listHref('all'))}>
            {copy.errors.backToPurchases}
          </button>
        ) : null}
      </div>
    </div>
  );
}
