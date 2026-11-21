// テーマ管理フック（auto / light / dark / sleep）

import { useEffect, useState } from 'react';
import { THEME_PALETTES, type ThemePalette } from '../domain/contrast';

export type ActiveThemeMode = 'light' | 'dark' | 'sleep';

export function useTheme(
  preference: 'auto' | 'light' | 'dark',
  isSleepMode: boolean = false
): {
  activeTheme: ActiveThemeMode;
  palette: ThemePalette;
} {
  const [systemDark, setSystemDark] = useState<boolean>(() => {
    if (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
    ) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mql.addEventListener?.('change', handler);
    return () => mql.removeEventListener?.('change', handler);
  }, []);

  const activeTheme: ActiveThemeMode = isSleepMode
    ? 'sleep'
    : preference === 'auto'
      ? systemDark
        ? 'dark'
        : 'light'
      : preference;

  const palette = THEME_PALETTES[activeTheme];

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = activeTheme;
      document.body.style.backgroundColor = palette.background;
      document.body.style.color = palette.text;
      const metaThemeColor = document.querySelector('meta[name="theme-color"]');
      if (metaThemeColor) {
        metaThemeColor.setAttribute('content', palette.background);
      }
    }
  }, [activeTheme, palette]);

  return { activeTheme, palette };
}
