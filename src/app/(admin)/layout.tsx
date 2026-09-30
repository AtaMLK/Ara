import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireAdminPage } from '@/lib/data/admin';
import ThemeToggle from '@/components/ThemeToggle';
import SignOutButton from '@/components/SignOutButton';

const links = [
  ['/','Dashboard','⌂'],
  ['/inquiries','Inquiries','□'],
  ['/suppliers','Suppliers','◇'],
  ['/rfqs','RFQs','↗'],
  ['/quotes','Quotes','▣'],
  ['/notifications','Notifications','◌'],
] as const;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();

  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <Link href="/" className="admin-brand" aria-label="ARAT Dashboard">
          <span className="admin-brand-mark">A</span>
          <span>
            <strong>ARAT</strong>
            <small>Procurement OS</small>
          </span>
        </Link>

        <div className="eyebrow admin-eyebrow">ADMIN</div>

        <nav className="nav admin-nav">
          {links.map(([href, label, Icon]) => (
            <Link key={href} href={href}>
              <span className="nav-icon" aria-hidden="true">{Icon}</span>
              <span>{label}</span>
            </Link>
          ))}
        </nav>

        <div className="sidebar-footer">
          <ThemeToggle />
          <SignOutButton />
        </div>
      </aside>

      <main className="main">{children}</main>
    </div>
  );
}
