import type { ReactNode } from 'react';
import Link from 'next/link';
import ThemeToggle from '@/components/ThemeToggle';
import SignOutButton from '@/components/SignOutButton';

export default function CustomerLayout({ children }: { children: ReactNode }) {
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
          <ThemeToggle />
          <SignOutButton />
        </div>
      </header>
      {children}
    </div>
  );
}
