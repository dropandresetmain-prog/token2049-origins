import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as copy from '../copy/en.js';
import * as operatorCopy from '../copy/operator.js';
import type { ConsoleMode, ConsoleSource, PurchaseListResult } from '../contracts/source.js';
import { defaultFormatContext } from '../model/format.js';
import { presentList } from '../model/present.js';
import { gatewaySource, sampleSource, sourceConfig } from '../source/index.js';
import { UiProvider, useUi } from './context.js';
import { Dock } from './Dock.js';
import { AboutDialog } from './Dialogs.js';
import { errorInfo, isAuthLost, type ErrorInfo } from './errors.js';
import { PurchaseDetail } from './PurchaseDetail.js';
import { PurchaseList } from './PurchaseList.js';
import { TREASURY_HREF, detailHref, listHref, navigate, routeKey, useRoute } from './route.js';
import { EnvStrip, MobileNav, Sidebar, Topbar, type NavKey } from './Shell.js';
import { SignIn, type Connected } from './SignIn.js';
import { ErrorPanel, ListSkeleton } from './States.js';
import { Connections } from './Connections.js';
import { Treasury } from './Treasury.js';

/** Whether this access key may open the operator screens. Unknown until an operator read answers. */
type OperatorAccess = 'unknown' | 'allowed' | 'denied';

interface Session {
  source: ConsoleSource;
  mode: ConsoleMode;
  raw: PurchaseListResult;
  /** When the list was fetched, so entering the list does not refetch needlessly. */
  at: number;
}

const LIST_FRESH_MS = 3000;

