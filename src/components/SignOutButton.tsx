'use client';

import { createBrowserClient } from '@supabase/ssr';

export default function SignOutButton() {
  async function signOut() {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );

    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  return (
    <button
      type="button"
      className="nav-button customer-sign-out-button"
      onClick={signOut}
      style={{
        width: 'auto',
        border: '1px solid var(--arat-border-strong)',
        background: 'var(--arat-surface-soft)',
        color: 'var(--arat-text)',
        textAlign: 'center',
      }}
    >
      Sign out
    </button>
  );
}
