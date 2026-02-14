import { useState, useEffect, useCallback } from 'react';

/**
 * 主题管理 Hook
 * 支持 light / dark / system 三种模式
 */
export function useTheme(initialMode = 'system') {
  const [themeMode, setThemeMode] = useState(initialMode);

  // 根据 themeMode 计算实际主题
  const getEffectiveTheme = useCallback((mode) => {
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode;
  }, []);

  // 应用主题到 DOM
  const applyTheme = useCallback((theme) => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark-mode');
    } else {
      document.documentElement.classList.remove('dark-mode');
    }
  }, []);

  // 当 themeMode 变化时应用
  useEffect(() => {
    applyTheme(getEffectiveTheme(themeMode));
  }, [themeMode, applyTheme, getEffectiveTheme]);

  // 监听系统主题变化
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
