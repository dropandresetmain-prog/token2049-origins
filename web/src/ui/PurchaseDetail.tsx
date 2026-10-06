import { useCallback, useEffect, useState } from 'react';
import * as copy from '../copy/en.js';
import type { ConsoleMode, ConsoleSource } from '../contracts/source.js';
import type { FlowState, PurchaseDetailVM, StepVM } from '../model/types.js';
import { Badge, StatusBadge } from './Badge.js';
import { useUi } from './context.js';
import { QuoteDialog, ReceiptDialog } from './Dialogs.js';
import { Icon } from './Icon.js';
import { ProofPanel, type ProofTab } from './ProofPanel.js';
import { DetailSkeleton, ErrorPanel } from './States.js';
import { useDetail } from './useDetail.js';

const mark = `${import.meta.env.BASE_URL}mark-crop.webp`;

/** Flow state to the prototype's conduit classes. Only 'active' moves; stopped and idle are dashed. */
function conduit(flow: FlowState): { className: string; packet: boolean } {
  switch (flow) {
    case 'done': return { className: 'conduit done', packet: true };
    case 'active': return { className: 'conduit active', packet: true };
    case 'idle':
    case 'stopped': return { className: 'conduit dashed', packet: false };
  }
}

function Conduit({ flow }: { flow: FlowState }) {
  const c = conduit(flow);
  return (
    <div className={c.className} aria-hidden="true">
      {c.packet ? (
        <span className="packet-track">
          <span className="packet" />
        </span>
      ) : null}
    </div>
  );
}

