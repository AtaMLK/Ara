import { listNotifications } from '@/lib/data/admin';

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function NotificationsPage() {
  const items = await listNotifications();

  return (
    <>
      <header className="topbar">
        <div><div className="eyebrow">ADMIN</div><h1 className="title">Notifications</h1><div className="muted">Approvals, tasks and AI alerts</div></div>
      </header>

      <section className="section">
        <div className="table standard-table">
          <div className="row header"><div>Notification</div><div>Category</div><div>Priority</div><div>Created</div></div>
          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">◌</div>
              <strong>No notifications yet</strong>
              <span>Approvals, supplier updates and AI alerts will appear here.</span>
            </div>
          ) : items.map((item) => (
            <div className="row" key={item.id}>
              <div><strong>{item.title}</strong><div className="muted">{item.message}</div></div>
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
