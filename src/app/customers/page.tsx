import {T} from '@/components/language';
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
          <div className="eyebrow"><T>ADMIN</T></div>
          <h1 className="title"><T>Customers</T></h1>
          <div className="muted"><T>Admin-created customer accounts and access.</T></div>
        </div>
      </header>

      <section className="section customer-create-section"><CreateCustomerForm /></section>

      <section className="section">
        <div className="table standard-table">
          <div className="row header"><div><T>Customer</T></div><div><T>Type / Country</T></div><div><T>Email</T></div><div><T>Status</T></div><div><T>Access</T></div></div>
          {(customers ?? []).length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">◇</div>
              <strong><T>No customers yet</T></strong>
              <span><T>Create a customer account above and it will appear in this list.</T></span>
            </div>
          ) : (customers ?? []).map((customer) => (
            <div className="row" key={customer.id}>
              <div>
                <strong>{customer.company_name || customer.name}</strong>
                <div className="muted">{customer.customer_code} · {customer.name}</div>
              </div>
              <div>
                <T>{customer.customer_type === 'company' ? 'Company' : 'Individual'}</T> · {customer.country}
              </div>
              <div>{customer.email}</div>
              <div><span className={`badge ${customer.status === 'active' ? 'status-approved' : 'status-rejected'}`}><T>{customer.status}</T></span></div>
              <div><ChangeCustomerPassword customerId={customer.id} /></div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
