'use client';
import { useState, useTransition } from 'react';
import { approveExchangeRateAction, createExchangeRateAction, rejectExchangeRateAction } from '@/app/actions';
export default function SettingsForms({ mode = 'main', rateId }: { mode?: 'main' | 'rate-actions'; rateId?: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');
  const run = (action: () => Promise<unknown>, reload = false) => {
    setError(''); startTransition(async () => { try { await action(); if (reload) window.location.reload(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); } });
  };
  if (mode === 'rate-actions' && rateId) return <div>
    <button className="secondary-button compact-button" disabled={isPending} onClick={() => run(() => approveExchangeRateAction(rateId), true)}>Approve</button>
    <button className="text-button" disabled={isPending} onClick={() => run(() => rejectExchangeRateAction(rateId), true)}>Reject</button>
    {error && <div className="error-inline">{error}</div>}
  </div>;
  return <div className="settings-form-stack">
      <form className="settings-form" action={(formData) => run(() => createExchangeRateAction({
        fromCurrency: String(formData.get('fromCurrency') || ''),
        toCurrency: String(formData.get('toCurrency') || ''),
        rate: Number(formData.get('rate')),
        validFrom: String(formData.get('validFrom') || ''),
        validUntil: String(formData.get('validUntil') || '') || undefined,
        source: String(formData.get('source') || '') || undefined,
      }), true)}>
        <h3 className="settings-subtitle">Add exchange rate</h3>
        <div className="settings-form-grid">
          <label>From<input name="fromCurrency" maxLength={3} placeholder="EUR" required /></label>
          <label>To<input name="toCurrency" maxLength={3} placeholder="USD" required /></label>
          <label>Rate<input name="rate" type="number" min="0" step="0.00000001" placeholder="1.08" required /></label>
          <label>Valid from<input name="validFrom" type="date" required /></label>
          <label>Valid until<input name="validUntil" type="date" /></label>
          <label>Source<input name="source" placeholder="ECB / Admin" /></label>
        </div>
        <button className="primary-button" disabled={isPending}>Create proposed rate</button>
      </form>

    {error && <div className="error-inline">{error}</div>}
  </div>;
}
