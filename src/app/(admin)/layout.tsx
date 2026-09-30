import type { ReactNode } from 'react';
import Link from 'next/link';
import { LayoutDashboard, Inbox, Factory, FileText, Receipt, Bell } from 'lucide-react';
import { requireAdminPage } from '@/lib/data/admin';
import ThemeToggle from '@/components/ThemeToggle';
import SignOutButton from '@/components/SignOutButton';

const links = [
  ['/','Dashboard',LayoutDashboard],
  ['/inquiries','Inquiries',Inbox],
  ['/suppliers','Suppliers',Factory],
  ['/rfqs','RFQs',FileText],
  ['/quotes','Quotes',Receipt],
  ['/notifications','Notifications',Bell],
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
              <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
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