function Console() {
  const ui = useUi();
  const config = useMemo(() => sourceConfig(), []);
  const sample = useMemo(() => (config.kind === 'sample' ? sampleSource() : null), [config]);
  const [probingPublic, setProbingPublic] = useState(config.kind === 'gateway');
  const [publicSession, setPublicSession] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [bootError, setBootError] = useState<ErrorInfo | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [focusMode, setFocusMode] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [title, setTitle] = useState<string | null>(null);
  const [operatorAccess, setOperatorAccess] = useState<OperatorAccess>('unknown');
  const route = useRoute();
  const mainRef = useRef<HTMLElement>(null);
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  /* A public demo connects with no credential; protected gateways still fall back to password sign-in. */
  useEffect(() => {
    const source = sample ?? (config.kind === 'gateway' ? gatewaySource(config.baseUrl, '') : null);
    if (!source) return;
    let alive = true;
    setBootError(null);
    Promise.all([source.environment(), source.listPurchases()]).then(
      ([env, raw]) => {
        if (alive) { setSession({ source, mode: env.mode, raw, at: Date.now() }); setPublicSession(!sample); setProbingPublic(false); }
      },
      (e: unknown) => {
        if (alive) {
          const error = errorInfo(e);
          if (sample || !['unauthenticated', 'forbidden'].includes(error.code)) setBootError(error);
          setProbingPublic(false);
        }
      },
    );
    return () => {
      alive = false;
    };
  }, [sample, config, attempt]);

  const signOut = useCallback((message: string) => {
    setSession(null);
    setPublicSession(false);
    setOperatorAccess('unknown');
    setNotice(message);
  }, []);

  const connected = useCallback((c: Connected) => {
    setNotice(null);
    setPublicSession(false);
    setSession({ source: c.source, mode: c.mode, raw: c.list, at: Date.now() });
  }, []);

  /*
   * Find out once per connection whether the key may use the operator screens. Allowed shows their links;
   * anything else (denied, or an answer that could not be read) leaves them out. The screens do their own
   * reads either way, so a hidden link never makes data visible and a typed address still gets the gate.
   */
  const probeSource = session?.source ?? null;
  useEffect(() => {
    setOperatorAccess('unknown');
    if (!probeSource) return;
    let alive = true;
    probeSource.hasOperatorAccess().then(
      (ok) => {
        if (alive) setOperatorAccess(ok ? 'allowed' : 'denied');
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [probeSource]);
  const onOperatorAccess = useCallback((allowed: boolean) => setOperatorAccess(allowed ? 'allowed' : 'denied'), []);
  const operator = operatorAccess === 'allowed';

  const list = useMemo(
    () => (session ? presentList(session.raw, { ...defaultFormatContext(), mode: session.mode }) : null),
    [session],
  );
  const currentId = list ? (list.rows.find((r) => r.group === 'in_progress') ?? list.rows[0])?.id ?? null : null;
  const currentHref = currentId ? detailHref(currentId) : listHref('all');
  const previousCurrentId = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousCurrentId.current;
    previousCurrentId.current = currentId;
    // Follow the current purchase; leave deliberately opened historical purchases in place.
    if (previous && currentId && previous !== currentId && route.kind === 'detail' && route.id === previous &&
        list?.rows.find((row) => row.id === currentId)?.group === 'in_progress') {
      navigate(currentHref, { replace: true });
    }
  }, [currentId, currentHref, list, route.kind, route.kind === 'detail' ? route.id : null]);

  /* The list refreshes when it is opened, unless it was fetched moments ago. */
  const refreshList = useCallback(() => {
    const s = sessionRef.current;
    if (!s || Date.now() - s.at < LIST_FRESH_MS) return;
    s.source.listPurchases().then(
      (raw) => setSession((cur) => (cur && cur.source === s.source ? { ...cur, raw, at: Date.now() } : cur)),
      (e: unknown) => {
        if (isAuthLost(e)) signOut(copy.errors.unauthenticated);
      },
    );
  }, [signOut]);

  /* New API purchases must update Current purchase even while a completed detail is open. */
  useEffect(() => {
    if (session?.source.kind !== 'gateway') return;
    const timer = window.setInterval(refreshList, 5000);
    return () => window.clearInterval(timer);
  }, [session?.source, refreshList]);

  /* Home resolves to the current purchase, replacing the entry so Back does not bounce. */
  const isHome = route.kind === 'home';
  useEffect(() => {
    if (isHome && list) navigate(currentHref, { replace: true });
  }, [isHome, list, currentHref]);

  /* Moving to another screen moves focus to the content, like a page load would. */
  const key = routeKey(route);
  const prevKey = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevKey.current;
    prevKey.current = key;
    if (prev === null || prev === 'home' || key === 'home') return;
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [key]);

  useEffect(() => {
    document.body.classList.toggle('focus', focusMode);
    return () => document.body.classList.remove('focus');
  }, [focusMode]);

  useEffect(() => {
    document.body.classList.toggle('no-dock', !sample);
    return () => document.body.classList.remove('no-dock');
  }, [sample]);

  const signedOut = config.kind === 'gateway' && !session;
  const page = signedOut
    ? null
    : route.kind === 'detail'
      ? (title ?? copy.loading.purchase)
      : route.kind === 'list'
        ? copy.list.heading
        : route.kind === 'treasury'
          ? operatorCopy.nav.treasuryTitle
          : route.kind === 'connections'
            ? operatorCopy.nav.connectionsTitle
            : null;
  useEffect(() => {
    document.title = page ? copy.nav.pageTitle(page) : copy.brand.name;
  }, [page]);

  const onAuthLost = useCallback(() => signOut(copy.errors.unauthenticated), [signOut]);
  const toggleFocus = () => {
    const next = !focusMode;
    setFocusMode(next);
    ui.toast(next ? copy.nav.presentationOn : copy.nav.presentationOff);
  };

  if (config.kind === 'gateway' && !session) {
    if (probingPublic) return <ListSkeleton />;
    if (bootError) return <ErrorPanel error={bootError} onRetry={() => { setProbingPublic(true); setAttempt(n => n + 1); }} />;
    return <SignIn baseUrl={config.baseUrl} notice={notice} onConnected={connected} />;
  }

  const navActive: NavKey | null =
    route.kind === 'treasury'
      ? 'treasury'
      : route.kind === 'connections'
        ? 'connections'
        : route.kind === 'list'
          ? route.filter === 'attention' ? 'attention' : 'purchases'
          : route.kind === 'detail'
            ? route.id === currentId ? 'live' : 'purchases'
            : 'live';
  const attentionCount = list?.counts.attention ?? 0;
  const onSignOut = config.kind === 'gateway' && !publicSession ? () => signOut(copy.signIn.signedOut) : null;

  const isOperatorRoute = route.kind === 'treasury' || route.kind === 'connections';
  const crumb =
    route.kind === 'treasury'
      ? operatorCopy.nav.treasuryTitle
      : route.kind === 'connections'
        ? operatorCopy.nav.connectionsTitle
        : route.kind === 'detail'
          ? (title ?? copy.loading.purchase)
          : route.kind === 'list' && route.filter !== 'all'
            ? copy.list.tabs[route.filter]
            : copy.list.allCrumb;
  const crumbRoot = isOperatorRoute ? operatorCopy.nav.crumb : copy.nav.purchases;
  const onCrumbRoot = () => navigate(isOperatorRoute ? TREASURY_HREF : listHref('all'));

  let content;
  if (!session || !list) {
    content = bootError ? <ErrorPanel error={bootError} onRetry={() => setAttempt((n) => n + 1)} /> : <ListSkeleton />;
  } else if (route.kind === 'treasury') {
    content = <Treasury source={session.source} mode={session.mode} onAuthLost={onAuthLost} onAccess={onOperatorAccess} />;
  } else if (route.kind === 'connections') {
    content = <Connections source={session.source} mode={session.mode} onAuthLost={onAuthLost} onAccess={onOperatorAccess} />;
  } else if (route.kind === 'list') {
    content = <PurchaseList list={list} filter={route.filter} onVisible={refreshList} />;
  } else if (route.kind === 'detail') {
    content = <PurchaseDetail key={route.id} source={session.source} mode={session.mode} id={route.id} onAuthLost={onAuthLost} onTitle={setTitle} />;
  } else {
    content = <ListSkeleton />;
  }

  return (
    <>
      <button type="button" className="sr-only skip-link" onClick={() => mainRef.current?.focus()}>
        {copy.nav.skipToContent}
      </button>
      <div className="shell">
        <Sidebar active={navActive} attentionCount={attentionCount} currentHref={currentHref} operator={operator} onSignOut={onSignOut} />
        <section className="surface" aria-label={copy.nav.appLabel}>
          <EnvStrip mode={session?.mode ?? null} />
          <Topbar root={crumbRoot} onRoot={onCrumbRoot} current={crumb} focusMode={focusMode} onFocus={toggleFocus} onAbout={() => setAboutOpen(true)} />
          <MobileNav active={navActive} attentionCount={attentionCount} currentHref={currentHref} operator={operator} onSignOut={onSignOut} />
          <main className="content" id="main" tabIndex={-1} ref={mainRef}>
            {content}
          </main>
        </section>
      </div>
      {sample ? <Dock source={sample} route={route} /> : null}
      {aboutOpen ? <AboutDialog mode={session?.mode ?? 'live'} onClose={() => setAboutOpen(false)} /> : null}
    </>
  );
}

export function App() {
  return (
    <UiProvider>
      <Console />
    </UiProvider>
  );
}
