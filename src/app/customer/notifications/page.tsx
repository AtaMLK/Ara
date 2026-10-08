import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function CustomerNotificationsPage() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return <main className="auth-page"><div className="auth-card"><h1 className="title">Sign in required</h1><Link className="primary-button" href="/login">Sign in</Link></div></main>;
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
          <div className="eyebrow">CUSTOMER PORTAL</div>
          <h1 className="title">Notifications</h1>
          <div className="muted">Updates and actions related to your procurement requests.</div>
        </div>
      </header>

      <section className="section">
        {(items ?? []).length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon" aria-hidden="true">◌</div><strong>No notifications yet</strong><span>Updates about your requests will appear here.</span></div>
        ) : (
          <div className="notification-list">
            {(items ?? []).map((item) => (
              <div className={`customer-notification-card${item.read_at ? '' : ' is-unread'}`} key={item.id}>
                <div>
                  <div className="customer-notification-head"><strong>{item.title}</strong><span className="muted">{new Date(item.created_at).toLocaleString('en-GB')}</span></div>
                  <div className="muted">{label(item.category)} · {label(item.priority)}</div>
                  <p>{item.message}</p>
                </div>
                {item.action_url && <Link className="secondary-button" href={item.action_url}>Open request</Link>}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