function Route({ vm }: { vm: PurchaseDetailVM }) {
  const { from, capsule, to } = vm.route;
  const fromIcon = from.payment.method === copy.paymentMethod.masumi ? 'layers' : 'wallet';
  return (
    <section className="route-panel" aria-label={copy.detail.routeHeading}>
      <h2 className="sr-only">{copy.detail.routeHeading}</h2>
      <div className="route">
        <div className="endpoint">
          <div className="endpoint-label">{from.label}</div>
          <div className="endpoint-heading">
            <div className="endpoint-icon">
              <Icon name="agent" />
            </div>
            <div>
              <h3>{from.name}</h3>
              <small>{from.detail}</small>
            </div>
          </div>
          {from.payment.method ? (
            <div className="endpoint-funding">
              <Icon name={fromIcon} />
              <span>{from.payment.method}</span>
              {from.payment.network ? <span className="endpoint-network">{from.payment.network}</span> : null}
            </div>
          ) : null}
        </div>
        <Conduit flow={vm.route.flowIn} />
        <div className={capsule.stopped ? 'gateway-node stopped' : 'gateway-node'}>
          <div className="gateway-label">{capsule.label}</div>
          <div className="gateway-symbol">
            <img src={mark} alt="" />
          </div>
          <span className="gateway-action">{capsule.action}</span>
        </div>
        <Conduit flow={vm.route.flowOut} />
        <div className="endpoint">
          <div className="endpoint-label">{to.label}</div>
          <div className="endpoint-heading">
            <div className="endpoint-icon">
              <Icon name={to.icon} />
            </div>
            <div>
              <h3>{to.name}</h3>
              <small>{to.detail}</small>
            </div>
          </div>
          <div className={to.done ? 'endpoint-result verified' : 'endpoint-result'}>
            <Icon name={to.resultIcon} />
            <span>{to.result}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Step({ step, index }: { step: StepVM; index: number }) {
  return (
    <li className={`step ${step.status}`}>
      <span className="step-circle">
        {step.status === 'done' ? (
          <>
            <Icon name="check" />
            <span className="sr-only">{copy.stepState.done}</span>
          </>
        ) : step.status === 'attention' ? (
          <Icon name="alert" />
        ) : step.status === 'current' ? null : (
          index + 1
        )}
      </span>
      <div>
        <strong>{step.label}</strong>
        <p>{step.detail}</p>
      </div>
      <time>{step.time}</time>
    </li>
  );
}

export function Loaded({ vm, onProof, onReceipt, onQuote }: { vm: PurchaseDetailVM; onProof: (t: ProofTab) => void; onReceipt: () => void; onQuote: () => void }) {
  const ui = useUi();
  const { summary, request, attention } = vm;
  return (
    <>
      <div className="purchase-heading">
        <div>
          <h1>{vm.title}</h1>
          <div className="subhead">
            <span className="id-group">
              <span className="mono">{vm.displayId}</span>
              <button type="button" className="icon-button" aria-label={copy.detail.copyId} title={copy.detail.copyId} onClick={() => ui.copy(vm.id)}>
                <Icon name="copy" />
              </button>
            </span>
            <span>{vm.requestedBy}</span>
            <span>{vm.createdLabel}</span>
            <StatusBadge status={vm.status} />
          </div>
        </div>
        <div className="price-block">
          <div className="price-label">{copy.detail.totalLabel}</div>
          <div className="price">
            {vm.total.amount}
            <span className="currency">{vm.total.currency}</span>
          </div>
        </div>
      </div>

      {request ? (
        <div className="request">
          <div className="request-icon">
            <Icon name="chat" />
          </div>
          <div>
            {request.text ? <p className="request-text">{copy.detail.requestQuote(request.text)}</p> : null}
            {request.limit ? (
              <div className="request-approval">
                <Icon name="approval" />
                {request.limit}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {attention ? (
        <div className={attention.tone === 'neutral' ? 'status-message neutral' : 'status-message'}>
          <Icon name="alert" />
          <div className="status-text">
            <h2>{attention.title}</h2>
            <p>{attention.body}</p>
          </div>
          <button type="button" className="btn primary" onClick={() => ui.copy(attention.action.copyText)}>
            <Icon name="copy" />
            {attention.action.label}
          </button>
        </div>
      ) : null}

      {vm.completion ? (
        <section className="completion-panel" aria-label={vm.completion.title}>
          <div className="completion-mark"><Icon name="check" /></div>
          <div className="completion-result">
            <h2>{vm.completion.title}</h2>
            {vm.completion.reference ? (
              <div className="completion-reference">
                <span>{vm.completion.reference.label}</span>
                <strong className="mono">{vm.completion.reference.value}</strong>
                <button type="button" className="icon-button" aria-label={vm.completion.reference.copyLabel} onClick={() => ui.copy(vm.completion!.reference!.value)}><Icon name="copy" /></button>
              </div>
            ) : null}
            {vm.route.to.detail ? <p className="fineprint">{vm.route.to.detail}</p> : null}
          </div>
          <div className="completion-actions">
            {vm.receipt ? <button type="button" className="btn primary" onClick={onReceipt}><Icon name="receipt" />{copy.detail.openReceipt}</button> : null}
            <button type="button" className="btn" onClick={() => onProof('summary')}>{copy.detail.proofButton}<Icon name="arrow" /></button>
          </div>
        </section>
      ) : null}

      <Route vm={vm} />

      <div className="detail-grid">
        <section className="activity-section">
          <div className="section-heading">
            <h2>{vm.stepsHeading}</h2>
            <span className="micro-count">{vm.stepsCount}</span>
          </div>
          <ol className="steps">
            {vm.steps.map((s, i) => (
              <Step key={s.key} step={s} index={i} />
            ))}
          </ol>
          <div className="progress-foot">
            <div className="foot-links">
              <button type="button" className="quiet-link" onClick={() => onProof('activity')}>
                <Icon name="history" />
                {copy.detail.openActivity}
                <Icon name="arrow" />
              </button>
              {vm.receipt ? (
                <button type="button" className="quiet-link" onClick={onReceipt}>
                  <Icon name="receipt" />
                  {copy.detail.openReceipt}
                  <Icon name="external" />
                </button>
              ) : null}
            </div>
            <button type="button" className="btn" onClick={() => onProof('summary')}>
              <Icon name="receipt" />
              {copy.detail.proofButton}
              <span className="muted">{copy.detail.proofCount(vm.proof.confirmedCount, 2)}</span>
              <Icon name="arrow" />
            </button>
          </div>
        </section>

        <aside className="properties" aria-label={copy.detail.summaryHeading}>
          <h2>{copy.detail.summaryHeading}</h2>
          <div className="summary-inner">
            <div>
              <div className="offer-mini">
                <div className="offer-icon">
                  <Icon name={summary.item.icon} />
                </div>
                <div>
                  <strong>{summary.item.title}</strong>
                  <small>{summary.item.detail}</small>
                </div>
              </div>
              <dl className="costs">
                {summary.costs.map((c) => (
                  <div key={c.label}>
                    <dt>{c.label}</dt>
                    <dd>{c.value}</dd>
                  </div>
                ))}
                <div className="total-row">
                  <dt>{summary.total.label}</dt>
                  <dd>{summary.total.value}</dd>
                </div>
              </dl>
              {summary.notes.map((n) => (
                <p className="fineprint" key={n}>
                  {n}
                </p>
              ))}
              {vm.quote ? (
                <button type="button" className="quiet-link price-link" onClick={onQuote}>
                  {copy.detail.priceDetails}
                  <Icon name="external" />
                </button>
              ) : null}
            </div>
            <div>
              <section className="property-section">
                <div className="small-heading">
                  <h3>{copy.detail.paymentHeading}</h3>
                </div>
                {summary.payment.method ? (
                  <div className="inline-funding">
                    <Icon name={summary.payment.method === copy.paymentMethod.masumi ? 'layers' : 'wallet'} />
                    {summary.payment.method}
                    {summary.payment.network ? <Badge tone="neutral">{summary.payment.network}</Badge> : null}
                  </div>
                ) : null}
                {summary.payment.amount ? <p className="fineprint">{summary.payment.amount}</p> : null}
                {summary.payment.note ? <p className="fineprint">{summary.payment.note}</p> : null}
                <div className="lock-line">
                  <Icon name={summary.payment.locked ? 'lock' : 'wallet'} />
                  {summary.payment.lockText}
                </div>
              </section>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

export function PurchaseDetail({ source, mode, id, onAuthLost, onTitle }: { source: ConsoleSource; mode: ConsoleMode; id: string; onAuthLost: () => void; onTitle: (title: string | null) => void }) {
  const { vm, error, loading, reload } = useDetail(source, mode, id, onAuthLost);
  const [proofTab, setProofTab] = useState<ProofTab | null>(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const closeProof = useCallback(() => setProofTab(null), []);

  const title = vm?.title ?? (error ? copy.errors.crumb : null);
  useEffect(() => {
    onTitle(title);
  }, [title, onTitle]);
  useEffect(() => () => onTitle(null), [onTitle]);

  if (!vm) {
    if (error) return <ErrorPanel error={error} onRetry={reload} showBack />;
    return loading ? <DetailSkeleton /> : null;
  }

  return (
    <>
      <Loaded vm={vm} onProof={setProofTab} onReceipt={() => setReceiptOpen(true)} onQuote={() => setQuoteOpen(true)} />
      <ProofPanel vm={vm} tab={proofTab} onTab={setProofTab} onClose={closeProof} />
      {receiptOpen && vm.receipt ? <ReceiptDialog receipt={vm.receipt} onClose={() => setReceiptOpen(false)} /> : null}
      {quoteOpen && vm.quote ? <QuoteDialog quote={vm.quote} onClose={() => setQuoteOpen(false)} /> : null}
    </>
  );
}
