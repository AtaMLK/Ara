import Link from 'next/link';
import { listQuoteRevisionRequests } from '@/lib/data/admin';
import RevisionRequestActions from './revision-actions';

export default async function QuoteRevisionRequestsPage() {
  const items = await listQuoteRevisionRequests();

  return (
    <>
      <header className="topbar">
        <div><div className="eyebrow">ADMIN</div><h1 className="title">Quote Revisions</h1><div className="muted">Customer requests for quotation changes</div></div>
      </header>
      <section className="section">
        <div className="table">
          <div className="row header"><div>Quote</div><div>Customer</div><div>Reason</div><div>Request</div><div>Action</div></div>
          {items.length === 0 ? <div className="empty">No pending revision requests.</div> : items.map((item) => {
            const quote = Array.isArray(item.customer_quotes) ? item.customer_quotes[0] : item.customer_quotes;
            return (
              <div className="row" key={item.id}>
                <div><Link className="row-link" href={'/quotes/'+item.quote_id}><strong>{quote?.reference || 'Quotation'}</strong></Link><div className="muted">Revision R{quote?.revision_number ?? '—'}</div></div>
                <div>{quote?.customers?.company_name || quote?.customers?.name || '—'}</div>
                <div><span className="badge">{item.reason.replaceAll('_',' ')}</span></div>
                <div className="muted">{item.free_text || 'No additional details.'}</div>
                <RevisionRequestActions requestId={item.id} />
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
