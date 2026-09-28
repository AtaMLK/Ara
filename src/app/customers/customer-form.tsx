'use client';

import { FormEvent, useState } from 'react';
import { createCustomerAccountAction, changeCustomerPasswordAction } from '@/app/customer-account-actions';

export function CreateCustomerForm() {
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const result = await createCustomerAccountAction({
        email,
        password,
        name,
        customerType,
        companyName,
        country,
        phone,
        address,
        taxRegistration,
        notes,
      });
      setMessage(`Customer created. Code: ${result.customerCode}. Login: /login`);
      setEmail('');
      setPassword('');
      setName('');
      setCompanyName('');
      setCountry('');
      setPhone('');
      setAddress('');
      setTaxRegistration('');
      setNotes('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create customer');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="detail-card customer-account-form" onSubmit={submit}>
      <h2>Create customer account</h2>
      <p className="muted">Only Admin can create customer accounts. The customer signs in with this email and password.</p>
      <label className="form-field"><span>Customer name</span><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={160} /></label>
      <label className="form-field"><span>Customer type</span><select value={customerType} onChange={(e) => setCustomerType(e.target.value as 'company' | 'individual')}><option value="company">Company</option><option value="individual">Individual</option></select></label>
      {customerType === 'company' && <label className="form-field"><span>Company name</span><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required maxLength={200} /></label>}
      <label className="form-field"><span>Country</span><input value={country} onChange={(e) => setCountry(e.target.value)} required maxLength={120} placeholder="e.g. Italy" /></label>
      <label className="form-field"><span>Phone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={80} /></label>
      <label className="form-field"><span>Address</span><textarea value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} rows={2} /></label>
      <label className="form-field"><span>Tax registration</span><input value={taxRegistration} onChange={(e) => setTaxRegistration(e.target.value)} maxLength={160} /></label>
      <label className="form-field"><span>Notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} /></label>
      <label className="form-field"><span>Email / Username</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
      <label className="form-field"><span>Initial password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
      {error && <div className="error-box">{error}</div>}
      {message && <div className="success-box">{message}</div>}
      <div className="form-actions"><button className="primary-button" disabled={loading}>{loading ? 'Creating…' : 'Create customer'}</button></div>
    </form>
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
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password" minLength={8} required autoComplete="new-password" />
      <button className="secondary-button compact-button" disabled={loading}>{loading ? 'Saving…' : 'Change password'}</button>
      {message && <span className="success-inline">{message}</span>}
      {error && <span className="error-inline">{error}</span>}
    </form>
  );
}
