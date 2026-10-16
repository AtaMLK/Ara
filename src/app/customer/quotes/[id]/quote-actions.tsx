'use client';
import {T,Localized} from '@/components/language';
import {useRouter} from 'next/navigation';

import { useState, useTransition } from 'react';
import { acceptCustomerQuoteAction, rejectCustomerQuoteAction, requestCustomerQuoteRevisionAction } from '@/app/actions';

export default function CustomerQuoteActions({ quoteId }: { quoteId: string }) {
  const router=useRouter();
  const [mode, setMode] = useState<'idle' | 'revision' | 'reject'>('idle');
  const [reason, setReason] = useState<Parameters<typeof requestCustomerQuoteRevisionAction>[0]['reason']>('price');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<unknown>) => {
    setError('');
    startTransition(async () => {
      try { await fn(); router.refresh(); }
      catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    });
  };

  return (
    <div className="customer-quote-actions">
      {mode === 'idle' ? (
        <>
          <button className="primary-button" disabled={pending} onClick={() => run(() => acceptCustomerQuoteAction(quoteId))}><T>Accept quotation</T></button>
          <button className="secondary-button" disabled={pending} onClick={() => setMode('revision')}><T>Request revision</T></button>
          <button className="text-button" disabled={pending} onClick={() => setMode('reject')}><T>Reject quotation</T></button>
        </>
      ) : mode === 'reject' ? (
        <div className="revision-form">
          <label><T>Reason </T><small><T>Optional</T></small>
            <Localized as="textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Optional reason for rejecting this quotation." />
          </label>
          <div className="settings-actions">
            <button className="primary-button" disabled={pending} onClick={() => run(() => rejectCustomerQuoteAction({ quoteId, reason: text }))}><T>Confirm rejection</T></button>
            <button className="text-button" disabled={pending} onClick={() => { setText(''); setMode('idle'); }}><T>Cancel</T></button>
          </div>
        </div>
      ) : (
        <div className="revision-form">
          <label><T>What needs to change?
            </T><select value={reason} onChange={(e) => setReason(e.target.value as Parameters<typeof requestCustomerQuoteRevisionAction>[0]['reason'])}>
              <option value="price"><T>Price</T></option>
              <option value="quantity"><T>Quantity</T></option>
              <option value="delivery_time"><T>Delivery time</T></option>
              <option value="product_specification"><T>Product specification</T></option>
              <option value="payment_terms"><T>Payment terms</T></option>
              <option value="other"><T>Other</T></option>
            </select>
          </label>
          <label><T>Details
            </T><Localized as="textarea" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Tell us what you would like to change." />
          </label>
          <div className="settings-actions">
            <button className="primary-button" disabled={pending} onClick={() => run(() => requestCustomerQuoteRevisionAction({ quoteId, reason, freeText: text }))}><T>Submit request</T></button>
            <button className="text-button" disabled={pending} onClick={() => setMode('idle')}><T>Cancel</T></button>
          </div>
        </div>
      )}
      {error && <div className="error-box"><T>{error}</T></div>}
    </div>
  );
}
