import {T,Localized,DateText} from '@/components/language';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import SignOutButton from '@/components/SignOutButton';
import { getInquiryDisplayReference } from '@/lib/ui/inquiry-reference';

export default async function CustomerPortalPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return <main className="auth-page"><div className="auth-card"><div className="brand"><T>ARAT</T></div><h1 className="title"><T>Sign in required</T></h1><Link className="primary-button" href="/login"><T>Sign in</T></Link></div></main>;

  const { data: profile } = await supabase.from('profiles').select('role,status').eq('user_id', user.id).single();
  if (profile?.role !== 'customer' || profile.status !== 'active') {
    return <main className="section"><div className="error-box"><T>Customer portal access is not available for this account.</T></div></main>;
  }

  const { data: customer } = await supabase.from('customers').select('id,name,company_name,status').eq('user_id', user.id).single();
  if (!customer || customer.status !== 'active') return <main className="section"><div className="error-box"><T>Customer account not found or inactive.</T></div></main>;

  const { data: inquiries } = await supabase
    .from('inquiries')
    .select('id,reference,title,status,created_at,current_version,updated_at')
    .eq('customer_id', customer.id)
    .order('updated_at', { ascending: false });

  const inquiryIds = (inquiries ?? []).map((item) => item.id);
  const { data: notifications } = inquiryIds.length
    ? await supabase.from('notifications').select('id,title,message,record_type,record_id,action_url,read_at,created_at').eq('user_id', user.id).is('read_at', null).order('created_at', { ascending: false }).limit(100)
    : { data: [] };

  function notificationTone(item: { title: string; message: string; record_type: string | null }) {
    const text = (item.title + ' ' + item.message).toLowerCase();
    if (item.record_type === 'customer_quote' || text.includes('quotation sent') || text.includes('quote')) return 'success';
    if (text.includes('could not') || text.includes('cannot') || text.includes('reject') || text.includes('unfortunately')) return 'danger';
    if (item.record_type === 'clarification' || text.includes('information is needed') || text.includes('clarification')) return 'warning';
    return 'info';
  }

  const notificationByInquiry = new Map<string, { tone: string; title: string }>();
  for (const item of notifications ?? []) {
    const match = item.action_url?.match(/\/customer\/inquiries\/([^/?#]+)/);
    if (!match || notificationByInquiry.has(match[1])) continue;
    notificationByInquiry.set(match[1], { tone: notificationTone(item), title: item.title });
  }

  return (
    <main className="portal-shell">
      <header className="topbar">
        <div><div className="eyebrow"><T>CUSTOMER PORTAL</T></div><h1 className="title"><T>Welcome</T>{customer.company_name ? `, ${customer.company_name}` : ` ${customer.name}`}</h1><div className="muted"><T>Your procurement requests and actions.</T></div></div>
        <div className="topbar-actions"><Link className="primary-button new-request-button" href="/customer/inquiries/new"><span aria-hidden="true">+</span><T> New Request</T></Link><SignOutButton /></div>
      </header>
      <section className="section">
        <div className="table customer-requests-table">
          <div className="row header"><div><T>Reference</T></div><div><T>Request</T></div><div><T>Status</T></div><div><T>Updated</T></div></div>
          {(inquiries ?? []).length === 0 ? <div className="empty"><T>No procurement requests yet.</T></div> : (inquiries ?? []).map((item) => (
            <Link className="row row-link" href={`/customer/inquiries/${item.id}`} key={item.id}>
              <div><strong>{getInquiryDisplayReference(item.reference, customer.company_name || customer.name, item.created_at, item.current_version, item.updated_at)}</strong></div><div>{item.title}</div><div className="status-cell"><span className={`badge status-badge status-${item.status}`}><T>{item.status.replaceAll('_',' ')}</T></span>{notificationByInquiry.get(item.id) && <Localized as="span" className={`customer-request-notification-dot customer-request-notification-dot--${notificationByInquiry.get(item.id)!.tone}`} title={notificationByInquiry.get(item.id)!.title} aria-label={notificationByInquiry.get(item.id)!.title} />}</div><div><DateText value={item.updated_at} format="date"/></div>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
