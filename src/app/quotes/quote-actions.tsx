'use client';

import { useState } from 'react';
import { approveCustomerQuoteAction, requestQuoteApprovalAction } from '@/app/actions';

export function QuoteActions({ id, status }: { id: string; status: string }) {
  const [loading, setLoading] = useState(false);

  async function run(action: () => Promise<unknown>, message: string) {
    if (!window.confirm(message)) return;
    setLoading(true);
    try { await action(); window.location.reload(); }
    catch { setLoading(false); }
  }

  if (status === 'draft') {
    return <button className="secondary-button" disabled={loading} onClick={() => run(() => requestQuoteApprovalAction(id), 'Submit this quote for approval?')}>{loading ? 'Submitting…' : 'Request approval'}</button>;
  }

  if (status === 'pending_approval') {
    return <button className="primary-button" disabled={loading} onClick={() => run(() => approveCustomerQuoteAction(id), 'Approve and mark this quote as sent?')}>{loading ? 'Approving…' : 'Approve & Send'}</button>;
  }

  return <span className="muted">No action</span>;
}
