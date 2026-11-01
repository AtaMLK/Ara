'use client';

import { useState } from 'react';
import { approveCustomerQuoteAction, requestQuoteApprovalAction } from '@/app/actions';

export function QuoteActions({ id, status }: { id: string; status: string }) {
  const [error,setError]=useState('');
  const [loading, setLoading] = useState(false);

  async function run(action: () => Promise<unknown>, message: string) {
    if (!window.confirm(message)) return;
    setLoading(true);setError('');
    try { await action(); window.location.reload(); }
    catch(error) {setError(error instanceof Error?error.message:'Could not complete this action.');setLoading(false);}
  }

  if (status === 'draft') {
    return <div className="quote-send-action"><button className="secondary-button" disabled={loading} onClick={() => run(() => requestQuoteApprovalAction(id), 'Submit this quote for approval?')}>{loading ? 'Submitting…' : 'Request approval'}</button>{error&&<p className="error-box" role="alert">{error}</p>}</div>;
  }

  if (status === 'pending_approval') {
    return <div className="quote-send-action"><button className="primary-button" disabled={loading} onClick={() => run(() => approveCustomerQuoteAction(id), 'Send this approved quotation to the customer by email?')}>{loading ? 'Approving…' : 'Approve & Send'}</button>{error&&<p className="error-box" role="alert">{error}</p>}</div>;
  }

  return <span className="muted">No action</span>;
}
