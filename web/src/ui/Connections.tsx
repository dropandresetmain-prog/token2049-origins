import { useCallback, useMemo } from 'react';
import * as op from '../copy/operator.js';
import { defaultFormatContext } from '../model/format.js';
import { presentConnections, type BankObservationVM, type ConnectionVM, type ConnectionsVM } from '../model/operator.js';
import { Badge } from './Badge.js';
import { OperatorDenied, OperatorHeading, OperatorNote, OperatorSkeleton, TechnicalDetails } from './OperatorParts.js';
import { ErrorPanel } from './States.js';
import type { OperatorPageProps } from './Treasury.js';
import { useOperatorRead } from './useOperator.js';

const c = op.connections;

function ConnectionCard({ item }: { item: ConnectionVM }) {
  return (
    <article className={item.reported ? 'op-card' : 'op-card unreported'} aria-label={item.name}>
      <div className="op-card-head">
        <h3>{item.name}</h3>
        <Badge tone={item.status.tone}>{item.status.label}</Badge>
      </div>
      <p className="op-role">{item.role}</p>
      {item.reported ? (
        <dl className="op-facts">
          {item.environment ? (
            <div>
              <dt>{c.environment}</dt>
              <dd>{item.environment}</dd>
            </div>
          ) : null}
          {item.checked ? (
            <div>
              <dt>{c.checked}</dt>
              <dd>{item.checked}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {item.missing.length > 0 ? (
        <div className="op-missing">
          <p className="op-stat-label">{c.missingTitle}</p>
          <ul>
            {item.missing.map((m) => (
              <li key={m}>
                <code className="mono">{m}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {item.detail ? <p className="fineprint op-detail">{item.detail}</p> : null}
    </article>
  );
}

function ObservationTable({ rows, title }: { rows: BankObservationVM[]; title: string }) {
  const o = op.ocbc;
  return (
    <div className="history-wrap">
      <table className="op-table op-obs" aria-label={o.tableLabel(title)}>
        <thead>
          <tr>
            <th scope="col">{o.reference}</th>
            <th scope="col" className="num">
              {o.amount}
            </th>
            <th scope="col" className="num">
              {o.available}
            </th>
            <th scope="col">{o.observed}</th>
            <th scope="col">{o.provenance}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.kind}</strong>
                <span className="op-sub mono">{r.reference}</span>
              </td>
              <td className="num">{r.amount}</td>
              <td className="num">{r.available ?? <span className="muted">{o.amountUnavailable}</span>}</td>
              <td>
                {r.observed}
                {r.providerTime ? (
                  <span className="op-sub">
                    {o.providerTime}: {r.providerTime}
                  </span>
                ) : null}
              </td>
              <td>
                <span className="badge outline">{r.environment}</span> <span className="op-sub-inline">{r.provenance}</span>
                <span className="op-sub mono">{r.source}</span>
                {r.caveats.map((cv) => (
                  <span key={cv} className="op-sub">
                    {cv}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConnectionsView({ vm }: { vm: ConnectionsVM }) {
  const o = op.ocbc;
  const bank = vm.bank;
  return (
    <>
      <OperatorNote>{c.caveat}</OperatorNote>
      {vm.groups.map((g) => (
        <section className="op-panel" key={g.key} aria-labelledby={`op-conn-${g.key}`}>
          <div className="op-panel-head">
            <h2 id={`op-conn-${g.key}`}>{g.title}</h2>
          </div>
          <p className="op-intro">{g.intro}</p>
          <div className="op-cards">
            {g.items.map((i) => (
              <ConnectionCard key={i.key} item={i} />
            ))}
          </div>
        </section>
      ))}

      <section className="op-panel bank" aria-labelledby="op-bank">
        <div className="op-panel-head">
          <h2 id="op-bank">{bank.title}</h2>
          <Badge tone="neutral">{o.badge}</Badge>
        </div>
        <p className="op-intro">{bank.intro}</p>
        <OperatorNote icon="lock" tone="caution">
          {bank.banner}
        </OperatorNote>
        <div className="op-cards single">
          <ConnectionCard item={bank.connection} />
        </div>
        {bank.lastObserved ? (
          <p className="fineprint">
            {o.observed}: {bank.lastObserved}. {o.historical}
          </p>
        ) : null}

        {bank.empty ? (
          <p className="no-evidence">{o.empty}</p>
        ) : (
          <>
            <h3 className="op-subheading">{o.balancesTitle}</h3>
            {bank.balances.length === 0 ? <p className="no-evidence">{o.empty}</p> : <ObservationTable rows={bank.balances} title={o.balancesTitle} />}
            <h3 className="op-subheading">{o.transactionsTitle}</h3>
            {bank.transactions.length === 0 ? <p className="no-evidence">{o.emptyTransactions}</p> : <ObservationTable rows={bank.transactions} title={o.transactionsTitle} />}
          </>
        )}
      </section>

      <TechnicalDetails summary={c.technical.summary} note={c.technical.note} value={vm.technical} />
    </>
  );
}

export function Connections({ source, mode, onAuthLost, onAccess }: OperatorPageProps) {
  const read = useCallback(() => source.getConnections(), [source]);
  const { state, reload, reloading } = useOperatorRead(read, { onAuthLost, onAccess });
  const vm = useMemo(() => (state.status === 'ready' ? presentConnections(state.data, { ...defaultFormatContext(), mode }) : null), [state, mode]);

  if (state.status === 'denied') return <OperatorDenied />;
  if (state.status === 'error') return <ErrorPanel error={state.error} onRetry={reload} showBack />;
  if (!vm) return <OperatorSkeleton label={op.gate.loadingConnections} />;
  return (
    <>
      <OperatorHeading title={c.heading} subhead={c.subhead} onReload={reload} reloading={reloading} />
      <p className="fineprint op-readonly">{c.reloadHint}</p>
      <ConnectionsView vm={vm} />
    </>
  );
}
