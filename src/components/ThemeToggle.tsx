'use client';

import {T,Localized} from '@/components/language';
import { useEffect, useState } from 'react';

export default function ThemeToggle() {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const isDark = document.documentElement.dataset.theme === 'dark';
    setDark(isDark);
    const observer=new MutationObserver(()=>setDark(document.documentElement.dataset.theme==='dark'));
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    return ()=>observer.disconnect();
  }, []);

  function toggle() {
    const next = document.documentElement.dataset.theme !== 'dark';
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try{window.localStorage.setItem('arat-theme', next ? 'dark' : 'light');}catch{}
    document.cookie=`arat-theme=${next?'dark':'light'}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setDark(next);
  }

  return (
    <Localized as="button"
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      <span className="theme-toggle-icon" aria-hidden="true">{dark ? '☼' : '☾'}</span>
      <span><T>{dark ? 'Light' : 'Dark'}</T></span>
    </Localized>
  );
}
