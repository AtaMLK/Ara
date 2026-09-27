import { listRfqs } from '@/lib/data/admin';

type Props = { searchParams: Promise<{ q?: string; status?: string }> };

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function RfqsPage({ searchParams }: Props) {
  const params = await searchParams;
  const items = await listRfqs(params.q, params.status);

  return (
    <>
      <header className="topbar">
        <div><div className="eyebrow">ADMIN</div><h1 className="title">RFQs</h1><div className="muted">Supplier requests for quotation</div></div>
      </header>

      <form className="filters">
        <input name="q" defaultValue={params.q} placeholder="Search subject…" />
        <select name="status" defaultValue={params.status ?? 'all'}>
          <option value="all">All statuses</option><option value="draft">Draft</option><option value="pending_approval">Pending Approval</option><option value="approved">Approved</option><option value="sent">Sent</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option>
        </select>
        <button className="secondary-button">Filter</button>
      </form>

      <section className="section">
        <div className="table">
          <div className="row header"><div>RFQ</div><div>Supplier</div><div>Status</div><div>Created</div></div>
          {items.length === 0 ? <div className="empty">No RFQs found.</div> : items.map((item) => (
            <div className="row" key={item.id}>
              <div><strong>{item.subject || 'Untitled RFQ'}</strong><div className="muted">{item.inquiries?.reference ?? '—'}</div></div>
              <div>{item.suppliers?.legal_name ?? '—'}</div>
              <div><span className="badge">{label(item.status)}</span></div>
              <div>{new Date(item.created_at).toLocaleDateString('en-GB')}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
