'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Bell, Eye, Loader2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { deleteRfqAction } from './actions';
import { markNotificationReadAction } from '@/app/notifications/actions';

type Props = {
  rfqId: string;
  rfqCode: string;
  subject: string | null;
  body: string | null;
  supplier: string;
  recipient: string | null;
  status: string;
  createdAt: string;
  sentAt: string | null;
  supplierNotification?: {
    id: string;
    title: string;
    message: string;
    priority: string;
    read_at: string | null;
    created_at: string;
  } | null;
  supplierReply?: {
    subject: string | null;
    body: string | null;
    received_at: string | null;
    metadata: unknown;
  } | null;
};

export function RfqActions(props: Props) {
  const router = useRouter();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function openSupplierNotification() {
    setNotificationOpen(true);
    if (props.supplierNotification && !props.supplierNotification.read_at) {
      try {
        await markNotificationReadAction(props.supplierNotification.id);
        router.refresh();
      } catch {
        // The notification is still useful even if marking it read fails.
      }
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteRfqAction(props.rfqId);
      setDeleteOpen(false);
      toast.success('RFQ deleted', {
        description: props.rfqCode + ' was removed from the RFQ list. Communication history is preserved.',
      });
      router.refresh();
    } catch (error) {
      toast.error('Could not delete RFQ', {
        description: error instanceof Error ? error.message : 'Please try again.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="rfq-row-actions">
        {props.supplierNotification && (
          <button type="button" className={`icon-button rfq-notification-button${!props.supplierNotification.read_at ? ' is-unread' : ''}`} onClick={() => void openSupplierNotification()} title="Supplier update" aria-label={`Supplier update for ${props.rfqCode}`}>
            <Bell size={16} />
            {!props.supplierNotification.read_at && <span className="rfq-notification-dot" aria-hidden="true" />}
          </button>
        )}
        <button type="button" className="icon-button" onClick={() => setPreviewOpen(true)} title="Preview RFQ" aria-label={'Preview ' + props.rfqCode}>
          <Eye size={16} />
        </button>
        <button type="button" className="icon-button icon-button-danger" onClick={() => setDeleteOpen(true)} title="Delete RFQ" aria-label={'Delete ' + props.rfqCode}>
          <Trash2 size={16} />
        </button>
      </div>

      {notificationOpen && typeof document !== 'undefined' && createPortal(
        <div className="arat-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setNotificationOpen(false); }}>
          <div className="rfq-notification-dialog" role="dialog" aria-modal="true" aria-labelledby={`rfq-notification-title-${props.rfqId}`}>
            <div className="rfq-preview-head">
              <div>
                <div className="eyebrow">SUPPLIER UPDATE</div>
                <h2 id={`rfq-notification-title-${props.rfqId}`}>{props.rfqCode}</h2>
                <div className="muted">{props.supplier}</div>
              </div>
              <button type="button" className="arat-dialog-close" onClick={() => setNotificationOpen(false)} aria-label="Close"><span aria-hidden="true">×</span></button>
            </div>

            {props.supplierNotification && (
              <div className="rfq-notification-summary">
                <div className="rfq-notification-summary-head"><Bell size={15} /><strong>{props.supplierNotification.title}</strong></div>
                <p>{props.supplierNotification.message}</p>
                <div className="muted">{new Date(props.supplierNotification.created_at).toLocaleString('en-GB')}</div>
              </div>
            )}

            {props.supplierReply && (
              <div className="rfq-notification-email">
                <div className="rfq-notification-summary-head"><Mail size={15} /><strong>Supplier email</strong></div>
                <div className="muted">{new Date(props.supplierReply.received_at ?? props.supplierNotification?.created_at ?? Date.now()).toLocaleString('en-GB')}</div>
                <div className="rfq-notification-email-subject">{props.supplierReply.subject || '(No subject)'}</div>
                <div className="rfq-notification-email-body">{props.supplierReply.body || 'No message body recorded.'}</div>
              </div>
            )}

            {!props.supplierNotification && !props.supplierReply && (
              <div className="empty">No supplier update is available for this RFQ.</div>
            )}
          </div>
        </div>,
        document.body
      )}

      {previewOpen && typeof document !== 'undefined' && createPortal(
        <div className="arat-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}>
          <div className="rfq-preview-dialog" style={{ width: "min(920px, calc(100vw - 40px))", height: "min(760px, calc(100vh - 48px))", maxHeight: "none" }} role="dialog" aria-modal="true" aria-labelledby="rfq-preview-title">
            <div className="rfq-preview-head">
              <div>
                <div className="eyebrow">RFQ PREVIEW</div>
                <h2 id="rfq-preview-title">{props.rfqCode}</h2>
                <div className="muted">{props.supplier}</div>
              </div>
              <button type="button" className="arat-dialog-close" onClick={() => setPreviewOpen(false)} aria-label="Close preview"><X size={17} /></button>
            </div>

            <div className="rfq-preview-meta">
              <div><span>Recipient</span><strong>{props.recipient || '—'}</strong></div>
              <div><span>Status</span><strong>{props.status.replaceAll('_', ' ')}</strong></div>
              <div><span>Created</span><strong>{new Date(props.createdAt).toLocaleString('en-GB')}</strong></div>
              {props.sentAt && <div><span>Sent</span><strong>{new Date(props.sentAt).toLocaleString('en-GB')}</strong></div>}
            </div>

            <div className="rfq-preview-subject">
              <span>Subject</span>
              <strong>{props.subject || 'Quotation Request'}</strong>
            </div>

            <div className="rfq-preview-email">
              <div dangerouslySetInnerHTML={{ __html: props.body || '<p>No email content available.</p>' }} />
            </div>
          </div>
        </div>,
        document.body
      )}

      {deleteOpen && typeof document !== 'undefined' && createPortal(
        <div className="arat-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDeleteOpen(false); }}>
          <div className="arat-dialog" role="dialog" aria-modal="true" aria-labelledby="rfq-delete-title">
            <div className="arat-dialog-icon"><Trash2 size={18} /></div>
            <button type="button" className="arat-dialog-close" onClick={() => setDeleteOpen(false)} disabled={busy} aria-label="Close"><X size={17} /></button>
            <h2 id="rfq-delete-title">Delete RFQ?</h2>
            <p>
              <strong>{props.rfqCode}</strong> will be removed from the RFQ list. Email/communication history will be preserved separately.
              {props.status === 'sent' ? ' This does not recall an email that was already sent.' : ''}
            </p>
            <div className="arat-dialog-actions">
              <button type="button" className="secondary-button" onClick={() => setDeleteOpen(false)} disabled={busy}>Cancel</button>
              <button type="button" className="arat-danger-button" onClick={remove} disabled={busy}>
                {busy ? <Loader2 size={15} className="arat-spin" /> : <Trash2 size={15} />}
                {busy ? 'Deleting…' : 'Delete RFQ'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
