'use client';

import { useState } from 'react';
import { approveRfqAction, sendRfqAction } from '@/app/actions';

export function ApproveRfqButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);
  async function approve() {
    if (!window.confirm('Approve this RFQ?')) return;
    setLoading(true);
    try { await approveRfqAction(id); window.location.reload(); }
    catch { setLoading(false); }
  }
  return <button className="primary-button" onClick={approve} disabled={loading}>{loading ? 'Approving…' : 'Approve'}</button>;
}

export function SendRfqButton({ id }: { id: string }) {
  const [loading, setLoading] = useState(false);
  async function send() {
    if (!window.confirm('Send this RFQ to the supplier now?')) return;
    setLoading(true);
    try { await sendRfqAction(id); window.location.reload(); }
    catch { setLoading(false); }
  }
  return <button className="secondary-button" onClick={send} disabled={loading}>{loading ? 'Sending…' : 'Send email'}</button>;
}
