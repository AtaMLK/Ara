'use client';

import {T} from '@/components/language';
import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { createBrowserClient } from '@supabase/ssr';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setMessage('');

    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const redirectTo = `${window.location.origin}/auth/callback?next=/reset-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (resetError) throw resetError;
      setMessage('If an account exists for this email, a password reset link has been sent.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><T>ARAT</T></div>
        <div className="eyebrow"><T>ACCOUNT RECOVERY</T></div>
        <h1 className="title"><T>Reset password</T></h1>
        <p className="muted"><T>Enter your account email. We will send a secure reset link.</T></p>
        <label><T>Email</T><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        {error && <div className="error-box"><T>{error}</T></div>}
        {message && <div className="success-box"><T>{message}</T></div>}
        <button className="primary-button" disabled={loading}><T>{loading ? 'Sending…' : 'Send reset link'}</T></button>
        <p><Link href="/login"><T>Back to sign in</T></Link></p>
      </form>
    </main>
  );
}
