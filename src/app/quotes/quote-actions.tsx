'use client';
import {T,useI18n} from '@/components/language';
import {useRouter} from 'next/navigation';

import { useState } from 'react';
import { approveCustomerQuoteAction, requestQuoteApprovalAction } from '@/app/actions';

export function QuoteActions({ id, status }: { id: string; status: string }) {
  const {t}=useI18n();
  const router=useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<unknown>, message: string) {
    if (!window.confirm(t(message))) return;
    setLoading(true);
    setError('');
    try { await action(); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setLoading(false); }
  }

  if (status === 'draft') {
    return <div><button className="secondary-button" disabled={loading} onClick={() => run(() => requestQuoteApprovalAction(id), 'Submit this quote for approval?')}><T>{loading ? 'Submitting…' : 'Request approval'}</T></button>{error&&<div className="error-inline" role="alert"><T>{error}</T></div>}</div>;
  }

  if (status === 'pending_approval') {
    return <div><button className="primary-button" disabled={loading} onClick={() => run(() => approveCustomerQuoteAction(id), 'Approve and send this quote to the customer?')}><T>{loading ? 'Approving…' : 'Approve & Send'}</T></button>{error&&<div className="error-inline" role="alert"><T>{error}</T></div>}</div>;
  }

  return <span className="muted"><T>No action</T></span>;
}
