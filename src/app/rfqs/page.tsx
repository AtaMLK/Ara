import {T,Localized,DateText} from '@/components/language';
import {readableRequest} from '@/lib/ui/inquiry-items';
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
          <div className="eyebrow"><T>PROCUREMENT</T></div>
          <h1 className="title"><T>RFQs</T></h1>
          <div className="muted"><T>Supplier quotation requests and outgoing email history</T></div>
        </div>
      </header>

      <form className="filters">
        <Localized as="input" name="q" defaultValue={params.q} placeholder="Search RFQ code or subject…" />
        <select name="status" defaultValue={params.status ?? 'all'}>
          <option value="all"><T>All statuses</T></option><option value="draft"><T>Draft</T></option><option value="pending_approval"><T>Pending Approval</T></option><option value="approved"><T>Approved</T></option><option value="sent"><T>Sent</T></option><option value="completed"><T>Completed</T></option><option value="cancelled"><T>Cancelled</T></option>
        </select>
        <button className="secondary-button"><T>Filter</T></button>
      </form>

      <section className="section">
        <div className="table rfq-table">
          <div className="row header">
            <div><T>RFQ</T></div><div><T>Supplier</T></div><div><T>Status</T></div><div><T>Created</T></div><div><T>Actions</T></div>
          </div>

          {items.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon" aria-hidden="true">↗</div>
              <strong><T>No RFQs found</T></strong>
              <span><T>Supplier quotation requests will appear here after an RFQ is created.</T></span>
            </div>
          ) : items.map((item) => (
            <div className="row rfq-row" key={item.id}>
              <div className="rfq-main-cell">
                <strong className="rfq-code">{item.rfq_code ||<T>{'RFQ —'}</T>}</strong>
                <div className="muted rfq-subject">{item.subject ||<T>{'Quotation Request'}</T>}</div>
                <div className="rfq-inquiry">{item.inquiries?.reference ?? 'No inquiry reference'}</div>
              </div>
              <div>
                <strong>{item.suppliers?.legal_name ?? '—'}</strong>
                {item.recipient_email && <div className="muted">{item.recipient_email}</div>}
              </div>
              <div><span className="badge"><T>{label(item.status)}</T></span></div>
              <div className="rfq-date"><span><DateText value={item.created_at} format="date"/></span>{item.sent_at && <small><T>Sent </T><DateText value={item.sent_at} format="date"/></small>}</div>
              <div className="rfq-actions-cell">
                <RfqActions
                  rfqId={item.id}
                  rfqCode={item.rfq_code ||'RFQ'}
                  subject={item.subject}
                  body={item.body}
                  supplier={item.suppliers?.legal_name ?? 'Supplier'}
                  recipient={item.recipient_email}
                  status={item.status}
                  createdAt={item.created_at}
                  sentAt={item.sent_at}
                  customerRequest={readableRequest(item.inquiries?.original_customer_text)}
                  conversation={item.conversation}
                  supplierNotification={item.supplierNotification}
                  supplierReply={item.supplierReply}
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
