import { requireAdminPage } from '@/lib/data/admin';
import { CreateCustomerForm, ChangeCustomerPassword } from './customer-form';

export default async function CustomersPage() {
  const { supabase } = await requireAdminPage();
  const { data: customers, error } = await supabase
    .from('customers')
    .select('id,customer_code,name,customer_type,company_name,email,country,status,created_at')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) throw error;

  return (
    <>
      <header className="topbar customers-topbar">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1 className="title">Customers</h1>
          <div className="muted">Admin-created customer accounts and access.</div>
        </div>
      </header>

      <section className="section customer-create-section"><CreateCustomerForm /></section>

      <section className="section">
        <div className="table standard-table">
          <div className="row header"><div>Customer</div><div>Type / Country</div><div>Email</div><div>Status</div><div>Access</div></div>
          {(customers ?? []).length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">◇</div>
              <strong>No customers yet</strong>
              <span>Create a customer account above and it will appear in this list.</span>
            </div>
          ) : (customers ?? []).map((customer) => (
            <div className="row" key={customer.id}>
              <div>
                <strong>{customer.company_name || customer.name}</strong>
                <div className="muted">{customer.customer_code} · {customer.name}</div>
              </div>
              <div>
                {customer.customer_type === 'company' ? 'Company' : 'Individual'} · {customer.country}
              </div>
              <div>{customer.email}</div>
              <div><span className={`badge ${customer.status === 'active' ? 'status-approved' : 'status-rejected'}`}>{customer.status}</span></div>
              <div><ChangeCustomerPassword customerId={customer.id} /></div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
