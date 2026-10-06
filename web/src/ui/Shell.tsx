import * as copy from '../copy/en.js';
import type { ConsoleMode } from '../contracts/source.js';
import { Icon, type IconKey } from './Icon.js';
import { listHref, navigate } from './route.js';

const asset = (file: string) => `${import.meta.env.BASE_URL}${file}`;

export type NavKey = 'live' | 'purchases' | 'attention';

export function EnvStrip({ mode }: { mode: ConsoleMode | null }) {
  if (mode !== 'sample' && mode !== 'test') return null;
  const text = mode === 'sample' ? copy.environment.sample : copy.environment.test;
  return (
    <div className="env-strip" role="note">
      <Icon name="flask" />
      <span>
        <strong>{text.strong}</strong> {text.text}
      </span>
    </div>
  );
}

interface NavProps {
  active: NavKey | null;
  attentionCount: number;
  currentHref: string;
}

const goLive = (href: string) => navigate(href);

export function Sidebar({ active, attentionCount, currentHref, onSignOut }: NavProps & { onSignOut: (() => void) | null }) {
  const item = (key: NavKey, icon: IconKey, label: string, onClick: () => void, count?: number) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-current={active === key ? 'page' : undefined}
      className={active === key ? 'selected' : undefined}
      onClick={onClick}
    >
      <span className="nav-icon">
        <Icon name={icon} />
      </span>
      <span>{label}</span>
      {count ? <span className="count">{count}</span> : null}
    </button>
  );
  return (
    <aside className="sidebar" aria-label={copy.nav.sidebarLabel}>
      <a href="#/" className="brand" aria-label={copy.nav.brandLabel}>
        <img className="brand-full" src={asset('wordmark-accent-crop.webp')} alt={copy.brand.name} />
        <img className="brand-small" src={asset('mark-crop.webp')} alt={copy.brand.name} />
      </a>
      <div className="workspace">
        <div className="workspace-symbol">
          <img src={asset('mark-crop.webp')} alt="" />
        </div>
        <div>
          <strong>{copy.nav.workspaceName}</strong>
          <small>{copy.nav.workspaceDetail}</small>
        </div>
      </div>
      <p className="nav-label">{copy.nav.navLabel}</p>
      <nav className="nav" aria-label={copy.nav.navLabel}>
        {item('live', 'activity', copy.nav.live, () => goLive(currentHref))}
        {item('purchases', 'purchases', copy.nav.purchases, () => navigate(listHref('all')))}
        {item('attention', 'approval', copy.nav.attention, () => navigate(listHref('attention')), attentionCount)}
      </nav>
      <div className="sidebar-bottom">
        {onSignOut ? (
          <div className="nav">
            <button type="button" aria-label={copy.signIn.signOut} title={copy.signIn.signOut} onClick={onSignOut}>
              <span className="nav-icon">
                <Icon name="arrow" />
              </span>
              <span>{copy.signIn.signOut}</span>
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

export function MobileNav({ active, attentionCount, currentHref, onSignOut }: NavProps & { onSignOut: (() => void) | null }) {
  const item = (key: NavKey, icon: IconKey, label: string, onClick: () => void, count?: number) => (
    <button type="button" aria-current={active === key ? 'page' : undefined} className={active === key ? 'selected' : undefined} onClick={onClick}>
      <Icon name={icon} />
      {label}
      {count ? <span className="count">{count}</span> : null}
    </button>
  );
  return (
    <nav className="mobile-nav" aria-label={copy.nav.navLabel}>
      {item('live', 'activity', copy.nav.liveShort, () => goLive(currentHref))}
      {item('purchases', 'purchases', copy.nav.purchases, () => navigate(listHref('all')))}
      {item('attention', 'approval', copy.nav.attention, () => navigate(listHref('attention')), attentionCount)}
      {onSignOut ? (
        <button type="button" onClick={onSignOut}>
          {copy.signIn.signOut}
        </button>
      ) : null}
    </nav>
  );
}

export function Topbar({
  current,
  focusMode,
  onFocus,
  onAbout,
}: {
  current: string;
  focusMode: boolean;
  onFocus: () => void;
  onAbout: () => void;
}) {
  return (
    <header className="topbar">
      <nav className="breadcrumbs" aria-label={copy.nav.breadcrumbLabel}>
        <button type="button" onClick={() => navigate(listHref('all'))}>
          {copy.nav.purchases}
        </button>
        <span className="crumb-slash" aria-hidden="true">
          {copy.nav.crumbSeparator}
        </span>
        <span className="crumb-current" aria-current="page">
          {current}
        </span>
      </nav>
      <div className="top-tools">
        <button
          type="button"
          className="icon-button focus-button"
          aria-label={copy.nav.presentation}
          aria-pressed={focusMode}
          title={copy.nav.presentation}
          onClick={onFocus}
        >
          <Icon name="expand" />
        </button>
        <button type="button" className="icon-button" aria-label={copy.nav.about} title={copy.nav.about} onClick={onAbout}>
          <Icon name="info" />
        </button>
      </div>
    </header>
  );
}
