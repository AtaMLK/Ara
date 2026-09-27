import type { ReactNode } from 'react';
import Link from 'next/link';
import { requireAdminPage } from '@/lib/data/admin';

const links=[['/','Dashboard'],['/inquiries','Inquiries'],['/suppliers','Suppliers'],['/rfqs','RFQs'],['/quotes','Quotes'],['/notifications','Notifications']];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdminPage();
  return (
    <div className="admin-layout">
      <aside className="sidebar"><div className="brand">ARAT</div><div className="eyebrow">ADMIN</div><nav className="nav">{links.map(([href,label])=><Link key={href} href={href}>{label}</Link>)}</nav></aside>
      <main className="main">{children}</main>
    </div>
  );
}
