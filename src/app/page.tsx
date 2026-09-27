import { getDashboardData } from '@/lib/data/admin';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function Dashboard() {
  const data = await getDashboardData();

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">ADMIN</div>
          <h1 className="title">Dashboard</h1>
          <div className="muted">Procurement activity and items requiring attention.</div>
        </div>
      </header>

      <section className="cards">
        {[
          ['Needs Attention', data.needsAttention],
          ['Open Inquiries', data.openInquiries],
          ['Pending RFQs', data.pendingRfqs],
          ['Quotes Awaiting Approval', data.quotesAwaitingApproval],
        ].map(([labelText, value]) => (
          <div className="card" key={String(labelText)}>
            <div className="muted">{labelText}</div>
            <div className="kpi">{value}</div>
            <div className="eyebrow">Current</div>
          </div>
        ))}
      </section>

      <section className="section">
        <div className="section-head">
          <h2>Recent Activity</h2>
        </div>
        <div className="table">
          <div className="row header">
            <div>Event</div><div>Actor</div><div>Time</div><div>Inquiry</div>
          </div>
          {data.recentActivity.length === 0 ? (
            <div className="empty">No activity yet.</div>
          ) : data.recentActivity.map((item) => (
            <div className="row" key={item.id}>
              <div>{label(item.eventType)}</div>
              <div><span className="badge">{label(item.actorType)}</span></div>
              <div>{formatDate(item.createdAt)}</div>
              <div className="muted">{item.inquiryId.slice(0, 8)}…</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
