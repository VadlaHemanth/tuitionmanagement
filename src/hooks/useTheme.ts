import { useEffect, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';

export function useTheme(initial: ThemePreference = 'light') {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    try {
      const saved = localStorage.getItem('tuitio_theme') as ThemePreference | null;
      if (saved === 'light' || saved === 'dark' || saved === 'system') return saved;
    } catch {
      // ignore
    }
    return initial;
  });

  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');

    const apply = () => {
      const isDark = preference === 'dark' || (preference === 'system' && mq.matches);
      document.documentElement.classList.toggle('dark', isDark);
      setResolvedTheme(isDark ? 'dark' : 'light');
      try {
        localStorage.setItem('tuitio_theme', preference);
      } catch {
        // ignore
      }
    };

    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [preference]);

  return { preference, setPreference, resolvedTheme };
}
