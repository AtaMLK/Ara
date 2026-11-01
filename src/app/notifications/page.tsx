import Link from 'next/link';
import AdminAttention from '@/components/AdminAttention';
import { notificationHref } from '@/lib/notifications';
import { listNotifications,listAttentionRecords } from '@/lib/data/admin';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function NotificationsPage({searchParams}:{searchParams:Promise<{view?:string;inquiry?:string}>}) {
  const {view,inquiry}=await searchParams;
  const items = view==='alerts'||view==='tasks'?await listAttentionRecords(view,inquiry):await listNotifications();

  return (
    <>
      <header className="topbar">
        <div><div className="eyebrow">ADMIN</div><h1 className="title">Notifications</h1><div className="muted">Approvals, tasks and AI alerts</div></div>
      </header>

      <AdminAttention mode="center" />
      <nav className="notification-tabs"><Link href="/notifications">Notifications</Link><Link href="/notifications?view=alerts">Open AI alerts</Link><Link href="/notifications?view=tasks">Open tasks</Link></nav>
      <section className="section">
        <div className="table">
          <div className="row header"><div>Notification</div><div>Category</div><div>Priority</div><div>Created</div></div>
          {items.length === 0 ? <div className="empty">No notifications yet.</div> : items.map((item) => (
            <div className={`row notification-row ${!view&&!item.read_at?'is-unread':''}`} key={item.id}>
              <div><Link href={notificationHref(item.action_url)}><strong>{item.title}</strong>{!view&&!item.read_at&&<span className="badge">Unread</span>}</Link><div className="muted">{item.message}</div></div>
              <div><span className="badge">{label(item.category)}</span></div>
              <div><span className="badge">{label(item.priority)}</span></div>
              <div>{new Date(item.created_at).toLocaleDateString('en-GB')}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
