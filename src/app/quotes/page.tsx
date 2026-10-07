import { listCustomerQuotes } from '@/lib/data/admin';
import Link from 'next/link';
import { QuoteActions } from './quote-actions';

type Props = { searchParams: Promise<{ q?: string; status?: string }> };

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function QuotesPage({ searchParams }: Props) {
  const params = await searchParams;
  const items = await listCustomerQuotes(params.q, params.status);

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1 className="title">Quotes</h1>
          <div className="muted">Customer quotations and approvals</div>
        </div>
      </header>

      <form className="filters">
        <input name="q" defaultValue={params.q} placeholder="Search quote reference…" />
        <select name="status" defaultValue={params.status ?? 'all'}>
          <option value="all">All statuses</option><option value="draft">Draft</option><option value="pending_approval">Pending Approval</option><option value="sent">Sent</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="expired">Expired</option><option value="revision_requested">Revision Requested</option>
        </select>
        <button className="secondary-button">Filter</button>
      </form>

      <section className="section">
        <div className="table standard-table">
          <div className="row header"><div>Reference</div><div>Customer</div><div>Status</div><div>Currency / Validity</div></div>
          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">▣</div>
              <strong>No quotes found</strong>
              <span>Customer quotations will appear here once an inquiry reaches the quoting stage.</span>
            </div>
          ) : items.map((item) => (
            <div className="row" key={item.id}>
              <div><Link className="row-link" href={'/quotes/' + item.id}><strong>{item.reference}</strong></Link></div>
              <div>{item.customers?.company_name || item.customers?.name || '—'}</div>
              <div><span className="badge">{label(item.status)}</span></div>
              <div className="action-cell">{item.currency} · {item.valid_until ? new Date(item.valid_until).toLocaleDateString('en-GB') : 'No expiry'}<QuoteActions id={item.id} status={item.status} /></div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
