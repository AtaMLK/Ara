'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
export default function PageBackButton(){
 const path=usePathname();
 if(path==='/'||/^\/inquiries\/[^/]+$/.test(path)||(/^\/quotes\/[^/]+$/.test(path)&&path!=='/quotes/revisions'))return null;
 return <div className="page-back-navigation"><Link className="back-link" href={path==='/quotes/revisions'?'/quotes':'/'}>← {path==='/quotes/revisions'?'Back to quotes':'Back to dashboard'}</Link></div>;
}
