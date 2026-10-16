'use client';

import {T,DateText} from '@/components/language';
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
        {visible.length === 0 ? <div className="empty"><T>No timeline events.</T></div> : visible.map((event) => (
          <div className="list-item timeline-list-item" key={event.id}>
            <div>
              <strong><T>{label(event.event_type)}</T></strong>
              <div className="muted"><T>{label(event.actor_type)}</T>{event.agent_id ? ' · ' + event.agent_id : ''}</div>
            </div>
            <span className="muted"><DateText value={event.created_at} format="datetime"/></span>
          </div>
        ))}
      </div>
      {events.length > 3 && (
        <button className="timeline-expand" type="button" onClick={() => setExpanded((value) => !value)}>
          <T>{expanded ? 'Show latest 3 only' : 'View all activity · ' + events.length + ' events'}</T>
        </button>
      )}
    </div>
  );
}
