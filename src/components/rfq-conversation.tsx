'use client';

import {T,Localized,DateText} from '@/components/language';
import { useState } from 'react';
import { Mail, X } from 'lucide-react';
import {CustomerRequestMessage} from './customer-request-message';

export type RfqConversationMessage = {
  id: string;
  direction: 'incoming' | 'outgoing';
  subject: string | null;
  body: string | null;
  created_at: string;
  received_at?: string | null;
  sent_at?: string | null;
  metadata?: unknown;
};

function metaOf(message: RfqConversationMessage) {
  return message.metadata && typeof message.metadata === 'object' && !Array.isArray(message.metadata)
    ? message.metadata as Record<string, unknown>
    : {};
}

function titleOf(message: RfqConversationMessage) {
  const type = typeof metaOf(message).type === 'string' ? metaOf(message).type : '';
  if (type === 'supplier_rfq_reply') return 'Supplier Response';
  if (type === 'supplier_clarification_to_customer') return 'Clarification sent to Customer';
  if (type === 'customer_clarification_reply') return 'Customer clarification reply';
  if (type === 'customer_quote') return 'Quotation sent to Customer';
  if (message.direction === 'outgoing') return 'Message sent to Supplier';
  return 'Incoming message';
}

function bodyText(value: string | null) {
  if (!value) return 'No message body recorded.';
  return value
    .replace(/<br\s*\/?>(?=\s*)/gi, '\n')
    .replace(/<\/(p|div)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function toneOf(message: RfqConversationMessage) {
  const type = typeof metaOf(message).type === 'string' ? metaOf(message).type : '';
  if (type === 'supplier_rfq_reply') return 'supplier';
  if (type === 'customer_clarification_reply') return 'customer';
  return message.direction === 'outgoing' ? 'outgoing' : 'incoming';
}

export function RfqConversationModal({
  rfqCode,
  supplier,
  customerRequest,
  messages,
  showCustomer = true,
  onClose,
}: {
  rfqCode: string;
  supplier: string;
  customerRequest?: string | null;
  messages: RfqConversationMessage[];
  showCustomer?: boolean;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(messages[0]?.id ?? null);
  const sorted = [...messages].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  return (
    <div className="arat-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="rfq-conversation-dialog" role="dialog" aria-modal="true" aria-labelledby="rfq-conversation-title">
        <header className="rfq-conversation-head">
          <div>
            <div className="eyebrow"><T>RFQ CONVERSATION</T></div>
            <h2 id="rfq-conversation-title">{rfqCode}</h2>
            <div className="muted">{supplier}</div>
          </div>
          <Localized as="button" type="button" className="arat-dialog-close" onClick={onClose} aria-label="Close"><X size={17} /></Localized>
        </header>

        <div className="rfq-conversation-body">
          {showCustomer && customerRequest && (
            <article className="rfq-conversation-item rfq-conversation-item--customer">
              <div className="rfq-conversation-marker" />
              <div className="rfq-conversation-card">
                <div className="rfq-conversation-label"><T>Customer Request</T></div>
                <div className="rfq-conversation-time"><T>Customer message and submitted details</T></div>
                <div className="rfq-conversation-content"><CustomerRequestMessage text={customerRequest}/></div>
              </div>
            </article>
          )}

          {sorted.map((message) => {
            const title = titleOf(message);
            const tone = toneOf(message);
            const open = expanded === message.id;
            const when = message.received_at ?? message.sent_at ?? message.created_at;
            return (
              <article className={`rfq-conversation-item rfq-conversation-item--${tone}`} key={message.id}>
                <div className="rfq-conversation-marker" />
                <button type="button" className="rfq-conversation-card rfq-conversation-toggle" onClick={() => setExpanded(open ? null : message.id)}>
                  <div className="rfq-conversation-card-head">
                    <div>
                      <div className="rfq-conversation-label"><Mail size={14} /><T>{title}</T></div>
                      <div className="rfq-conversation-subject">{message.subject ||<T>{'(No subject)'}</T>}</div>
                    </div>
                    <span className="muted"><DateText value={when} format="datetime"/></span>
                  </div>
                  {open && <div className="rfq-conversation-content">{bodyText(message.body)}</div>}
                  {!open && <div className="rfq-conversation-preview">{bodyText(message.body).replace(/\s+/g, ' ').slice(0, 180)}</div>}
                </button>
              </article>
            );
          })}

          {!customerRequest && sorted.length === 0 && <div className="empty"><T>No conversation messages are available yet.</T></div>}
        </div>
      </div>
    </div>
  );
}
