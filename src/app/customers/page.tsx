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
      <header className="topbar">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1 className="title">Customers</h1>
          <div className="muted">Admin-created customer accounts and access.</div>
        </div>
      </header>

      <section className="detail-grid">
        <CreateCustomerForm />
        <div className="detail-card">
          <h2>Account rules</h2>
          <div className="list">
            <div className="list-item"><span>Public sign up</span><span className="badge status-rejected">Disabled</span></div>
            <div className="list-item"><span>Account creation</span><span className="badge">Admin only</span></div>
            <div className="list-item"><span>Customer password reset</span><span className="badge">Customer</span></div>
            <div className="list-item"><span>Admin password change</span><span className="badge">Admin</span></div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="table">
          <div className="row header"><div>Customer</div><div>Type / Country</div><div>Email</div><div>Status</div><div>Access</div></div>
          {(customers ?? []).length === 0 ? (
            <div className="empty">No customers yet.</div>
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
