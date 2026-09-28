'use client';

import { useState, useTransition } from 'react';
import { acceptCustomerQuoteAction, rejectCustomerQuoteAction, requestCustomerQuoteRevisionAction } from '@/app/actions';

export default function CustomerQuoteActions({ quoteId }: { quoteId: string }) {
  const [mode, setMode] = useState<'idle' | 'revision' | 'reject'>('idle');
  const [reason, setReason] = useState('price');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<unknown>) => {
    setError('');
    startTransition(async () => {
      try { await fn(); window.location.reload(); }
      catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    });
  };

  return (
    <div className="customer-quote-actions">
      {mode === 'idle' ? (
        <>
          <button className="primary-button" disabled={pending} onClick={() => run(() => acceptCustomerQuoteAction(quoteId))}>Accept quotation</button>
          <button className="secondary-button" disabled={pending} onClick={() => setMode('revision')}>Request revision</button>
          <button className="text-button" disabled={pending} onClick={() => setMode('reject')}>Reject quotation</button>
        </>
      ) : mode === 'reject' ? (
        <div className="revision-form">
          <label>Reason <small>Optional</small>
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Optional reason for rejecting this quotation." />
          </label>
          <div className="settings-actions">
            <button className="primary-button" disabled={pending} onClick={() => run(() => rejectCustomerQuoteAction({ quoteId, reason: text }))}>Confirm rejection</button>
            <button className="text-button" disabled={pending} onClick={() => { setText(''); setMode('idle'); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="revision-form">
          <label>What needs to change?
            <select value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="price">Price</option>
              <option value="quantity">Quantity</option>
              <option value="delivery_time">Delivery time</option>
              <option value="product_specification">Product specification</option>
              <option value="payment_terms">Payment terms</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>Details
            <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Tell us what you would like to change." />
          </label>
          <div className="settings-actions">
            <button className="primary-button" disabled={pending} onClick={() => run(() => requestCustomerQuoteRevisionAction({ quoteId, reason, freeText: text }))}>Submit request</button>
            <button className="text-button" disabled={pending} onClick={() => setMode('idle')}>Cancel</button>
          </div>
        </div>
      )}
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}
