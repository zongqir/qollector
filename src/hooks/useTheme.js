import { useState, useEffect, useCallback } from 'react';

const ACCENT_PRESETS = ['blue', 'purple', 'pink', 'red', 'orange', 'yellow', 'green', 'graphite'];

/**
 * Theme + accent color management hook
 * Supports light / dark / system modes and accent color presets
 */
export function useTheme(initialMode = 'system') {
  const [themeMode, setThemeMode] = useState(initialMode);

  const getEffectiveTheme = useCallback((mode) => {
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode;
  }, []);

  const applyTheme = useCallback((theme) => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
    }
  }, []);

  useEffect(() => {
    applyTheme(getEffectiveTheme(themeMode));
  }, [themeMode, applyTheme, getEffectiveTheme]);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (themeMode === 'system') {
        applyTheme(mediaQuery.matches ? 'dark' : 'light');
      }
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [themeMode, applyTheme]);

  return { themeMode, setThemeMode };
}

export function applyAccentColor(color) {
  const el = document.documentElement;
  ACCENT_PRESETS.forEach((c) => el.classList.remove(`accent-${c}`));
  if (color && color !== 'blue') {
    el.classList.add(`accent-${color}`);
  }
}
