import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import './i18n';
import { getCurrentWindow } from '@tauri-apps/api/window';

const entryLoadedAt = performance.now();
console.log(`[Startup:frontend] entry_loaded at ${entryLoadedAt.toFixed(1)} ms`);

const app = <App />;

ReactDOM.createRoot(document.getElementById('root')).render(
  import.meta.env.DEV ? app : <React.StrictMode>{app}</React.StrictMode>
);

// Remove splash screen and show window after React renders
requestAnimationFrame(() => {
  requestAnimationFrame(async () => {
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
      console.log('[Startup:frontend] window shown');
    } catch (error) {
      console.error('[Startup:frontend] failed to show window:', error);
    }
  });
});
