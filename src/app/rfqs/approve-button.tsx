'use client';

import { useState } from 'react';
import { approveRfqAction } from '@/app/actions';

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
