import { listSuppliers } from '@/lib/data/admin';
import SupplierIdentityReview from './identity-review';

type Props = { searchParams: Promise<{ q?: string; status?: string; quality?: string }> };

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function SuppliersPage({ searchParams }: Props) {
  const params = await searchParams;
  const items = await listSuppliers(params.q, params.status, params.quality);

  return (
    <>
      <header className="topbar">
        <div><div className="eyebrow">ADMIN</div><h1 className="title">Suppliers</h1><div className="muted">Supplier database and verification</div></div>
      </header>

      <form className="filters">
        <input name="q" defaultValue={params.q} placeholder="Search supplier…" />
        <select name="status" defaultValue={params.status ?? 'all'}>
          <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
        </select>
        <select name="quality" defaultValue={params.quality ?? 'primary'} aria-label="Supplier identity view">
          <option value="primary">Primary suppliers</option><option value="review">Identity review required</option>
          <option value="duplicates">Duplicate records</option><option value="all">All records</option>
        </select>
        <button className="secondary-button">Filter</button>
      </form>

      <section className="section">
        {params.quality === 'review' && <p className="notice-box">These records need a confirmed company identity before new RFQs can be sent. Historical records are preserved.</p>}
        {params.quality === 'duplicates' && <p className="notice-box">Duplicate records are inactive aliases. Their historical quotes and correspondence remain linked to the original records.</p>}
        <div className="table">
          <div className="row header"><div>Supplier</div><div>Country</div><div>Verification</div><div>Status</div></div>
          {items.length === 0 ? <div className="empty">No suppliers found.</div> : items.map((item) => (
            <div className="row" key={item.id}>
              <div><strong>{item.legal_name}</strong><div className="muted">{label(item.supplier_type)}</div>
                {item.identity_needs_review && <><p className="error-inline">{item.identity_review_reason}</p><SupplierIdentityReview supplier={item} /></>}
              </div>
              <div>{item.primary_country}</div>
              <div><span className="badge">{item.canonical_supplier_id?'Duplicate record':item.identity_needs_review?'Identity review required':label(item.verification_status)}</span></div>
              <div><span className="badge">{label(item.status)}</span></div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
