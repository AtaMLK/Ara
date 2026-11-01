'use client';
import {displayText} from '@/lib/ui/display-text';

import { useState,useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { reviewCustomerQuoteRevisionAction } from '@/app/actions';

export default function RevisionRequestActions({ requestId }: { requestId: string }) {
  const router=useRouter();
  const [error,setError]=useState('');
  const [pending, startTransition] = useTransition();

  const review = (decision: 'approve' | 'reject') => {
    startTransition(async () => {
      setError('');
      try {
        const result=await reviewCustomerQuoteRevisionAction({ requestId, decision });
        if(result.newQuoteId)router.push('/quotes/'+result.newQuoteId);
        router.refresh();
      } catch(error){setError(error instanceof Error?error.message:'Could not review the request.');}
    });
  };

  return (
    <div className="revision-review-actions"><div className="action-cell">
      <button className="primary-button" disabled={pending} onClick={() => review('approve')}>Approve & create revision</button>
      <button className="secondary-button" disabled={pending} onClick={() => review('reject')}>Reject</button>
    </div>{error&&<p className="error-box" role="alert">{displayText(error)}</p>}</div>
  );
}
