'use client';

import { useEffect, useState } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

export function Toaster(props: ToasterProps) {
  const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('light');

  useEffect(() => {
    const root = document.documentElement;

    const syncTheme = () => {
      setTheme(root.dataset.theme === 'dark' ? 'dark' : 'light');
    };

    syncTheme();

    const observer = new MutationObserver(syncTheme);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      expand={false}
      toastOptions={{
        classNames: {
          toast: 'arat-toast',
          title: 'arat-toast-title',
          description: 'arat-toast-description',
          actionButton: 'arat-toast-action',
          cancelButton: 'arat-toast-cancel',
          closeButton: 'arat-toast-close',
        },
      }}
      {...props}
    />
  );
}
