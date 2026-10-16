import {T} from '@/components/language';
import { oneRelated } from '@/lib/data/relations';
import Link from 'next/link';
import { listQuoteRevisionRequests } from '@/lib/data/admin';
import RevisionRequestActions from './revision-actions';

export default async function QuoteRevisionRequestsPage() {
  const items = await listQuoteRevisionRequests();

  return (
    <>
      <header className="topbar">
        <div><div className="eyebrow"><T>ADMIN</T></div><h1 className="title"><T>Quote Revisions</T></h1><div className="muted"><T>Customer requests for quotation changes</T></div></div>
      </header>
      <section className="section">
        <div className="table">
          <div className="row header"><div><T>Quote</T></div><div><T>Customer</T></div><div><T>Reason</T></div><div><T>Request</T></div><div><T>Action</T></div></div>
          {items.length === 0 ? <div className="empty"><T>No pending revision requests.</T></div> : items.map((item) => {
            const quote = Array.isArray(item.customer_quotes) ? item.customer_quotes[0] : item.customer_quotes;
            return (
              <div className="row" key={item.id}>
                <div><Link className="row-link" href={'/quotes/'+item.quote_id}><strong>{quote?.reference ||<T>{'Quotation'}</T>}</strong></Link><div className="muted"><T>Revision R</T>{quote?.revision_number ?? '—'}</div></div>
                <div>{oneRelated(quote?.customers)?.company_name || oneRelated(quote?.customers)?.name || '—'}</div>
                <div><span className="badge">{item.reason.replaceAll('_',' ')}</span></div>
                <div className="muted">{item.free_text ||<T>{'No additional details.'}</T>}</div>
                <RevisionRequestActions requestId={item.id} />
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
