import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import './i18n';

const entryLoadedAt = performance.now();
console.log(`[Startup:frontend] entry_loaded at ${entryLoadedAt.toFixed(1)} ms`);

const app = <App />;

ReactDOM.createRoot(document.getElementById('root')).render(
  import.meta.env.DEV ? app : <React.StrictMode>{app}</React.StrictMode>
);

// Remove splash screen after React renders
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    const splash = document.getElementById('splash-screen');
    if (splash) {
      splash.classList.add('fade-out');
      setTimeout(() => splash.remove(), 300);
    }
  });
});
