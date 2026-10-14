import './mocks/browserTauriMock';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

console.log('[Perf:main] Imports complete, loading CSS at', performance.now().toFixed(1), 'ms');
import './styles/index.css';
console.log('[Perf:main] CSS loaded, loading i18n at', performance.now().toFixed(1), 'ms');
import './i18n';
console.log('[Perf:main] i18n loaded, importing Tauri API at', performance.now().toFixed(1), 'ms');
import { getCurrentWindow } from '@tauri-apps/api/window';

import useAppStore from './store/useAppStore';

if (typeof window !== 'undefined') {
  window.__QOLLECT_STORE__ = useAppStore;
}

console.log('[Perf:main] All imports complete at', performance.now().toFixed(1), 'ms');
console.log('[Perf:main] main.jsx executing at', performance.now().toFixed(1), 'ms');

const entryLoadedAt = performance.now();
console.log(`[Perf:main] entry_loaded at ${entryLoadedAt.toFixed(1)} ms`);

const app = <App />;

console.log('[Perf:main] starting React render at', performance.now().toFixed(1), 'ms');

ReactDOM.createRoot(document.getElementById('root')).render(
  import.meta.env.DEV ? app : <React.StrictMode>{app}</React.StrictMode>
);

console.log('[Perf:main] React render initiated at', performance.now().toFixed(1), 'ms');

// Remove splash screen and show window after React renders
requestAnimationFrame(() => {
  requestAnimationFrame(async () => {
    console.log('[Startup:frontend] RAF callback at', performance.now().toFixed(1), 'ms');

    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => splash.remove(), 300);
    }

    // Show window after content is ready
    try {
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.setFocus();
      console.log('[Startup:frontend] window shown at', performance.now().toFixed(1), 'ms');
    } catch (error) {
      console.error('[Startup:frontend] failed to show window:', error);
    }
  });
});
