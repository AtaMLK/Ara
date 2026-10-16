'use client';

import {T,Localized} from '@/components/language';
import { FormEvent, useState } from 'react';
import { createCustomerAccountAction, changeCustomerPasswordAction } from '@/app/customer-account-actions';

export function CreateCustomerForm() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [customerType, setCustomerType] = useState<'company' | 'individual'>('company');
  const [companyName, setCompanyName] = useState('');
  const [country, setCountry] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [taxRegistration, setTaxRegistration] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function reset() {
    setEmail(''); setPassword(''); setName(''); setCompanyName(''); setCountry('');
    setPhone(''); setAddress(''); setTaxRegistration(''); setNotes('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(''); setMessage('');
    try {
      const result = await createCustomerAccountAction({
        email, password, name, customerType, companyName, country, phone, address, taxRegistration, notes,
      });
      setMessage('Customer created. Code: ' + result.customerCode);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create customer');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button type="button" className="primary-button create-customer-trigger" onClick={() => { setError(''); setMessage(''); setOpen(true); }}><T>
        + Create new customer
      </T></button>

      {open && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div className="modal-card customer-modal" role="dialog" aria-modal="true" aria-labelledby="create-customer-title">
            <div className="modal-head">
              <div>
                <div className="eyebrow"><T>CUSTOMER ACCESS</T></div>
                <h2 id="create-customer-title"><T>Create new customer</T></h2>
                <p className="muted"><T>Create the customer login and profile from here.</T></p>
              </div>
              <Localized as="button" type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="Close">×</Localized>
            </div>

            <form onSubmit={submit} className="customer-modal-form">
              <div className="modal-grid">
                <label className="form-field"><span><T>Customer name</T></span><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} /></label>
                <label className="form-field"><span><T>Customer type</T></span><select value={customerType} onChange={(e) => setCustomerType(e.target.value as 'company' | 'individual')}><option value="company"><T>Company</T></option><option value="individual"><T>Individual</T></option></select></label>
                {customerType === 'company' && <label className="form-field"><span><T>Company name</T></span><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required maxLength={200} /></label>}
                <label className="form-field"><span><T>Country</T></span><Localized as="input" value={country} onChange={(e) => setCountry(e.target.value)} required maxLength={120} placeholder="e.g. Italy" /></label>
                <label className="form-field"><span><T>Phone</T></span><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={80} /></label>
                <label className="form-field"><span><T>Email</T></span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
                <label className="form-field"><span><T>Address</T></span><textarea value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} rows={2} /></label>
                <label className="form-field"><span><T>Tax registration</T></span><input value={taxRegistration} onChange={(e) => setTaxRegistration(e.target.value)} maxLength={160} /></label>
                <label className="form-field"><span><T>Initial password</T></span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
                <label className="form-field modal-wide"><span><T>Notes</T></span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} /></label>
              </div>
              {error && <div className="error-box"><T>{error}</T></div>}
              {message && <div className="success-box"><T>{message}</T></div>}
              <div className="form-actions">
                <button type="button" className="secondary-button" onClick={() => setOpen(false)}><T>Cancel</T></button>
                <button className="primary-button" disabled={loading}><T>{loading ? 'Creating…' : 'Create customer'}</T></button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
export function ChangeCustomerPassword({ customerId }: { customerId: string }) {
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      await changeCustomerPasswordAction({ customerId, password });
      setPassword('');
      setMessage('Password changed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="inline-edit" onSubmit={submit}>
      <Localized as="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" minLength={8} required autoComplete="new-password" />
      <button className="secondary-button compact-button" disabled={loading}><T>{loading ? 'Saving…' : 'Change password'}</T></button>
      {message && <span className="success-inline"><T>{message}</T></span>}
      {error && <span className="error-inline"><T>{error}</T></span>}
    </form>
  );
}
