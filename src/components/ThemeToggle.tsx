'use client';

import {T,Localized} from '@/components/language';
import { useSyncExternalStore } from 'react';

function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const themeSnapshot = () => document.documentElement.dataset.theme === 'dark';
const serverThemeSnapshot = () => false;

export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeToTheme, themeSnapshot, serverThemeSnapshot);

  function toggle() {
    const next = document.documentElement.dataset.theme !== 'dark';
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    try{window.localStorage.setItem('arat-theme', next ? 'dark' : 'light');}catch{}
    document.cookie=`arat-theme=${next?'dark':'light'}; Path=/; Max-Age=31536000; SameSite=Lax`;
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
