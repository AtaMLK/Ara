import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import SignOutButton from '@/components/SignOutButton';
import { getInquiryDisplayReference } from '@/lib/ui/inquiry-reference';

export default async function CustomerPortalPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <main className="auth-page"><div className="auth-card"><div className="brand">ARAT</div><h1 className="title">Sign in required</h1><Link className="primary-button" href="/login">Sign in</Link></div></main>;

  const { data: profile } = await supabase.from('profiles').select('role,status').eq('user_id', user.id).single();
  if (profile?.role !== 'customer' || profile.status !== 'active') {
    return <main className="section"><div className="error-box">Customer portal access is not available for this account.</div></main>;
  }

  const { data: customer } = await supabase.from('customers').select('id,name,company_name,status').eq('user_id', user.id).single();
  if (!customer || customer.status !== 'active') return <main className="section"><div className="error-box">Customer account not found or inactive.</div></main>;

  const { data: inquiries } = await supabase
    .from('inquiries')
    .select('id,reference,title,status,updated_at')
    .eq('customer_id', customer.id)
    .order('updated_at', { ascending: false });

  return (
    <main className="portal-shell">
      <header className="topbar">
        <div><div className="eyebrow">CUSTOMER PORTAL</div><h1 className="title">Welcome{customer.company_name ? `, ${customer.company_name}` : ` ${customer.name}`}</h1><div className="muted">Your procurement requests and actions.</div></div>
        <div className="topbar-actions"><Link className="primary-button new-request-button" href="/customer/inquiries/new"><span aria-hidden="true">+</span> New Request</Link><SignOutButton /></div>
      </header>
      <section className="section">
        <div className="table customer-requests-table">
          <div className="row header"><div>Reference</div><div>Request</div><div>Status</div><div>Updated</div></div>
          {(inquiries ?? []).length === 0 ? <div className="empty">No procurement requests yet.</div> : (inquiries ?? []).map((item) => (
            <Link className="row row-link" href={`/customer/inquiries/${item.id}`} key={item.id}>
              <div><strong>{getInquiryDisplayReference(item.reference, customer.company_name || customer.name, undefined, 1, item.updated_at)}</strong><div className="inquiry-reference-full">{item.reference}</div></div><div>{item.title}</div><div className="status-cell"><span className={`badge status-badge status-${item.status}`}>{item.status.replaceAll('_',' ')}</span></div><div>{new Date(item.updated_at).toLocaleDateString('en-GB')}</div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
