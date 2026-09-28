'use client';

import { FormEvent, useState } from 'react';
import { createCustomerAccountAction, changeCustomerPasswordAction } from '@/app/customer-account-actions';

export function CreateCustomerForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const result = await createCustomerAccountAction({ email, password, name, companyName });
      setMessage(`Customer created. Code: ${result.customerCode}. Login: /login`);
      setEmail('');
      setPassword('');
      setName('');
      setCompanyName('');
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
      <label className="form-field"><span>Company name</span><input value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={200} /></label>
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
