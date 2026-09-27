import Link from 'next/link';
import { getCustomerQuote } from '@/lib/data/admin';
import { QuoteItemEditor } from './quote-item-editor';
import { QuoteActions } from '../quote-actions';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quote = await getCustomerQuote(id);

  return (
    <>
      <header className="topbar">
        <div>
          <Link className="back-link" href="/quotes">← Quotes</Link>
          <div className="eyebrow">CUSTOMER QUOTE</div>
          <h1 className="title">{quote.reference}</h1>
          <div className="muted">{quote.customers?.company_name || quote.customers?.name || 'Customer'} · {quote.currency}</div>
        </div>
        <div className="topbar-actions">
          <span className="badge">{label(quote.status)}</span>
          <QuoteActions id={quote.id} status={quote.status} />
        </div>
      </header>

      <section className="detail-grid">
        <div className="detail-card">
          <div className="section-head"><h2>Quote details</h2></div>
          <dl className="details">
            <div><dt>Reference</dt><dd>{quote.reference}</dd></div>
            <div><dt>Customer</dt><dd>{quote.customers?.company_name || quote.customers?.name || '—'}</dd></div>
            <div><dt>Currency</dt><dd>{quote.currency}</dd></div>
            <div><dt>Validity</dt><dd>{quote.valid_until ? new Date(quote.valid_until).toLocaleDateString('en-GB') : 'No expiry'}</dd></div>
            <div><dt>Revision</dt><dd>R{quote.revision_number}</dd></div>
          </dl>
        </div>
        <div className="detail-card">
          <div className="section-head"><h2>Commercial control</h2></div>
          <p className="muted">Suggested prices come from an approved pricing rule. Every customer price must be explicitly confirmed by Admin before approval.</p>
          <div className="quote-control-note">
            <strong>{quote.confirmedItemCount}/{quote.items.length}</strong> prices confirmed
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>Quote items</h2><span className="muted">{quote.items.length} line{quote.items.length === 1 ? '' : 's'}</span></div>
        <div className="quote-items">
          {quote.items.length === 0 ? <div className="empty">No quote items.</div> : quote.items.map((item) => (
            <QuoteItemEditor key={item.id} item={item} currency={quote.currency} editable={quote.status === 'draft' || quote.status === 'pending_approval'} />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="detail-card">
          <div className="section-head"><h2>Customer message</h2></div>
          <div className="detail-text">{quote.body || 'No message.'}</div>
        </div>
      </section>
    </>
  );
}
