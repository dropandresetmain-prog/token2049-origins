import { useCallback, useMemo } from 'react';
import type { ConsoleMode, ConsoleSource } from '../contracts/source.js';
import * as op from '../copy/operator.js';
import { defaultFormatContext } from '../model/format.js';
import { presentTreasury, type AccountRowVM, type CapacityVM, type TreasuryVM } from '../model/operator.js';
import { Badge } from './Badge.js';
import { OperatorDenied, OperatorHeading, OperatorNote, OperatorSkeleton, TechnicalDetails } from './OperatorParts.js';
import { ErrorPanel } from './States.js';
import { useOperatorRead } from './useOperator.js';

const t = op.treasury;

function AccountsTable({ rows, label, columns, empty }: { rows: AccountRowVM[]; label: string; columns: { account: string; asset: string; balance: string; side: string }; empty: string }) {
  if (rows.length === 0) return <p className="no-evidence">{empty}</p>;
  return (
    <div className="history-wrap">
      <table className="op-table" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">{columns.account}</th>
            <th scope="col">{columns.asset}</th>
            <th scope="col" className="num">
              {columns.balance}
            </th>
            <th scope="col">{columns.side}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.account}</td>
              <td>{r.asset}</td>
              <td className="num">{r.balance}</td>
              <td className="muted">{r.side}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Capacity({ pool }: { pool: CapacityVM }) {
  const s = t.simulated;
  return (
    <div className="op-capacity">
      <div className="op-capacity-top">
        <div>
          <p className="op-stat-label">{s.available}</p>
          <p className={pool.availableNegative ? 'op-stat negative' : 'op-stat'}>{pool.available}</p>
        </div>
        <div>
          <p className="op-stat-label">{s.limit}</p>
          <p className="op-stat soft">{pool.limit}</p>
        </div>
        <span className="op-currency">{pool.currency}</span>
      </div>
      <div className="op-bar" role="img" aria-label={`${s.barLabel(pool.currency)}: ${pool.segments.map((g) => `${g.label} ${g.amount}`).join(', ')}`}>
        {pool.barSegments.map((g) => (
          <span key={g.key} className={`op-seg ${g.key}`} style={{ width: `${g.percent}%` }} />
        ))}
      </div>
      <dl className="op-legend">
        {pool.segments.map((g) => (
          <div key={g.key}>
            <dt>
              <span className={`op-swatch ${g.key}`} aria-hidden="true" />
              {g.label}
            </dt>
            <dd>{g.amount}</dd>
            <dd className="op-hint">{g.hint}</dd>
          </div>
        ))}
      </dl>
      {pool.overspent ? <p className="fineprint warn">{s.overspent}</p> : null}
    </div>
  );
}

function TreasuryView({ vm }: { vm: TreasuryVM }) {
  const s = t.simulated;
  const o = t.observed;
  const ob = t.obligations;
  const h = t.health;
  return (
    <>
      <OperatorNote icon="layers" title={t.separationTitle}>
        {t.separationBody}
      </OperatorNote>

      <section className="op-panel simulated" aria-labelledby="op-simulated">
        <div className="op-panel-head">
          <h2 id="op-simulated">{s.title}</h2>
          <Badge tone="attention">{s.badge}</Badge>
        </div>
        <p className="op-intro">{s.intro}</p>
        {vm.simulated.capacity.length === 0 ? <p className="no-evidence">{s.empty}</p> : vm.simulated.capacity.map((p) => <Capacity key={p.currency} pool={p} />)}

        {vm.simulated.reservations.length > 0 ? (
          <>
            <h3 className="op-subheading">{s.reservationsTitle}</h3>
            <div className="history-wrap">
              <table className="op-table" aria-label={s.reservationsLabel}>
                <thead>
                  <tr>
                    <th scope="col">{s.statusColumn}</th>
                    <th scope="col" className="num">
                      {s.countColumn}
                    </th>
                    <th scope="col" className="num">
                      {s.totalColumn}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vm.simulated.reservations.map((r) => (
                    <tr key={r.key}>
                      <td>{r.status}</td>
                      <td className="num">{r.count}</td>
                      <td className="num">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        <h3 className="op-subheading">{s.accountsTitle}</h3>
        <AccountsTable
          rows={vm.simulated.accounts}
          label={s.accountsLabel}
          columns={{ account: o.accountColumn, asset: o.assetColumn, balance: o.balanceColumn, side: o.sideColumn }}
          empty={s.accountsEmpty}
        />
      </section>

      <section className="op-panel observed" aria-labelledby="op-observed">
        <div className="op-panel-head">
          <h2 id="op-observed">{o.title}</h2>
          <Badge tone="positive">{o.badge}</Badge>
        </div>
        <p className="op-intro">{o.intro}</p>

        <h3 className="op-subheading">{ob.title}</h3>
        <p className="fineprint op-lead">{ob.intro}</p>
        {vm.observed.obligations.length === 0 ? (
          <p className="no-evidence">{ob.empty}</p>
        ) : (
          <>
            <div className="history-wrap">
              <table className="op-table" aria-label={ob.tableLabel}>
                <thead>
                  <tr>
                    <th scope="col">{ob.assetColumn}</th>
                    <th scope="col" className="num">
                      {ob.prepaymentColumn}
                    </th>
                    <th scope="col" className="num">
                      {ob.unappliedColumn}
                    </th>
                    <th scope="col" className="num">
                      {ob.refundColumn}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vm.observed.obligations.map((r) => (
                    <tr key={r.asset}>
                      <td>{r.asset}</td>
                      <td className="num">{r.prepayment}</td>
                      <td className="num">{r.unapplied}</td>
                      <td className={r.refundDueNonZero ? 'num due' : 'num'}>{r.refundDue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="fineprint">{ob.refundHint}</p>
          </>
        )}

        <h3 className="op-subheading">{o.accountsTitle}</h3>
        <AccountsTable
          rows={vm.observed.accounts}
          label={o.accountsLabel}
          columns={{ account: o.accountColumn, asset: o.assetColumn, balance: o.balanceColumn, side: o.sideColumn }}
          empty={o.accountsEmpty}
        />
      </section>

      <section className="op-panel" aria-labelledby="op-purchases">
        <div className="op-panel-head">
          <h2 id="op-purchases">{t.purchases.title}</h2>
          <span className="micro-count">{vm.purchases.totalLabel}</span>
        </div>
        {vm.purchases.items.length === 0 ? (
          <p className="no-evidence">{t.purchases.empty}</p>
        ) : (
          <ul className="op-states">
            {vm.purchases.items.map((p) => (
              <li key={p.key}>
                <Badge tone={p.tone}>{p.label}</Badge>
                <strong className="num">{p.count}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="op-panel" aria-labelledby="op-health">
        <div className="op-panel-head">
          <h2 id="op-health">{h.title}</h2>
          <Badge tone={vm.health.balanced ? 'positive' : 'attention'} icon={vm.health.balanced ? 'check' : 'alert'}>
            {vm.health.label}
          </Badge>
        </div>
        <p className="op-intro">{vm.health.detail}</p>
        {vm.trialRows.length === 0 ? (
          <p className="no-evidence">{h.empty}</p>
        ) : (
          <div className="history-wrap">
            <table className="op-table" aria-label={h.tableLabel}>
              <thead>
                <tr>
                  <th scope="col">{h.ledgerColumn}</th>
                  <th scope="col">{h.assetColumn}</th>
                  <th scope="col" className="num">
                    {h.debitColumn}
                  </th>
                  <th scope="col" className="num">
                    {h.creditColumn}
                  </th>
                  <th scope="col" className="num">
                    {h.netColumn}
                  </th>
                  <th scope="col">{h.statusColumn}</th>
                </tr>
              </thead>
              <tbody>
                {vm.trialRows.map((r) => (
                  <tr key={`${r.ledgerMode}|${r.asset}`}>
                    <td>
                      <Badge tone={r.ledgerMode === 'observed' ? 'positive' : 'attention'}>{r.ledger}</Badge>
                    </td>
                    <td>{r.asset}</td>
                    <td className="num">{r.debit}</td>
                    <td className="num">{r.credit}</td>
                    <td className="num">{r.net}</td>
                    <td className={r.balanced ? 'muted' : 'due'}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <TechnicalDetails summary={t.technical.summary} note={t.technical.note} value={vm.technical} />
    </>
  );
}

export interface OperatorPageProps {
  source: ConsoleSource;
  mode: ConsoleMode;
  onAuthLost: () => void;
  onAccess: (allowed: boolean) => void;
}

export function Treasury({ source, mode, onAuthLost, onAccess }: OperatorPageProps) {
  const read = useCallback(() => source.getTreasury(), [source]);
  const { state, reload, reloading } = useOperatorRead(read, { onAuthLost, onAccess });
  const vm = useMemo(() => (state.status === 'ready' ? presentTreasury(state.data, { ...defaultFormatContext(), mode }) : null), [state, mode]);

  if (state.status === 'denied') return <OperatorDenied />;
  if (state.status === 'error') return <ErrorPanel error={state.error} onRetry={reload} showBack />;
  if (!vm) return <OperatorSkeleton label={op.gate.loadingTreasury} />;
  return (
    <>
      <OperatorHeading title={t.heading} subhead={t.subhead} onReload={reload} reloading={reloading} />
      <p className="fineprint op-readonly">{t.readonlyNote}</p>
      <TreasuryView vm={vm} />
    </>
  );
}
