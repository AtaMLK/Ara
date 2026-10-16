'use client';
import {T,Localized} from '@/components/language';
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
    <button className="secondary-button compact-button" disabled={isPending} onClick={() => run(() => approveExchangeRateAction(rateId), true)}><T>Approve</T></button>
    <button className="text-button" disabled={isPending} onClick={() => run(() => rejectExchangeRateAction(rateId), true)}><T>Reject</T></button>
    {error && <div className="error-inline"><T>{error}</T></div>}
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
        <h3 className="settings-subtitle"><T>Add exchange rate</T></h3>
        <div className="settings-form-grid">
          <label><T>From</T><Localized as="input" name="fromCurrency" maxLength={3} placeholder="EUR" required /></label>
          <label><T>To</T><Localized as="input" name="toCurrency" maxLength={3} placeholder="USD" required /></label>
          <label><T>Rate</T><Localized as="input" name="rate" type="number" min="0" step="0.00000001" placeholder="1.08" required /></label>
          <label><T>Valid from</T><input name="validFrom" type="date" required /></label>
          <label><T>Valid until</T><input name="validUntil" type="date" /></label>
          <label><T>Source</T><Localized as="input" name="source" placeholder="ECB / Admin" /></label>
        </div>
        <button className="primary-button" disabled={isPending}><T>Create proposed rate</T></button>
      </form>

    {error && <div className="error-inline"><T>{error}</T></div>}
  </div>;
}
