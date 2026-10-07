import Link from 'next/link';
import { listInquiries } from '@/lib/data/admin';
import { getInquiryDisplayReference } from '@/lib/ui/inquiry-reference';
import { DeleteInquiryButton } from '@/app/admin-record-delete-button';

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
          <option value="all">All statuses</option><option value="processing">Processing</option><option value="open">Open</option><option value="clarification_required">Clarification Required</option><option value="researching">Researching</option><option value="rfq">RFQ</option><option value="quoting">Quoting</option><option value="converted">Converted</option><option value="no_suitable_supplier">No Suitable Supplier</option><option value="closed">Closed</option>
        </select>
        <button className="secondary-button">Filter</button>
      </form>

      <section className="section">
        <div className="table standard-table">
          <div className="row header"><div>Reference</div><div>Title</div><div>Status</div><div>Updated</div><div>Action</div></div>
          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">□</div>
              <strong>No inquiries found</strong>
              <span>Customer procurement requests will appear here when they are submitted.</span>
            </div>
          ) : items.map((item) => (
            <Link className="row row-link" href={`/inquiries/${item.id}`} key={item.id}>
              <div><strong>{getInquiryDisplayReference(item.reference, item.customers?.company_name || item.customers?.name, item.created_at, item.current_version, item.updated_at)}</strong><div className="muted inquiry-reference-full">{item.reference}</div><div className="muted">{item.priority}</div></div>
              <div>{item.title}</div>
              <div><span className={`badge status-badge status-${item.status}`}>{label(item.status)}</span></div>
              <div>{new Date(item.updated_at).toLocaleDateString('en-GB')}</div>
              <DeleteInquiryButton id={item.id} reference={item.reference} />
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
