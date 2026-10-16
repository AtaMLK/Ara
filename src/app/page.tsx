import {T,DateText} from '@/components/language';
import Link from 'next/link';
import { getDashboardData } from '@/lib/data/admin';

function MetricIcon({ kind }: { kind: string }) { return <span aria-hidden="true">{kind === 'alert' ? '!' : kind === 'inbox' ? '□' : kind === 'send' ? '↗' : '▣'}</span>; }

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
          <div className="eyebrow"><T>ADMIN</T></div>
          <h1 className="title"><T>Dashboard</T></h1>
          <div className="muted"><T>Procurement activity and items requiring attention.</T></div>
        </div>
      </header>

      <section className="cards">
        {[
          ['Needs Attention', data.needsAttention, 'alert'],
          ['Open Inquiries', data.openInquiries, 'inbox'],
          ['Pending RFQs', data.pendingRfqs, 'send'],
          ['Quotes Awaiting Approval', data.quotesAwaitingApproval, 'receipt'],
        ].map(([labelText, value, iconKind]) => (
          <div className="card dashboard-kpi-card" key={String(labelText)}>
            <div className="dashboard-kpi-top"><span className="dashboard-kpi-icon"><MetricIcon kind={String(iconKind)} /></span><span className="muted"><T>{labelText}</T></span></div>
            <div className="kpi">{value}</div>
            <div className="eyebrow"><T>Current</T></div>
          </div>
        ))}
      </section>

      <section className="section">
        <div className="section-head">
          <h2><T>Recent Activity</T></h2>
        </div>
        <div className="table">
          <div className="row header">
            <div><T>Event</T></div><div><T>Actor</T></div><div><T>Time</T></div><div><T>Inquiry</T></div>
          </div>
          {data.recentActivity.length === 0 ? (
            <div className="empty"><T>No activity yet.</T></div>
          ) : data.recentActivity.map((item) => (
            <div className="row" key={item.id}>
              <div><T>{label(item.eventType)}</T></div>
              <div><span className="badge"><T>{label(item.actorType)}</T></span></div>
              <div><DateText value={item.createdAt}/></div>
              <Link className="muted dashboard-inquiry-link" href={`/inquiries/${item.inquiryId}`}>{item.inquiryId.slice(0, 8)}…</Link>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
