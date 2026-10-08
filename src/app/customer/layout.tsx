import type { ReactNode } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import SignOutButton from '@/components/SignOutButton';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export default async function CustomerLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  let unreadCount = 0;
  if (user) {
    const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null);
    unreadCount = count ?? 0;
  }

  return (
    <div className="customer-app">
      <header className="customer-nav">
        <Link className="customer-brand" href="/customer" aria-label="ARAT Customer Portal">
          <span className="customer-brand-mark">A</span>
          <span>
            <strong>ARAT</strong>
            <small>Customer Portal</small>
          </span>
        </Link>
        <div className="customer-nav-actions">
          <Link className="customer-notification-link" href="/customer/notifications" aria-label="Notifications">
            Notifications{unreadCount > 0 && <span className="nav-notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
          </Link>
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
