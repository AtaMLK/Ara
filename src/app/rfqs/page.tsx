import { listRfqs } from '@/lib/data/admin';
import { ApproveRfqButton, SendRfqButton } from './approve-button';
import { RfqActions } from './rfq-actions';

type Props = { searchParams: Promise<{ q?: string; status?: string }> };

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function RfqsPage({ searchParams }: Props) {
  const params = await searchParams;
  const items = await listRfqs(params.q, params.status);

  return (
    <>
      <header className="topbar">
        <div>
          <div className="eyebrow">PROCUREMENT</div>
          <h1 className="title">RFQs</h1>
          <div className="muted">Supplier quotation requests and outgoing email history</div>
        </div>
      </header>

      <form className="filters">
        <input name="q" defaultValue={params.q} placeholder="Search RFQ code or subject…" />
        <select name="status" defaultValue={params.status ?? 'all'}>
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="pending_approval">Pending Approval</option>
          <option value="approved">Approved</option>
          <option value="sent">Sent</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button className="secondary-button">Filter</button>
      </form>

      <section className="section">
        <div className="table rfq-table">
          <div className="row header">
            <div>RFQ</div>
            <div>Supplier</div>
            <div>Status</div>
            <div>Created</div>
            <div>Actions</div>
          </div>

          {items.length === 0 ? (
            <div className="empty">No RFQs found.</div>
          ) : items.map((item) => (
            <div className="row rfq-row" key={item.id}>
              <div className="rfq-main-cell">
                <strong className="rfq-code">{item.rfq_code || 'RFQ —'}</strong>
                <div className="muted rfq-subject">{item.subject || 'Quotation Request'}</div>
                <div className="rfq-inquiry">{item.inquiries?.reference ?? 'No inquiry reference'}</div>
              </div>

              <div>
                <strong>{item.suppliers?.legal_name ?? '—'}</strong>
                {item.recipient_email && <div className="muted">{item.recipient_email}</div>}
              </div>

              <div>
                <span className="badge">{label(item.status)}</span>
              </div>

              <div className="rfq-date">
                <span>{new Date(item.created_at).toLocaleDateString('en-GB')}</span>
                {item.sent_at && <small>Sent {new Date(item.sent_at).toLocaleDateString('en-GB')}</small>}
              </div>

              <div className="rfq-actions-cell">
                <RfqActions
                  rfqId={item.id}
                  rfqCode={item.rfq_code || 'RFQ'}
                  subject={item.subject}
                  body={item.body}
                  supplier={item.suppliers?.legal_name ?? 'Supplier'}
                  recipient={item.recipient_email}
                  status={item.status}
                  createdAt={item.created_at}
                  sentAt={item.sent_at}
                />
                {item.status === 'pending_approval' && <ApproveRfqButton id={item.id} />}
                {item.status === 'approved' && <SendRfqButton id={item.id} />}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
