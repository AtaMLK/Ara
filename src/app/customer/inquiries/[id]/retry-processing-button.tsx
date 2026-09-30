'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { retryCustomerInquiryDocumentAction } from '@/app/actions';

export default function RetryProcessingButton({ inquiryId }: { inquiryId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  function handleRetry() {
    setError('');
    startTransition(async () => {
      try {
        const result = await retryCustomerInquiryDocumentAction(inquiryId);
        if (!result?.ok) {
          setError(result?.error ?? 'Document processing could not be restarted.');
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Document processing could not be restarted.');
      }
    });
  }

  return (
    <div className="retry-control">
      <button
        className="secondary-button compact-button"
        type="button"
        onClick={handleRetry}
        disabled={isPending}
      >
        {isPending ? 'Processing…' : 'Retry processing'}
      </button>
      {error && <div className="error-inline retry-error">{error}</div>}
    </div>
  );
}
