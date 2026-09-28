import type { ReactNode } from 'react';
import './globals.css';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import SignOutButton from '@/components/SignOutButton';

const links=[['/','Dashboard'],['/inquiries','Inquiries'],['/suppliers','Suppliers'],['/rfqs','RFQs'],['/quotes','Quotes'],['/quotes/revisions','Quote Revisions'],['/notifications','Notifications'],['/settings','Settings']];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  let isAdmin = false;
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('role,status').eq('user_id', user.id).single();
    isAdmin = profile?.role === 'admin' && profile.status === 'active';
  }

  return (
    <html lang="en">
      <body>
        {isAdmin ? (
          <div className="admin-layout">
            <aside className="sidebar"><div className="brand">ARAT</div><div className="eyebrow">ADMIN</div><nav className="nav">{links.map(([href,label])=><Link key={href} href={href}>{label}</Link>)}</nav><div className="sidebar-footer"><SignOutButton /></div></aside>
            <main className="main">{children}</main>
          </div>
        ) : children}
      </body>
    </html>
  );
}
