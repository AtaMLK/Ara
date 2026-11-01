import Link from 'next/link';
import { listQuoteRevisionRequests } from '@/lib/data/admin';
import RevisionRequestActions from './revision-actions';

export default async function QuoteRevisionRequestsPage({searchParams}:{searchParams:Promise<{status?:string}>}) {
  const {status}=await searchParams;
  const items = await listQuoteRevisionRequests(status);

  return (
    <>
      <header className="topbar">
        <div><div className="eyebrow">ADMIN</div><h1 className="title">Quote Revisions</h1><div className="muted">Customer requests for quotation changes</div></div>
      </header>
      <nav className="notification-tabs" aria-label="Revision request status"><Link href="/quotes/revisions" aria-current={!status||status==='all'?'page':undefined}>All requests</Link><Link href="/quotes/revisions?status=pending" aria-current={status==='pending'?'page':undefined}>Awaiting review</Link><Link href="/quotes/revisions?status=reviewed" aria-current={status==='reviewed'?'page':undefined}>Reviewed</Link></nav>
      <section className="section">
        <div className="table revision-queue-table">
          <div className="row header"><div>Quote</div><div>Customer</div><div>Reason</div><div>Request</div><div>Action</div></div>
          {items.length === 0 ? <div className="empty">{status==='pending'?'No requests awaiting review.':'No revision requests found.'}</div> : items.map((item) => {
            const quote = Array.isArray(item.customer_quotes) ? item.customer_quotes[0] : item.customer_quotes;
            return (
              <div className="row" key={item.id}>
                <div><Link className="row-link" href={'/quotes/'+item.quote_id}><strong>{quote?.reference || 'Quotation'}</strong></Link><div className="muted">Revision R{quote?.revision_number ?? '—'} · {new Date(item.created_at).toLocaleDateString('en-GB')}</div></div>
                <div>{quote?.customers?.company_name || quote?.customers?.name || '—'}</div>
                <div><span className="badge">{item.reason.replaceAll('_',' ')}</span></div>
                <div className="muted">{item.free_text || 'No additional details.'}</div>
                {item.status==='pending_approval'?<RevisionRequestActions requestId={item.id}/>:<div className="revision-history-result"><span className="badge">{item.status==='approved'?'Approved':item.status==='rejected'?'Rejected':'Cancelled'}</span>{item.revisedQuoteId&&<Link className="inline-button" href={'/quotes/'+item.revisedQuoteId}>View revised quote →</Link>}{item.reviewed_at&&<small className="muted">Reviewed {new Date(item.reviewed_at).toLocaleDateString('en-GB')}</small>}</div>}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
