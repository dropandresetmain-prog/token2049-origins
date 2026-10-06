import * as copy from '../copy/en.js';
import type { SampleSource } from '../source/index.js';
import { detailHref, listHref, navigate, type Route } from './route.js';

const SCENARIOS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'in-progress', label: copy.dock.inProgress },
  { key: 'completed', label: copy.dock.completed },
  { key: 'checking', label: copy.dock.checking },
  { key: 'price-changed', label: copy.dock.priceChange },
  { key: 'awaiting-payment', label: copy.dock.awaitingPayment },
];

/** Bottom bar of shortcuts into the sample scenarios. Rendered only when the console runs on sample data. */
export function Dock({ source, route }: { source: SampleSource; route: Route }) {
  return (
    <footer className="review-dock" aria-label={copy.dock.label}>
      <div className="dock-label">{copy.dock.label}</div>
      <div className="dock-steps">
        {SCENARIOS.map((s, i) => {
          const id = source.idFor(s.key);
          const active = route.kind === 'detail' && route.id === id;
          return (
            <button
              key={s.key}
              type="button"
              className={active ? 'dock-button active' : 'dock-button'}
              aria-current={active ? 'page' : undefined}
              disabled={!id}
              onClick={() => id && navigate(detailHref(id))}
            >
              <span>{String(i + 1).padStart(2, '0')}</span>
              {s.label}
            </button>
          );
        })}
        <button
          type="button"
          className={route.kind === 'list' ? 'dock-button active' : 'dock-button'}
          aria-current={route.kind === 'list' ? 'page' : undefined}
          onClick={() => navigate(listHref('all'))}
        >
          <span>{String(SCENARIOS.length + 1).padStart(2, '0')}</span>
          {copy.dock.purchases}
        </button>
      </div>
    </footer>
  );
}
