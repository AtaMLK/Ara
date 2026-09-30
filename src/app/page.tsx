import Link from 'next/link';
import { AlertCircle, Inbox, Send, Receipt } from 'lucide-react';
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
          ['Needs Attention', data.needsAttention, AlertCircle],
          ['Open Inquiries', data.openInquiries, Inbox],
          ['Pending RFQs', data.pendingRfqs, Send],
          ['Quotes Awaiting Approval', data.quotesAwaitingApproval, Receipt],
        ].map(([labelText, value, Icon]) => (
          <div className="card dashboard-kpi-card" key={String(labelText)}>
            <div className="dashboard-kpi-top"><span className="dashboard-kpi-icon"><Icon size={17} strokeWidth={1.8} /></span><span className="muted">{labelText}</span></div>
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
              <Link className="muted dashboard-inquiry-link" href={`/inquiries/${item.inquiryId}`}>{item.inquiryId.slice(0, 8)}…</Link>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
