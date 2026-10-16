import {T,DateText} from '@/components/language';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function CustomerNotificationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <main className="auth-page"><div className="auth-card"><h1 className="title"><T>Sign in required</T></h1><Link className="primary-button" href="/login"><T>Sign in</T></Link></div></main>;
  }

  const { data: items } = await supabase
    .from('notifications')
    .select('id,category,priority,title,message,record_type,record_id,action_url,read_at,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  return (
    <main className="portal-shell">
      <header className="topbar">
        <div>
          <Link className="back-icon-button" href="/customer" aria-label="Back to portal" title="Back to portal"><span aria-hidden="true">←</span></Link>
          <div className="eyebrow"><T>CUSTOMER PORTAL</T></div>
          <h1 className="title"><T>Notifications</T></h1>
          <div className="muted"><T>Updates and actions related to your procurement requests.</T></div>
        </div>
      </header>

      <section className="section">
        {(items ?? []).length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon" aria-hidden="true">◌</div><strong><T>No notifications yet</T></strong><span><T>Updates about your requests will appear here.</T></span></div>
        ) : (
          <div className="notification-list">
            {(items ?? []).map((item) => (
              <div className={`customer-notification-card${item.read_at ? '' : ' is-unread'}`} key={item.id}>
                <div>
                  <div className="customer-notification-head"><strong><T>{item.title}</T></strong><span className="muted"><DateText value={item.created_at} format="datetime"/></span></div>
                  <div className="muted"><T>{label(item.category)}</T> · <T>{label(item.priority)}</T></div>
                  <p><T>{item.message}</T></p>
                </div>
                {item.action_url && <Link className="secondary-button" href={item.action_url}><T>Open request</T></Link>}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
