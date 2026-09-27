import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireCustomerInquiryAccess } from '@/lib/ai/guards';

export default function CustomerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="customer-layout">
      <aside className="sidebar">
        <div className="brand">ARAT</div>
        <div className="eyebrow">CUSTOMER</div>
        <nav className="nav">
          <Link href="/customer">My Requests</Link>
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
