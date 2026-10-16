import {T,Localized,DateText} from '@/components/language';
import { oneRelated } from '@/lib/data/relations';
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
          <div className="eyebrow"><T>ADMIN</T></div>
          <h1 className="title"><T>Inquiries</T></h1>
          <div className="muted"><T>Open procurement requests</T></div>
        </div>
      </header>

      <form className="filters">
        <Localized as="input" name="q" defaultValue={params.q} placeholder="Search reference or title…" />
        <select name="status" defaultValue={params.status ?? 'all'}>
          <option value="all"><T>All statuses</T></option><option value="processing"><T>Processing</T></option><option value="open"><T>Open</T></option><option value="clarification_required"><T>Clarification Required</T></option><option value="researching"><T>Researching</T></option><option value="rfq"><T>RFQ</T></option><option value="quoting"><T>Quoting</T></option><option value="converted"><T>Converted</T></option><option value="no_suitable_supplier"><T>No Suitable Supplier</T></option><option value="closed"><T>Closed</T></option>
        </select>
        <button className="secondary-button"><T>Filter</T></button>
      </form>

      <section className="section">
        <div className="table standard-table">
          <div className="row header"><div><T>Reference</T></div><div><T>Title</T></div><div><T>Status</T></div><div><T>Updated</T></div><div><T>Action</T></div></div>
          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">□</div>
              <strong><T>No inquiries found</T></strong>
              <span><T>Customer procurement requests will appear here when they are submitted.</T></span>
            </div>
          ) : items.map((item) => (
            <div className="row" key={item.id}>
              <div>
                <Link className="table-link" href={`/inquiries/${item.id}`}>
                  <strong>{getInquiryDisplayReference(item.reference, oneRelated(item.customers)?.company_name || oneRelated(item.customers)?.name, item.created_at, item.current_version, item.updated_at)}</strong>
                </Link>

                <div className="muted"><T>{item.priority}</T></div>
              </div>
              <div>{item.title}</div>
              <div><span className={`badge status-badge status-${item.status}`}><T>{label(item.status)}</T></span></div>
              <div><DateText value={item.updated_at} format="date"/></div>
              <div><DeleteInquiryButton id={item.id} reference={item.reference} /></div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
