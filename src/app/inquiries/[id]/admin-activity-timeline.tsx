'use client';

import { useState } from 'react';

type Event = {
  id: string;
  event_type: string;
  actor_type: string;
  agent_id?: string | null;
  created_at: string;
};

function label(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminActivityTimeline({ events }: { events: Event[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? events : events.slice(0, 3);
  return (
    <div className="activity-timeline">
      <div className="timeline">
        {visible.length === 0 ? <div className="empty">No timeline events.</div> : visible.map((event) => (
          <div className="list-item timeline-list-item" key={event.id}>
            <div>
              <strong>{label(event.event_type)}</strong>
              <div className="muted">{label(event.actor_type)}{event.agent_id ? ' · ' + event.agent_id : ''}</div>
            </div>
            <span className="muted">{new Date(event.created_at).toLocaleString('en-GB')}</span>
          </div>
        ))}
      </div>
      {events.length > 3 && (
        <button className="timeline-expand" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? 'Show latest 3 only' : 'View all activity · ' + events.length + ' events'}
        </button>
      )}
    </div>
  );
}
