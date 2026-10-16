'use client';

import {T} from '@/components/language';
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

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError || !authData.session?.access_token) {
      setError(authError?.message ?? 'Sign-in succeeded but no session was returned.');
      setLoading(false);
      return;
    }

    const roleCheck = await fetch('/api/auth/role', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Authorization: `Bearer ${authData.session.access_token}`,
        'Cache-Control': 'no-cache',
      },
    });

    const roleResult = await roleCheck.json().catch(() => null);

    if (!roleCheck.ok || !roleResult?.destination || roleResult.destination === '/login') {
      await supabase.auth.signOut();
      setError(
        roleResult?.detail
          ? `Account routing failed: ${roleResult.reason ?? 'unknown_error'} — ${roleResult.detail}`
          : roleResult?.reason
            ? `Account routing failed: ${roleResult.reason}`
            : 'Account routing failed. Please try signing in again.',
      );
      setLoading(false);
      return;
    }

    const requested=new URLSearchParams(window.location.search).get('next');
    const safe=requested?.startsWith('/')&&!requested.startsWith('//')&&!requested.includes('\\')&&
      (roleResult.destination.startsWith('/customer')?requested.startsWith('/customer'):!requested.startsWith('/customer'));
    window.location.assign(safe?requested!:roleResult.destination);
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><T>ARAT</T></div>
        <div className="eyebrow"><T>ARAT PORTAL</T></div>
        <h1 className="title"><T>Sign in</T></h1>
        <p className="muted"><T>Sign in with your authorized Admin or Customer account.</T></p>

        <label><T>Email</T><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
        <label><T>Password</T><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" /></label>

        {error && <div className="error-box"><T>{error}</T></div>}
        <button className="primary-button" disabled={loading}><T>{loading ? 'Signing in…' : 'Sign in'}</T></button>
        <p><a href="/forgot-password"><T>Forgot password?</T></a></p>
      </form>
    </main>
  );
}
