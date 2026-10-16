import {T,Localized} from '@/components/language';
import { listSuppliers, listSupplierRfqsBySupplierIds } from '@/lib/data/admin';
import { SupplierRfqButton } from './supplier-rfqs';
import { DeleteSupplierButton } from '@/app/admin-record-delete-button';

type Props = { searchParams: Promise<{ q?: string; status?: string }> };

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function SuppliersPage({ searchParams }: Props) {
  const params = await searchParams;
  const items = await listSuppliers(params.q, params.status);
  const rfqMap = await listSupplierRfqsBySupplierIds(items.map((item) => item.id));

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow"><T>ADMIN</T></div>
          <h1 className="title"><T>Suppliers</T></h1>
          <div className="muted"><T>Supplier database and verification</T></div>
        </div>
      </header>

      <form className="filters">
        <Localized as="input" name="q" defaultValue={params.q} placeholder="Search supplier…" />
        <select name="status" defaultValue={params.status ?? 'all'}>
          <option value="all"><T>All statuses</T></option><option value="active"><T>Active</T></option><option value="inactive"><T>Inactive</T></option>
        </select>
        <button className="secondary-button"><T>Filter</T></button>
      </form>

      <section className="section">
        <div className="table supplier-table">
          <div className="row header">
            <div><T>Supplier</T></div><div><T>Country</T></div><div><T>Contact</T></div><div><T>Verification</T></div><div><T>Status</T></div><div><T>RFQs</T></div><div><T>Action</T></div>
          </div>

          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">◇</div>
              <strong><T>No suppliers found</T></strong>
              <span><T>Supplier records will appear here once they are added or discovered.</T></span>
            </div>
          ) : items.map((item) => (
            <div className="row" key={item.id}>
              <div><strong>{item.legal_name}</strong><div className="muted"><T>{label(item.supplier_type)}</T></div></div>
              <div>{item.primary_country ||<T>{'Country not verified'}</T>}</div>
              <div>
                {item.primary_email?.email && <div>{item.primary_email.email}</div>}
                {item.primary_phone?.phone && <div className="muted">{item.primary_phone.phone}</div>}
                {item.primary_address?.address && <div className="muted">{item.primary_address.address}</div>}
                {!item.primary_email?.email && !item.primary_phone?.phone && !item.primary_address?.address && <span className="muted"><T>Profile incomplete</T></span>}
              </div>
              <div><span className="badge"><T>{item.verification_status === 'verified' ? '✓ Verified' : label(item.verification_status)}</T></span></div>
              <div><span className="badge"><T>{label(item.status)}</T></span></div>
              <div><SupplierRfqButton supplierName={item.legal_name} rfqs={(rfqMap.get(item.id) ?? []) as any} /></div>
              <div><DeleteSupplierButton id={item.id} name={item.legal_name} /></div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
