import {T,LanguageProvider,LanguageToggle} from '@/components/language';
import {cookies} from 'next/headers';
import {validLocale,localeCookie} from '@/lib/i18n/translate';
import PublicDisplayControls from '@/components/public-display-controls';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import './dark-surfaces.css';
import './display-preferences.css';
import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import SignOutButton from '@/components/SignOutButton';
import ThemeToggle from '@/components/ThemeToggle';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: {
    default: 'ARAT | AI Procurement Platform',
    template: '%s | ARAT',
  },
  description: 'ARAT procurement and supplier management portal.',
};

const links=[['/','Dashboard'],['/inquiries','Inquiries'],['/suppliers','Suppliers'],['/rfqs','RFQs'],['/quotes','Quotes'],['/quotes/revisions','Quote Revisions'],['/customers','Customers'],['/notifications','Notifications'],['/settings','Settings']];

export default async function RootLayout({ children }: { children: ReactNode }) {
  const preferences=await cookies();
  const locale=validLocale(preferences.get(localeCookie)?.value);
  const theme=preferences.get('arat-theme')?.value==='dark'?'dark':'light';
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  let isAdmin = false;
  let unreadNotificationCount = 0;
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('role,status').eq('user_id', user.id).single();
    isAdmin = profile?.role === 'admin' && profile.status === 'active';
    if (isAdmin) {
      const { count } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('read_at', null);
      unreadNotificationCount = count ?? 0;
    }
  }

  return (
    <html lang={locale} data-theme={theme} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{__html:`try{var s=localStorage.getItem('arat-theme')||${JSON.stringify(preferences.get('arat-theme')?.value??null)};document.documentElement.dataset.theme=s==='dark'||(!s&&matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}catch(e){}`}}/>
        <LanguageProvider initialLocale={locale}>
        {!isAdmin&&<PublicDisplayControls/>}
        {isAdmin ? (
          <div className="admin-layout">
            <aside className="sidebar"><div className="brand-row"><div><div className="brand"><T>ARAT</T></div><div className="eyebrow"><T>ADMIN</T></div></div></div><nav className="nav">{links.map(([href,label])=><Link key={href} href={href}><T>{label}</T>{href === '/notifications' && unreadNotificationCount > 0 && <span className="nav-notification-count">{unreadNotificationCount > 99 ? '99+' : unreadNotificationCount}</span>}</Link>)}</nav><div className="sidebar-footer"><LanguageToggle/><ThemeToggle /><SignOutButton /></div></aside>
            <main className="main"><div className="admin-mobile-controls"><Link href="/">ARAT</Link><LanguageToggle/><ThemeToggle/></div>{children}</main>
          </div>
        ) : children}
        <Toaster />
        </LanguageProvider>
      </body>
    </html>
  );
}
