'use client';

import { useTransition } from 'react';
import { reviewCustomerQuoteRevisionAction } from '@/app/actions';

export default function RevisionRequestActions({ requestId }: { requestId: string }) {
  const [pending, startTransition] = useTransition();

  const review = (decision: 'approve' | 'reject') => {
    startTransition(async () => {
      await reviewCustomerQuoteRevisionAction({ requestId, decision });
      window.location.reload();
    });
  };

  return (
    <div className="action-cell">
      <button className="primary-button" disabled={pending} onClick={() => review('approve')}>Approve & create revision</button>
      <button className="secondary-button" disabled={pending} onClick={() => review('reject')}>Reject</button>
    </div>
  );
}
