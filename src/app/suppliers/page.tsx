import { listSuppliers } from '@/lib/data/admin';
import { DeleteSupplierButton } from '@/app/admin-record-delete-button';

type Props = { searchParams: Promise<{ q?: string; status?: string }> };

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function SuppliersPage({ searchParams }: Props) {
  const params = await searchParams;
  const items = await listSuppliers(params.q, params.status);

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
        <button className="secondary-button">Filter</button>
      </form>

      <section className="section">
        <div className="table">
          <div className="row header"><div>Supplier</div><div>Country</div><div>Contact</div><div>Verification</div><div>Status</div><div>Action</div></div>
          {items.length === 0 ? <div className="empty">No suppliers found.</div> : items.map((item) => (
            <div className="row" key={item.id}>
              <div><strong>{item.legal_name}</strong><div className="muted">{label(item.supplier_type)}</div></div>
              <div>{item.primary_country || 'Country not verified'}</div>
              <div>
                {item.primary_email?.email && <div>{item.primary_email.email}</div>}
                {item.primary_phone?.phone && <div className="muted">{item.primary_phone.phone}</div>}
                {item.primary_address?.address && <div className="muted">{item.primary_address.address}</div>}
                {!item.primary_email?.email && !item.primary_phone?.phone && !item.primary_address?.address && <span className="muted">Profile incomplete</span>}
              </div>
              <div><span className="badge">{item.verification_status === 'verified' ? '✓ Verified' : label(item.verification_status)}</span></div>
              <div><span className="badge">{label(item.status)}</span></div>
              <div><DeleteSupplierButton id={item.id} name={item.legal_name} /></div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
