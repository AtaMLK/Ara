import Link from 'next/link';
import { listInquiries } from '@/lib/data/admin';

type Props = { searchParams: Promise<{ q?: string; status?: string }> };

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function InquiriesPage({ searchParams }: Props) {
  const params = await searchParams;
  const items = await listInquiries(params.q, params.status);

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1 className="title">Inquiries</h1>
          <div className="muted">Open procurement requests</div>
        </div>
      </header>

      <form className="filters">
        <input name="q" defaultValue={params.q} placeholder="Search reference or title…" />
        <select name="status" defaultValue={params.status ?? 'all'}>
          <option value="all">All statuses</option>
          <option value="processing">Processing</option>
          <option value="open">Open</option>
          <option value="clarification_required">Clarification Required</option>
          <option value="researching">Researching</option>
          <option value="rfq">RFQ</option>
          <option value="quoting">Quoting</option>
          <option value="converted">Converted</option>
          <option value="no_suitable_supplier">No Suitable Supplier</option>
          <option value="closed">Closed</option>
        </select>
        <button className="secondary-button">Filter</button>
      </form>

      <section className="section">
        <div className="table">
          <div className="row header"><div>Reference</div><div>Title</div><div>Status</div><div>Updated</div></div>
          {items.length === 0 ? <div className="empty">No inquiries found.</div> : items.map((item) => (
            <Link className="row row-link" href={`/inquiries/${item.id}`} key={item.id}>
              <div><strong>{item.reference}</strong><div className="muted">{item.priority}</div></div>
              <div>{item.title}</div>
              <div><span className="badge">{label(item.status)}</span></div>
              <div>{new Date(item.updated_at).toLocaleDateString('en-GB')}</div>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
