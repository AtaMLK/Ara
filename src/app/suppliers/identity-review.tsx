'use client';

import { useState } from 'react';
import { reviewSupplierIdentityAction } from '@/app/actions';

export default function SupplierIdentityReview({ supplier }: { supplier: { id:string; legal_name:string; primary_country:string|null } }) {
  const [saving,setSaving] = useState(false);
  const [error,setError] = useState('');
  return <details className="supplier-identity-editor">
    <summary>Correct identity</summary>
    <form className="revision-form" onSubmit={async event => {
      event.preventDefault(); setSaving(true); setError('');
      const data = new FormData(event.currentTarget);
      try {
        await reviewSupplierIdentityAction({supplierId:supplier.id,legalName:String(data.get('name')||''),
          country:String(data.get('country')||''),sourceUrl:String(data.get('source')||'')});
        window.location.reload();
      } catch (error) {setError(error instanceof Error?error.message:'Could not save identity');setSaving(false);}
    }}>
      <label>Company name<input name="name" defaultValue={supplier.legal_name} minLength={2} maxLength={160} required /></label>
      <label>Country<input name="country" defaultValue={supplier.primary_country||''} maxLength={120} /></label>
      <label>Identity source URL<input name="source" type="url" placeholder="https://supplier.example/about" required /></label>
      <p className="muted">Use a company name supported by the source. Commercial verification will return to Pending.</p>
      <button className="secondary-button" disabled={saving}>{saving?'Saving…':'Save corrected identity'}</button>
      {error && <div className="error-box" role="alert">{error}</div>}
    </form>
  </details>;
}
