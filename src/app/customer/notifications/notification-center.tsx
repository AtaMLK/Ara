'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, X } from 'lucide-react';
import AnswerClarificationForm from '@/app/customer/inquiries/[id]/answer-form';
import { markCustomerNotificationReadAction } from './actions';

export type CustomerNotificationItem = {
  id: string;
  title: string;
  message: string;
  category: string;
  priority: string;
  record_type: string | null;
  record_id: string | null;
  action_url: string | null;
  read_at: string | null;
  created_at: string;
};

export type CustomerNotificationDetail = {
  clarification?: { id: string; question: string; status: string } | null;
  quote?: {
    id: string;
    reference: string;
    revision_number: number;
    status: string;
    currency: string;
    valid_until: string | null;
    subject: string | null;
    body: string | null;
    items: Array<{
      id: string;
      quantity: number;
      unit_price: number;
      total: number;
      product_name: string | null;
      model_part_number: string | null;
    }>;
  } | null;
};

function tone(item: CustomerNotificationItem) {
  const text = (item.title + ' ' + item.message).toLowerCase();
  if (item.record_type === 'customer_quote' || text.includes('quotation sent') || text.includes('quote')) return 'success';
  if (text.includes('could not') || text.includes('cannot') || text.includes('reject') || text.includes('unfortunately')) return 'danger';
  if (item.record_type === 'clarification' || text.includes('information is needed') || text.includes('clarification')) return 'warning';
  return 'info';
}

export default function CustomerNotificationCenter({
  items,
  details,
}: {
  items: CustomerNotificationItem[];
  details: Record<string, CustomerNotificationDetail>;
}) {
  const [selected, setSelected] = useState<CustomerNotificationItem | null>(null);

  async function open(item: CustomerNotificationItem) {
    setSelected(item);
    if (!item.read_at) {
      try { await markCustomerNotificationReadAction(item.id); } catch {}
    }
  }

  const selectedDetail = selected ? details[selected.id] : undefined;
  const selectedTone = selected ? tone(selected) : 'info';

  return (
    <>
      <button
        type="button"
        className="customer-notification-bell"
        onClick={() => setSelected(items.find((item) => !item.read_at) ?? items[0] ?? null)}
        aria-label={items.some((item) => !item.read_at) ? 'Open unread notifications' : 'Open notifications'}
        title="Notifications"
      >
        <Bell size={17} /><span>Notifications</span>
        {items.some((item) => !item.read_at) && <span className="customer-notification-dot" />}
      </button>

      {selected && typeof document !== 'undefined' && createPortal(
        <div className="customer-notification-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <div className="customer-notification-modal" role="dialog" aria-modal="true" aria-labelledby="customer-notification-modal-title">
            <header className="customer-notification-modal-head">
              <div>
                <div className="eyebrow">NOTIFICATION</div>
                <h2 id="customer-notification-modal-title">{selected.title}</h2>
                <div className="muted">{new Date(selected.created_at).toLocaleString('en-GB')}</div>
              </div>
              <button type="button" className="arat-dialog-close" onClick={() => setSelected(null)} aria-label="Close"><X size={17} /></button>
            </header>

            <div className="customer-notification-modal-body">
              <div className={`customer-notification-tone customer-notification-tone--${selectedTone}`}>
                {selectedTone === 'warning' ? 'Additional information required' : selectedTone === 'danger' ? 'Request update' : selectedTone === 'success' ? 'Quotation available' : 'Request update'}
              </div>

              {selectedTone === 'warning' && selectedDetail?.clarification ? (
                <>
                  <div className="customer-notification-question">
                    <strong>We need the following information to continue:</strong>
                    <p>{selectedDetail.clarification.question}</p>
                  </div>
                  {selectedDetail.clarification.status === 'sent' && selected.action_url && (
                    <AnswerClarificationForm
                      inquiryId={selected.action_url.split('/customer/inquiries/')[1]?.split('/')[0] ?? ''}
                      clarificationId={selectedDetail.clarification.id}
                    />
                  )}
                </>
              ) : selectedTone === 'success' && selectedDetail?.quote ? (
                <div className="customer-notification-quote">
                  <div className="customer-notification-quote-head">
                    <div><strong>{selectedDetail.quote.reference}</strong><span>Revision R{selectedDetail.quote.revision_number}</span></div>
                    <span>{selectedDetail.quote.currency}</span>
                  </div>
                  {selectedDetail.quote.subject && <h3>{selectedDetail.quote.subject}</h3>}
                  {selectedDetail.quote.body && <p className="detail-text">{selectedDetail.quote.body}</p>}
                  <div className="customer-notification-quote-table">
                    <div className="customer-notification-quote-row customer-notification-quote-row--head"><span>Item</span><span>Qty</span><span>Unit</span><span>Total</span></div>
                    {selectedDetail.quote.items.map((item) => (
                      <div className="customer-notification-quote-row" key={item.id}>
                        <span><strong>{item.product_name || item.model_part_number || 'Quoted item'}</strong>{item.model_part_number && item.product_name && <small>{item.model_part_number}</small>}</span>
                        <span>{item.quantity}</span>
                        <span>{Number(item.unit_price).toFixed(2)} {selectedDetail.quote!.currency}</span>
                        <span>{Number(item.total).toFixed(2)} {selectedDetail.quote!.currency}</span>
                      </div>
                    ))}
                    <div className="customer-notification-quote-total"><span>Total</span><strong>{selectedDetail.quote.items.reduce((sum, item) => sum + Number(item.total || 0), 0).toFixed(2)} {selectedDetail.quote.currency}</strong></div>
                  </div>
                  {selectedDetail.quote.valid_until && <div className="muted">Valid until: {selectedDetail.quote.valid_until}</div>}
                </div>
              ) : (
                <div className="customer-notification-message">
                  <p>{selected.message}</p>
                  {selectedTone === 'danger' && <p className="muted">We are sorry for the inconvenience. We will review the request and update you if another option becomes available.</p>}
                </div>
              )}
            </div>

            <footer className="customer-notification-modal-foot">
              {selected.action_url && selectedTone !== 'warning' && selectedTone !== 'success' && (
                <a className="secondary-button" href={selected.action_url}>Open request</a>
              )}
              {selectedTone === 'success' && selectedDetail?.quote && <a className="secondary-button" href={selected.action_url ?? '#'}>Open full quotation</a>}
              <button type="button" className="primary-button" onClick={() => setSelected(null)}><Check size={15} /> Close</button>
            </footer>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
