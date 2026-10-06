import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import * as copy from '../copy/en.js';
import { filterRows } from '../model/present.js';
import type { ListFilter, PurchaseListVM } from '../model/types.js';
import { StatusBadge } from './Badge.js';
import { Icon } from './Icon.js';
import { detailHref, listHref, navigate } from './route.js';

const TABS: readonly ListFilter[] = ['all', 'in_progress', 'attention', 'completed'];

export function PurchaseList({ list, filter, onVisible }: { list: PurchaseListVM; filter: ListFilter; onVisible: () => void }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const rows = useMemo(() => filterRows(list.rows, filter, query), [list.rows, filter, query]);

  // Entering the list refreshes it (the caller skips this when the data is fresh).
  useEffect(() => {
    onVisible();
  }, [onVisible]);

  const selectTab = (f: ListFilter) => navigate(listHref(f), { replace: true });

  const onTabKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const i = TABS.indexOf(filter);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    e.preventDefault();
    selectTab(TABS[next] ?? 'all');
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  };

  const open = (id: string) => navigate(detailHref(id));
  const tabLabel = copy.list.tabs[filter];
  const hasQuery = query.trim() !== '';

  return (
    <>
      <div className="history-heading">
        <div>
          <h1>{copy.list.heading}</h1>
          <p className="history-subhead">{copy.list.subhead}</p>
        </div>
      </div>
      <div className="history-controls">
        <div className="tabs" role="tablist" aria-label={copy.list.tabsLabel} onKeyDown={onTabKeys}>
          {TABS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              id={`list-tab-${f}`}
              aria-selected={filter === f}
              aria-controls="list-panel"
              tabIndex={filter === f ? 0 : -1}
              className={filter === f ? 'tab active' : 'tab'}
              onClick={() => selectTab(f)}
            >
              {copy.list.tabs[f]}
              <span className="tab-count">{list.counts[f]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="table-tools">
        <label className="search">
          <Icon name="search" />
          <input
            ref={searchRef}
            type="search"
            aria-label={copy.list.searchLabel}
            placeholder={copy.list.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>
      <div className="history-wrap" role="tabpanel" id="list-panel" aria-labelledby={`list-tab-${filter}`}>
        {rows.length > 0 ? (
          <table className="history-table">
            <thead>
              <tr>
                <th scope="col">{copy.list.columns.purchase}</th>
                <th scope="col">{copy.list.columns.requestedBy}</th>
                <th scope="col">{copy.list.columns.paidWith}</th>
                <th scope="col">{copy.list.columns.amount}</th>
                <th scope="col">{copy.list.columns.status}</th>
                <th scope="col">
                  <span className="sr-only">{copy.list.columns.open}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  data-id={r.id}
                  tabIndex={0}
                  aria-label={copy.list.openRow(r.title)}
                  onClick={() => open(r.id)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open(r.id);
                    }
                  }}
                >
                  <td>
                    <div className="row-name">
                      <span className="row-category">
                        <Icon name={r.icon} />
                      </span>
                      <div>
                        <strong>{r.title}</strong>
                        <small>
                          <span className="mono">{r.displayId}</span>
                          <span>{r.merchant}</span>
                          <span>{r.createdLabel}</span>
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{r.requestedBy}</td>
                  <td className="rail-cell">
                    {r.paidWith}
                    {r.paidWithDetail ? <small>{r.paidWithDetail}</small> : null}
                  </td>
                  <td className="num">{r.amount}</td>
                  <td>
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="table-arrow">
                    <Icon name="chevron" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : list.counts.all === 0 ? (
          <div className="empty">
            <h2>{copy.list.emptyTitle}</h2>
            <p>{copy.list.emptyBody}</p>
          </div>
        ) : hasQuery ? (
          <div className="empty">
            <h2>{copy.list.noMatchTitle}</h2>
            <p>{copy.list.noMatchBody}</p>
            <button
              type="button"
              className="quiet-link clear-search"
              onClick={() => {
                setQuery('');
                searchRef.current?.focus();
              }}
            >
              {copy.list.clearSearch}
              <Icon name="arrow" />
            </button>
          </div>
        ) : (
          <div className="empty">
            <h2>{copy.list.noFilterTitle(tabLabel)}</h2>
            <p>{copy.list.noFilterBody}</p>
          </div>
        )}
      </div>
      {list.counts.all > 0 ? <div className="table-footer">{copy.list.showing(rows.length, list.counts.all)}</div> : null}
      {list.limitNote ? <div className="table-footer">{list.limitNote}</div> : null}
    </>
  );
}
