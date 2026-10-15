'use client';
import {useState} from 'react';
import {saveQuoteCompanyAction} from './company-actions';
import type {CompanyProfile} from '@/lib/quotes/company';
export default function CompanyForm({profile}:{profile:CompanyProfile}){
  const [error,setError]=useState(''),[saved,setSaved]=useState(false),[saving,setSaving]=useState(false);
  return <section className="detail-card"><div className="section-head"><h2>Quotation letterhead</h2></div><p className="muted">Company details and logo used in quotation PDFs and emails. Upload your approved PNG or JPEG logo.</p>
    <form className="settings-form" action={async form=>{setSaving(true);setError('');setSaved(false);try{await saveQuoteCompanyAction(form);setSaved(true);}catch(e){setError(e instanceof Error?e.message:'Could not save.');}finally{setSaving(false);}}}>
      <div className="settings-form-grid">{[['name','Company / Legal name'],['email','Company email'],['phone','Phone'],['website','Website'],['address','Address'],['taxDetails','Tax / Registration details']].map(([key,label])=><label key={key}>{label}<input name={key} defaultValue={profile[key as keyof CompanyProfile]||''} required={key==='name'||key==='email'} type={key==='email'?'email':'text'}/></label>)}
      <label>Company logo<input name="logo" type="file" accept="image/png,image/jpeg"/><small>{profile.logoPath?'A logo is configured. Upload to replace it.':'No logo configured yet.'}</small></label></div>
      <button className="primary-button" disabled={saving}>{saving?'Saving…':'Save quotation letterhead'}</button>{error&&<p className="error-box">{error}</p>}{saved&&<p role="status">Quotation letterhead saved.</p>}
    </form></section>;
}
