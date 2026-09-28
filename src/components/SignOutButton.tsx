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
    <button type="button" className="nav-button" onClick={signOut}>
      Sign out
    </button>
  );
}
