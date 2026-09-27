'use client';

import { useState } from 'react';
import { updateRequirementAction } from '@/app/actions';

export function RequirementEdit({ inquiryId, requirement }: {
  inquiryId: string;
  requirement: { id: string; value: string; status: 'open'|'clarification_required'|'confirmed'|'rejected' };
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!editing) return <button className="inline-button" onClick={() => setEditing(true)}>Edit</button>;

  async function save(formData: FormData) {
    setSaving(true);
    setError('');
    try {
      await updateRequirementAction({
        inquiryId,
        requirementId: requirement.id,
        value: String(formData.get('value') ?? ''),
        status: String(formData.get('status')) as 'open'|'clarification_required'|'confirmed'|'rejected',
      });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setSaving(false);
    }
  }

  return <form className="inline-edit" action={save}>
    <input name="value" defaultValue={requirement.value} required />
    <select name="status" defaultValue={requirement.status}>
      <option value="open">Open</option>
      <option value="clarification_required">Clarification Required</option>
      <option value="confirmed">Confirmed</option>
      <option value="rejected">Rejected</option>
    </select>
    <button className="inline-button" disabled={saving}>{saving ? '…' : 'Save'}</button>
    <button type="button" className="inline-button" onClick={() => setEditing(false)}>Cancel</button>
    {error && <span className="error-inline">{error}</span>}
  </form>;
}
