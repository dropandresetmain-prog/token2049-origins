import * as copy from '../copy/en.js';
import type { ConsoleMode, Field, QuoteVM, ReceiptVM } from '../model/types.js';
import { Badge } from './Badge.js';
import { useUi } from './context.js';
import { Icon } from './Icon.js';
import { ModalDialog } from './Modal.js';

const logo = (file: string) => `${import.meta.env.BASE_URL}${file}`;

function FieldValue({ field }: { field: Field }) {
  return field.mono ? <span className="mono">{field.value}</span> : <span>{field.value}</span>;
}

export function ReceiptDialog({ receipt, onClose }: { receipt: ReceiptVM; onClose: () => void }) {
  const ui = useUi();
  return (
    <ModalDialog title={copy.receipt.title} onClose={onClose}>
      <img className="receipt-brand" src={logo('wordmark-accent-crop.webp')} alt={copy.brand.name} />
      <Badge tone="positive" icon="check">
        {receipt.sample ? copy.receipt.sampleBadge : copy.status.completed.label}
      </Badge>
      <div className="receipt-total num">
        {receipt.total} <small>{receipt.currency}</small>
      </div>
      <p className="receipt-item">{receipt.itemTitle}</p>
      <div className="receipt-meta">
        {receipt.fields.map((f) => (
          <div key={f.label}>
            <span>{f.label}</span>
            <FieldValue field={f} />
          </div>
        ))}
      </div>
      {receipt.notes.length > 0 ? <h3 className="sr-only">{copy.receipt.notesHeading}</h3> : null}
      {receipt.notes.map((n) => (
        <p className="receipt-note" key={n}>
          {n}
        </p>
      ))}
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          {copy.receipt.close}
        </button>
        <button type="button" className="btn primary" onClick={() => ui.download(receipt.download, receipt.downloadName, copy.receipt.downloaded)}>
          <Icon name="download" />
          {copy.receipt.download}
        </button>
      </div>
    </ModalDialog>
  );
}

export function QuoteDialog({ quote, onClose }: { quote: QuoteVM; onClose: () => void }) {
  const rows: Field[] = [
    { label: copy.quoteDialog.rowItem, value: quote.itemTitle },
    { label: copy.quoteDialog.rowDetails, value: quote.details },
    ...quote.lines,
    quote.fee,
  ];
  return (
    <ModalDialog title={copy.quoteDialog.title} onClose={onClose}>
      <p className="dialog-intro">{copy.quoteDialog.intro}</p>
      <div className="quote-scope">
        {rows.map((f) => (
          <div key={f.label}>
            <span>{f.label}</span>
            <FieldValue field={f} />
          </div>
        ))}
        <div className="quote-total">
          <span>{quote.total.label}</span>
          <strong>{quote.total.value}</strong>
        </div>
        {[quote.limit, quote.validUntil, quote.quoteNumber].map((f) =>
          f ? (
            <div key={f.label}>
              <span>{f.label}</span>
              <FieldValue field={f} />
            </div>
          ) : null,
        )}
      </div>
      {quote.notes.map((n) => (
        <p className="info-box" key={n}>
          {n}
        </p>
      ))}
      {quote.source ? (
        <div className="quote-scope source-store">
          {[quote.source.foundAt, quote.source.listedPrice].map((f) => (
            <div key={f.label}>
              <span>{f.label}</span>
              <FieldValue field={f} />
            </div>
          ))}
          <p className="source-note">{quote.source.note}</p>
          <a className="source-link" href={quote.source.link.href} target="_blank" rel="noopener noreferrer">
            {quote.source.link.label}
          </a>
        </div>
      ) : null}
      <h3 className="terms-heading">{copy.quoteDialog.termsHeading}</h3>
      {quote.terms.length > 0 ? (
        <ul className="terms-list">
          {quote.terms.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="terms-none">{copy.quoteDialog.noTerms}</p>
      )}
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          {copy.quoteDialog.close}
        </button>
      </div>
    </ModalDialog>
  );
}

export function AboutDialog({ mode, onClose }: { mode: ConsoleMode; onClose: () => void }) {
  return (
    <ModalDialog title={copy.about.title} onClose={onClose}>
      <p className="dialog-intro">{copy.about.intro}</p>
      <p className="info-box">{copy.about.readOnly}</p>
      {mode === 'sample' ? <p className="info-box">{copy.about.sampleNote}</p> : null}
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          {copy.about.close}
        </button>
      </div>
    </ModalDialog>
  );
}
