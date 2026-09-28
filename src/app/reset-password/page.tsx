'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';

export default function ResetPasswordPage() {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmation) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword('');
      setConfirmation('');
      setMessage('Password changed successfully. You can sign in with your new password.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">ARAT</div>
        <div className="eyebrow">ACCOUNT RECOVERY</div>
        <h1 className="title">Choose a new password</h1>
        <label>New password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
        <label>Confirm password<input type="password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required minLength={8} autoComplete="new-password" /></label>
        {error && <div className="error-box">{error}</div>}
        {message && <div className="success-box">{message}</div>}
        <button className="primary-button" disabled={loading}>{loading ? 'Saving…' : 'Change password'}</button>
        {message && <p><Link href="/login">Go to sign in</Link></p>}
      </form>
    </main>
  );
}
