import type {ReactNode} from 'react';
import './globals.css';
import Link from 'next/link';
const links=[['/','Dashboard'],['/inquiries','Inquiries'],['/suppliers','Suppliers'],['/rfqs','RFQs'],['/quotes','Quotes'],['/notifications','Notifications']];
export default function RootLayout({children}:{children:ReactNode}){return <html lang="en"><body><aside className="sidebar"><div className="brand">ARAT</div><nav className="nav">{links.map(([href,label])=><Link key={href} href={href}>{label}</Link>)}</nav></aside><main className="main">{children}</main></body></html>}