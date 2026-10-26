'use client';

import {T,Localized,DateText,useI18n} from '@/components/language';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Bell, Eye, Loader2, Mail, Ban, X } from 'lucide-react';
import { toast } from 'sonner';
import { cancelRfqAction } from './actions';
import { markNotificationReadAction } from '@/app/notifications/actions';
import { RfqConversationModal, type RfqConversationMessage } from '@/components/rfq-conversation';

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
  customerRequest?: string | null;
  conversation?: RfqConversationMessage[];
  showCustomerConversation?: boolean;
};

export function RfqActions(props: Props) {
  const {t}=useI18n();
  const router = useRouter();
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason,setReason]=useState('');

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

  async function cancel() {
    setBusy(true);
    try {
      await cancelRfqAction(props.rfqId,reason);
      setCancelOpen(false);
      toast.success(t('RFQ cancelled'), {
        description: t(props.rfqCode + ' was cancelled. RFQ items and linked communication history are preserved.'),
      });
      router.refresh();
    } catch (error) {
      toast.error(t('Could not cancel RFQ'), {
        description: t(error instanceof Error ? error.message : 'Please try again.'),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="rfq-row-actions">
        {props.supplierNotification && (
          <Localized as="button" type="button" className={`icon-button rfq-notification-button${!props.supplierNotification.read_at ? ' is-unread' : ''}`} onClick={() => void openSupplierNotification()} title="Supplier update" aria-label={`Supplier update for ${props.rfqCode}`}>
            <Bell size={16} />
            {!props.supplierNotification.read_at && <span className="rfq-notification-dot" aria-hidden="true" />}
          </Localized>
        )}
        <Localized as="button" type="button" className="icon-button" onClick={() => setConversationOpen(true)} title="View RFQ conversation" aria-label={'Preview ' + props.rfqCode}>
          <Eye size={16} />
        </Localized>
        <Localized as="button" type="button" disabled={props.status === 'cancelled'} className="icon-button icon-button-danger" onClick={() => setCancelOpen(true)} title="Cancel RFQ" aria-label={'Cancel ' + props.rfqCode}>
          <Ban size={16} />
        </Localized>
      </div>

      {notificationOpen && typeof document !== 'undefined' && createPortal(
        <div className="arat-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setNotificationOpen(false); }}>
          <div className="rfq-notification-dialog" role="dialog" aria-modal="true" aria-labelledby={`rfq-notification-title-${props.rfqId}`}>
            <div className="rfq-preview-head">
              <div>
                <div className="eyebrow"><T>SUPPLIER UPDATE</T></div>
                <h2 id={`rfq-notification-title-${props.rfqId}`}>{props.rfqCode}</h2>
                <div className="muted">{props.supplier}</div>
              </div>
              <Localized as="button" type="button" className="arat-dialog-close" onClick={() => setNotificationOpen(false)} aria-label="Close"><span aria-hidden="true">×</span></Localized>
            </div>

            {props.supplierNotification && (
              <div className="rfq-notification-summary">
                <div className="rfq-notification-summary-head"><Bell size={15} /><strong>{props.supplierNotification.title}</strong></div>
                <p>{props.supplierNotification.message}</p>
                <div className="muted"><DateText value={props.supplierNotification.created_at} format="datetime"/></div>
              </div>
            )}

            {props.supplierReply && (
              <div className="rfq-notification-email">
                <div className="rfq-notification-summary-head"><Mail size={15} /><strong><T>Supplier email</T></strong></div>
                <div className="muted"><DateText value={props.supplierReply.received_at ?? props.supplierNotification?.created_at ?? props.createdAt} format="datetime"/></div>
                <div className="rfq-notification-email-subject">{props.supplierReply.subject ||<T>{'(No subject)'}</T>}</div>
                <div className="rfq-notification-email-body">{props.supplierReply.body ||<T>{'No message body recorded.'}</T>}</div>
              </div>
            )}

            {!props.supplierNotification && !props.supplierReply && (
              <div className="empty"><T>No supplier update is available for this RFQ.</T></div>
            )}
          </div>
        </div>,
        document.body
      )}

      {conversationOpen && typeof document !== 'undefined' && createPortal(
        <RfqConversationModal
          rfqCode={props.rfqCode}
          supplier={props.supplier}
          customerRequest={props.customerRequest}
          messages={props.conversation ?? []}
          showCustomer={props.showCustomerConversation !== false}
          onClose={() => setConversationOpen(false)}
        />,
        document.body
      )}

      {cancelOpen && typeof document !== 'undefined' && createPortal(
        <div className="arat-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCancelOpen(false); }}>
          <div className="arat-dialog" role="dialog" aria-modal="true" aria-labelledby="rfq-cancel-title">
            <div className="arat-dialog-icon"><Ban size={18} /></div>
            <Localized as="button" type="button" className="arat-dialog-close" onClick={() => setCancelOpen(false)} disabled={busy} aria-label="Close"><X size={17} /></Localized>
            <h2 id="rfq-cancel-title"><T>Cancel RFQ?</T></h2>
            <p>
              <strong>{props.rfqCode}</strong><T> will be cancelled. Its items and linked email history remain available.
              </T><T>{props.status === 'sent' ? ' This does not recall an email that was already sent.' : ''}</T>
            </p>
            <label><T>Cancellation reason</T><textarea className="rfq-cancel-reason" value={reason} onChange={event=>setReason(event.target.value)} minLength={3} maxLength={1000} disabled={busy}/></label><div className="arat-dialog-actions">
              <button type="button" className="secondary-button" onClick={() => setCancelOpen(false)} disabled={busy}><T>Keep RFQ</T></button>
              <button type="button" className="arat-danger-button" onClick={cancel} disabled={busy || reason.trim().length < 3}>
                {busy ? <Loader2 size={15} className="arat-spin" /> : <Ban size={15} />}
                <T>{busy ? 'Cancelling…' : 'Cancel RFQ'}</T>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
