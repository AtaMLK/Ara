'use client';

import { useState, useTransition } from 'react';
import {
  approveCustomerPricingRuleAction,
  approveExchangeRateAction,
  createCustomerPricingRuleAction,
  createExchangeRateAction,
  rejectExchangeRateAction,
} from '@/app/actions';

type Rule = {
  id: string;
  name: string;
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

  return (
    <div className="settings-form-stack">
      <form className="settings-form" action={(formData) => run(() => createCustomerPricingRuleAction({
        name: String(formData.get('name') || ''),
        markupPercent: Number(formData.get('markupPercent')),
        roundingIncrement: formData.get('roundingIncrement') ? Number(formData.get('roundingIncrement')) : undefined,
      }), true)}>
        <div className="settings-form-grid">
          <label>Rule name<input name="name" placeholder="Standard markup" required /></label>
          <label>Markup %<input name="markupPercent" type="number" min="0" step="0.01" placeholder="15" required /></label>
          <label>Rounding increment<input name="roundingIncrement" type="number" min="0" step="0.01" placeholder="0.50" /></label>
        </div>
        <button className="primary-button" disabled={isPending}>Create pending rule</button>
      </form>

      <div className="settings-list">
        {approvedRule && (
          <div className="settings-list-item">
            <div>
              <strong>{approvedRule.name}</strong>
              <div className="muted settings-meta">{approvedRule.markup_percent}% markup{approvedRule.rounding_increment ? ' · round up to ' + approvedRule.rounding_increment : ''}</div>
            </div>
            <span className="badge status-approved">approved</span>
          </div>
        )}
        {pendingRules.map((rule) => (
          <div className="settings-list-item" key={rule.id}>
            <div>
              <strong>{rule.name}</strong>
              <div className="muted settings-meta">{rule.markup_percent}% markup{rule.rounding_increment ? ' · round up to ' + rule.rounding_increment : ''}</div>
            </div>
            <button
              className="secondary-button compact-button"
              disabled={isPending || Boolean(approvedRule)}
              onClick={() => run(() => approveCustomerPricingRuleAction(rule.id), true)}
            >Approve</button>
          </div>
        ))}
      </div>

      {error && <div className="error-box">{error}</div>}
    </div>
  );
}
