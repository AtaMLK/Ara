'use client';

import { useSyncExternalStore } from 'react';

function isDarkTheme() {
  const saved = window.localStorage.getItem('arat-theme');
  return saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function subscribeTheme(onChange: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const update = () => {
    document.documentElement.dataset.theme = isDarkTheme() ? 'dark' : 'light';
    onChange();
  };
  update();
  window.addEventListener('storage', update);
  window.addEventListener('arat-theme-change', update);
  media.addEventListener('change', update);
  return () => {
    window.removeEventListener('storage', update);
    window.removeEventListener('arat-theme-change', update);
    media.removeEventListener('change', update);
  };
}

export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, isDarkTheme, () => false);

  function toggle() {
    const next = !dark;
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
    window.localStorage.setItem('arat-theme', next ? 'dark' : 'light');
    window.dispatchEvent(new Event('arat-theme-change'));
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    >
      <span className="theme-toggle-icon" aria-hidden="true">{dark ? '☼' : '☾'}</span>
      <span>{dark ? 'Light' : 'Dark'}</span>
    </button>
  );
}
