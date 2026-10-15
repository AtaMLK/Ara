'use client';
import {useRouter} from 'next/navigation';

import { useState } from 'react';
import { approveCustomerQuoteAction, requestQuoteApprovalAction } from '@/app/actions';

export function QuoteActions({ id, status }: { id: string; status: string }) {
  const router=useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<unknown>, message: string) {
    if (!window.confirm(message)) return;
    setLoading(true);
    setError('');
    try { await action(); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setLoading(false); }
  }

  if (status === 'draft') {
    return <div><button className="secondary-button" disabled={loading} onClick={() => run(() => requestQuoteApprovalAction(id), 'Submit this quote for approval?')}>{loading ? 'Submitting…' : 'Request approval'}</button>{error&&<div className="error-inline" role="alert">{error}</div>}</div>;
  }

  if (status === 'pending_approval') {
    return <div><button className="primary-button" disabled={loading} onClick={() => run(() => approveCustomerQuoteAction(id), 'Approve and send this quote to the customer?')}>{loading ? 'Approving…' : 'Approve & Send'}</button>{error&&<div className="error-inline" role="alert">{error}</div>}</div>;
  }

  return <span className="muted">No action</span>;
}
