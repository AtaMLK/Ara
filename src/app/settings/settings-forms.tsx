'use client';

import { useState, useTransition } from 'react';
import {
  approveCustomerPricingRuleAction,
  updateCustomerPricingRuleAction,
  approveExchangeRateAction,
  createCustomerPricingRuleAction,
  createExchangeRateAction,
  rejectExchangeRateAction,
} from '@/app/actions';

type Rule = {
  id: string;
  name: string;
  customer_segment: 'international' | 'domestic';
  markup_percent: number;
  rounding_increment: number | null;
  status: string;
  approved_at: string | null;
  created_at: string;
};

export default function SettingsForms({
  rules = [],
  mode = 'main',
  rateId,
}: {
  rules?: Rule[];
  mode?: 'main' | 'rate-actions';
  rateId?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const run = (action: () => Promise<unknown>, reload = false) => {
    setError('');
    startTransition(async () => {
      try {
        await action();
        if (reload) window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Action failed');
      }
    });
  };

  if (mode === 'rate-actions' && rateId) {
    return (
      <div>
        <div className="settings-actions">
          <button className="secondary-button compact-button" disabled={isPending} onClick={() => run(() => approveExchangeRateAction(rateId), true)}>
            Approve
          </button>
          <button className="text-button danger-text" disabled={isPending} onClick={() => run(() => rejectExchangeRateAction(rateId), true)}>
            Reject
          </button>
        </div>
        {error && <div className="error-inline">{error}</div>}
      </div>
    );
  }

  const approvedRule = rules.find((rule) => rule.status === 'approved');
  const pendingRules = rules.filter((rule) => rule.status === 'pending_approval');
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="settings-form-stack">
      <form className="settings-form" action={(formData) => run(() => createCustomerPricingRuleAction({
        name: String(formData.get('name') || ''),
        customerSegment: String(formData.get('customerSegment') || 'international') as 'international' | 'domestic',
        markupPercent: Number(formData.get('markupPercent')),
        roundingIncrement: formData.get('roundingIncrement') ? Number(formData.get('roundingIncrement')) : undefined,
      }), true)}>
        <div className="settings-form-grid">
          <label>Rule name<input name="name" placeholder="Standard markup" required /></label>
          <label>Segment
            <select name="customerSegment" defaultValue="international">
              <option value="international">International</option>
              <option value="domestic">Domestic / Turkey</option>
            </select>
          </label>
          <label>Markup %<input name="markupPercent" type="number" min="0" step="0.01" placeholder="15" required /></label>
          <label>Rounding increment<input name="roundingIncrement" type="number" min="0" step="0.01" placeholder="0.50" /></label>
        </div>
        <button className="primary-button" disabled={isPending}>Create pending rule</button>
      </form>

      <div className="settings-list">
        {rules.map((rule) => (
          <div className="settings-list-item" key={rule.id}>
            {editingId === rule.id ? (
              <form className="settings-edit-form" action={(formData) => run(async () => {
                await updateCustomerPricingRuleAction({
                  id: rule.id,
                  name: String(formData.get('name') || ''),
                  customerSegment: String(formData.get('customerSegment') || rule.customer_segment) as 'international' | 'domestic',
                  markupPercent: Number(formData.get('markupPercent')),
                  roundingIncrement: formData.get('roundingIncrement') ? Number(formData.get('roundingIncrement')) : undefined,
                });
                setEditingId(null);
              }, true)}>
                <div className="settings-form-grid">
                  <label>Rule name<input name="name" defaultValue={rule.name} required /></label>
                  <label>Segment
                    <select name="customerSegment" defaultValue={rule.customer_segment}>
                      <option value="international">International</option>
                      <option value="domestic">Domestic / Turkey</option>
                    </select>
                  </label>
                  <label>Markup %<input name="markupPercent" type="number" min="0" step="0.01" defaultValue={rule.markup_percent} required /></label>
                  <label>Rounding<input name="roundingIncrement" type="number" min="0" step="0.01" defaultValue={rule.rounding_increment ?? ''} /></label>
                </div>
                <div className="settings-actions">
                  <button type="submit" className="primary-button compact-button" disabled={isPending}>Save</button>
                  <button type="button" className="secondary-button compact-button" disabled={isPending} onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              </form>
            ) : (
              <>
                <div>
                  <strong>{rule.name}</strong>
                  <div className="muted settings-meta">
                    {rule.customer_segment === 'domestic' ? 'Domestic / Turkey' : 'International'} · {rule.markup_percent}% markup
                    {rule.rounding_increment ? ' · round up to ' + rule.rounding_increment : ''}
                  </div>
                </div>
                <div className="settings-item-actions">
                  <span className={'badge status-' + rule.status}>{rule.status}</span>
                  {rule.status === 'pending_approval' && (
                    <button
                      className="secondary-button compact-button"
                      disabled={isPending || Boolean(rules.some((r) => r.customer_segment === rule.customer_segment && r.status === 'approved'))}
                      onClick={() => run(() => approveCustomerPricingRuleAction(rule.id), true)}
                    >Approve</button>
                  )}
                  <button className="secondary-button compact-button" disabled={isPending} onClick={() => setEditingId(rule.id)}>Edit</button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}
      <div className="settings-divider" />
    </div>
  );
}
