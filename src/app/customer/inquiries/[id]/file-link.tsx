'use client';

import { useState } from 'react';
import { getCustomerInquiryFileUrlAction } from '@/app/actions';

export default function CustomerFileLink({ inquiryId, fileId }: { inquiryId: string; fileId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function openFile() {
    setLoading(true);
    setError('');
    try {
      const result = await getCustomerInquiryFileUrlAction({ inquiryId, fileId });
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to open file.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button className="inline-button" type="button" onClick={openFile} disabled={loading}>
        {loading ? 'Opening…' : 'Open'}
      </button>
      {error && <div className="error-inline">{error}</div>}
    </div>
  );
}
