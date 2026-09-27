'use client';

import { useState } from 'react';
import { updateCustomerQuoteDetailsAction } from '@/app/actions';

export default function QuoteDetailsEditor({ quote }: { quote: { id:string; subject:string|null; body:string|null; valid_until:string|null } }) {
  const [subject,setSubject]=useState(quote.subject||'');
  const [body,setBody]=useState(quote.body||'');
  const [validUntil,setValidUntil]=useState(quote.valid_until||'');
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  async function save(){
    setSaving(true); setError('');
    try { await updateCustomerQuoteDetailsAction({quoteId:quote.id,subject,body,validUntil}); window.location.reload(); }
    catch(e){ setError(e instanceof Error?e.message:'Could not save quote details.'); setSaving(false); }
  }
  return <div className="detail-card">
    <div className="section-head"><h2>Edit customer quote</h2></div>
    <div className="revision-form">
      <label>Subject<input value={subject} maxLength={200} onChange={e=>setSubject(e.target.value)} /></label>
      <label>Valid until<input type="date" value={validUntil} onChange={e=>setValidUntil(e.target.value)} /></label>
      <label>Customer message<textarea value={body} maxLength={10000} onChange={e=>setBody(e.target.value)} /></label>
      <button className="primary-button" disabled={saving} onClick={save}>{saving?'Saving…':'Save quote details'}</button>
      {error && <div className="error-box">{error}</div>}
    </div>
  </div>;
}
