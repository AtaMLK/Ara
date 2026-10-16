import {T,Localized} from '@/components/language';
import { oneRelated } from '@/lib/data/relations';
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
          <div className="eyebrow"><T>ADMIN</T></div>
          <h1 className="title"><T>Quotes</T></h1>
          <div className="muted"><T>Customer quotations and approvals</T></div>
        </div>
      </header>

      <form className="filters">
        <Localized as="input" name="q" defaultValue={params.q} placeholder="Search quote reference…" />
        <select name="status" defaultValue={params.status ?? 'all'}>
          <option value="all"><T>All statuses</T></option><option value="draft"><T>Draft</T></option><option value="pending_approval"><T>Pending Approval</T></option><option value="sent"><T>Sent</T></option><option value="accepted"><T>Accepted</T></option><option value="rejected"><T>Rejected</T></option><option value="expired"><T>Expired</T></option><option value="revision_requested"><T>Revision Requested</T></option>
        </select>
        <button className="secondary-button"><T>Filter</T></button>
      </form>

      <section className="section">
        <div className="table standard-table">
          <div className="row header"><div><T>Reference</T></div><div><T>Customer</T></div><div><T>Status</T></div><div><T>Currency / Validity</T></div></div>
          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">▣</div>
              <strong><T>No quotes found</T></strong>
              <span><T>Customer quotations will appear here once an inquiry reaches the quoting stage.</T></span>
            </div>
          ) : items.map((item) => (
            <div className="row" key={item.id}>
              <div><Link className="row-link" href={'/quotes/' + item.id}><strong>{item.reference}</strong></Link></div>
              <div>{oneRelated(item.customers)?.company_name || oneRelated(item.customers)?.name || '—'}</div>
              <div><span className="badge"><T>{label(item.status)}</T></span></div>
              <div className="action-cell">{item.currency} · <T>{item.valid_until ? new Date(item.valid_until).toLocaleDateString('en-GB') : 'No expiry'}</T><QuoteActions id={item.id} status={item.status} /></div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
