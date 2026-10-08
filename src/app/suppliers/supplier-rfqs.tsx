'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, X } from 'lucide-react';
import { RfqActions } from '@/app/rfqs/rfq-actions';

type Rfq = {
  id: string;
  rfq_code: string | null;
  status: string;
  subject: string | null;
  body: string | null;
  recipient_email: string | null;
  created_at: string;
  sent_at: string | null;
  conversation?: Array<{
    id: string;
    rfq_id?: string | null;
    supplier_id?: string | null;
    direction: 'incoming' | 'outgoing';
    subject: string | null;
    body: string | null;
    received_at?: string | null;
    sent_at?: string | null;
    created_at: string;
    metadata?: unknown;
  }>;
};

export function SupplierRfqButton({ supplierName, rfqs }: { supplierName: string; rfqs: Rfq[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className="supplier-rfq-trigger" onClick={() => setOpen(true)} title="View supplier RFQs">
        <Eye size={15} />
        <span>RFQs</span>
        <b>{rfqs.length}</b>
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div className="arat-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="supplier-rfq-dialog" role="dialog" aria-modal="true" aria-labelledby="supplier-rfq-title">
            <div className="supplier-rfq-head">
              <div>
                <div className="eyebrow">SUPPLIER RFQ HISTORY</div>
                <h2 id="supplier-rfq-title">{supplierName}</h2>
                <div className="muted">{rfqs.length} RFQ{rfqs.length === 1 ? '' : 's'} associated with this supplier</div>
              </div>
              <button type="button" className="arat-dialog-close" onClick={() => setOpen(false)} aria-label="Close"><X size={17} /></button>
            </div>

            <div className="supplier-rfq-list">
              {rfqs.length === 0 ? (
                <div className="empty">No RFQs have been created for this supplier.</div>
              ) : (
                rfqs.map((rfq) => (
                  <div className="supplier-rfq-item" key={rfq.id}>
                    <div className="supplier-rfq-main">
                      <strong>{rfq.rfq_code || 'RFQ'}</strong>
                      <div className="muted">{rfq.subject || 'Quotation Request'}</div>
                      <small>
                        {new Date(rfq.created_at).toLocaleDateString('en-GB')}
                        {rfq.sent_at ? ' · Sent ' + new Date(rfq.sent_at).toLocaleDateString('en-GB') : ''}
                      </small>
                    </div>
                    <div className="supplier-rfq-meta">
                      <span className="badge">{rfq.status.replaceAll('_', ' ')}</span>
                      <RfqActions
                        rfqId={rfq.id}
                        rfqCode={rfq.rfq_code || 'RFQ'}
                        subject={rfq.subject}
                        body={rfq.body}
                        supplier={supplierName}
                        recipient={rfq.recipient_email}
                        status={rfq.status}
                        createdAt={rfq.created_at}
                        sentAt={rfq.sent_at}
                        conversation={rfq.conversation ?? []}
                        showCustomerConversation={false}
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
