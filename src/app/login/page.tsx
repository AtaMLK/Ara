'use client';

import { FormEvent, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError(authError.message);
      setLoading(false);
      return;
    }

    window.location.href = '/';
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand">ARAT</div>
        <div className="eyebrow">ADMIN PORTAL</div>
        <h1 className="title">Sign in</h1>
        <p className="muted">Use your authorized ARAT admin account.</p>

        <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>

        {error && <div className="error-box">{error}</div>}
        <button className="primary-button" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
