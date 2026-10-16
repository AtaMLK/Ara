import {T,DateText} from '@/components/language';
import Link from 'next/link';
import { listNotifications } from '@/lib/data/admin';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function NotificationsPage() {
  const items = await listNotifications();

  return (
    <>
      <header className="topbar">
        <div><div className="eyebrow"><T>ADMIN</T></div><h1 className="title"><T>Notifications</T></h1><div className="muted"><T>Approvals, tasks and AI alerts</T></div></div>
      </header>

      <section className="section">
        <div className="table standard-table">
          <div className="row header"><div><T>Notification</T></div><div><T>Category</T></div><div><T>Priority</T></div><div><T>Created</T></div></div>
          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">◌</div>
              <strong><T>No notifications yet</T></strong>
              <span><T>Approvals, supplier updates and AI alerts will appear here.</T></span>
            </div>
          ) : items.map((item) => (
            <div className="row" key={item.id}>
              <div>
                <strong><T>{item.title}</T></strong>
                <div className="muted"><T>{item.message}</T></div>
                {item.action_url && <Link className="notification-open-link" href={item.action_url}><T>{item.record_type==='supplier_order_confirmation'?'Review & send supplier orders':'Open request'}</T></Link>}
              </div>
              <div><span className="badge"><T>{label(item.category)}</T></span></div>
              <div><span className="badge"><T>{label(item.priority)}</T></span></div>
              <div><DateText value={item.created_at} format="date"/></div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
