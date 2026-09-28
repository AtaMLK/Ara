import Link from 'next/link';
import { requireCustomerAccess } from '@/lib/ai/guards';

export default async function CustomerPortalPage() {
  const { supabase, customer } = await requireCustomerAccess();

  const { data: inquiries } = await supabase
    .from('inquiries')
    .select('id,reference,title,status,updated_at')
    .eq('customer_id', customer.id)
    .order('updated_at', { ascending: false });

  return (
    <main className="portal-shell">
      <header className="topbar">
        <div><div className="eyebrow">CUSTOMER PORTAL</div><h1 className="title">Welcome{customer.company_name ? `, ${customer.company_name}` : ` ${customer.name}`}</h1><div className="muted">Your procurement requests and actions.</div></div>
        <Link className="primary-button" href="/customer/inquiries/new">+ New Request</Link>
      </header>
      <section className="section">
        <div className="table">
          <div className="row header"><div>Reference</div><div>Request</div><div>Status</div><div>Updated</div></div>
          {(inquiries ?? []).length === 0 ? <div className="empty">No procurement requests yet.</div> : (inquiries ?? []).map((item) => (
            <Link className="row row-link" href={`/customer/inquiries/${item.id}`} key={item.id}>
              <div><strong>{item.reference}</strong></div><div>{item.title}</div><div><span className="badge">{item.status.replaceAll('_',' ')}</span></div><div>{new Date(item.updated_at).toLocaleDateString('en-GB')}</div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
