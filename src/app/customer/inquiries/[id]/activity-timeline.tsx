'use client';

import { useState } from 'react';

type TimelineEvent = {
  id: string;
  event_type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

const labels: Record<string, string> = {
  customer_inquiry_created: 'Request submitted',
  customer_file_uploaded: 'Attachment uploaded',
  clarification_sent: 'A question is waiting for your answer',
  clarification_answer_applied: 'Your answer was received',
  document_processed: 'Attachment processed',
  workflow_document_waiting_for_ai_provider: 'AI processing is waiting for setup',
  workflow_document_completed: 'Document processing completed',
  customer_quote_sent: 'Quotation sent',
};

const statusLabels: Record<string, string> = {
  processing: 'Request is being processed',
  open: 'Request is ready for review',
  clarification_required: 'More information is required',
  researching: 'Supplier research is in progress',
  rfq: 'Supplier quotation requests are in progress',
  quoting: 'Your quotation is being prepared',
  converted: 'Request completed',
  no_suitable_supplier: 'No suitable supplier was found',
  closed: 'Request closed',
};

function getLabel(event: TimelineEvent) {
  if (event.event_type === 'customer_status_changed') {
    const status = typeof event.metadata?.status === 'string' ? event.metadata.status : '';
    return statusLabels[status] ?? 'Request status updated';
  }
  return labels[event.event_type] ?? 'Request updated';
}

function getTone(event: TimelineEvent) {
  const status = typeof event.metadata?.status === 'string' ? event.metadata.status : '';
  if (['converted', 'customer_quote_sent', 'clarification_answer_applied'].includes(event.event_type) || status === 'converted') return 'success';
  if (['clarification_sent', 'workflow_document_waiting_for_ai_provider'].includes(event.event_type) || status === 'clarification_required') return 'warning';
  if (['closed', 'no_suitable_supplier'].includes(status)) return 'neutral';
  return 'info';
}

export default function ActivityTimeline({ events }: { events: TimelineEvent[] }) {
  const [expanded, setExpanded] = useState(false);
  const visibleEvents = expanded ? [...events].reverse() : [...events].slice(-3).reverse();
  const hasOlder = events.length > 3;

  return (
    <div className="activity-timeline">
      <div className="timeline">
        {visibleEvents.length === 0 ? (
          <div className="empty">No activity yet.</div>
        ) : (
          visibleEvents.map((event) => (
            <button
              className="timeline-item timeline-button"
              key={event.id}
              type="button"
              onClick={() => setExpanded(true)}
              title="Show activity details"
            >
              <span className={`timeline-dot timeline-dot--${getTone(event)}`} />
              <span className="timeline-content">
                <strong>{getLabel(event)}</strong>
                <span className="muted">{new Date(event.created_at).toLocaleString()}</span>
                {expanded && (
                  <span className="timeline-detail">
                    {event.event_type.replaceAll('_', ' ')}
                    {typeof event.metadata?.file_name === 'string' ? ` · ${event.metadata.file_name}` : ''}
                    {typeof event.metadata?.status === 'string' ? ` · ${event.metadata.status.replaceAll('_', ' ')}` : ''}
                  </span>
                )}
              </span>
              <span className="timeline-chevron" aria-hidden="true">›</span>
            </button>
          ))
        )}
      </div>
      {hasOlder && (
        <button
          className="timeline-expand"
          type="button"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Show latest 3 only' : `View all activity · ${events.length} events`}
        </button>
      )}
    </div>
  );
}
