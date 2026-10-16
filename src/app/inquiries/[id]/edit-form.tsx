'use client';

import {T} from '@/components/language';
import { useState } from 'react';
import { updateInquiryAction } from '@/app/actions';

export function InquiryEditForm({
  inquiryId,
  title,
  description,
  version,
}: {
  inquiryId: string;
  title: string;
  description: string;
  version: number;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!editing) {
    return <button className="secondary-button" onClick={() => setEditing(true)}><T>Edit inquiry</T></button>;
  }

  async function save(formData: FormData) {
    setSaving(true);
    setError('');
    try {
      await updateInquiryAction({
        inquiryId,
        title: String(formData.get('title') ?? ''),
        description: String(formData.get('description') ?? ''),
        expectedVersion: version,
      });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      setSaving(false);
    }
  }

  return (
    <form className="edit-card" action={save}>
      <label><T>Title</T><input name="title" defaultValue={title} required /></label>
      <label><T>Description</T><textarea name="description" defaultValue={description} rows={5} /></label>
      {error && <div className="error-box"><T>{error}</T></div>}
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={() => setEditing(false)}><T>Cancel</T></button>
        <button className="primary-button" disabled={saving}><T>{saving ? 'Saving…' : 'Save changes'}</T></button>
      </div>
    </form>
  );
}
