'use client';
import {usePathname} from 'next/navigation';
import {LanguageToggle} from './language';
import ThemeToggle from './ThemeToggle';
export default function PublicDisplayControls(){
  const pathname=usePathname();
  if(pathname.startsWith('/customer'))return null;
  return <div className="public-display-controls"><LanguageToggle/><ThemeToggle/></div>;
}
