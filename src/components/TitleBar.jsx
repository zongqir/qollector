import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';

function TitleBar({ isAlwaysOnTop, onToggleAlwaysOnTop, onOpenQuickInput }) {
  const { t } = useTranslation();

  return (
    <div className="titlebar">
      <div data-tauri-drag-region className="titlebar-drag-area">
        <div className="titlebar-title">{t('app.title')}</div>
      </div>
      <div className="titlebar-buttons">
        <button
          onClick={onOpenQuickInput}
          className="titlebar-btn quick-add-btn"
          title={t('titlebar.quickAdd')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1V13M1 7H13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>
        <button
          onClick={onToggleAlwaysOnTop}
          className={`titlebar-btn pin-btn ${isAlwaysOnTop ? 'active' : ''}`}
          title={isAlwaysOnTop ? t('titlebar.unpin') : t('titlebar.pin')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 2V8M4 5L7 8L10 5M7 8V12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button
          onClick={async () => {
            const appWindow = getCurrentWindow();
            await appWindow.minimize();
          }}
          className="titlebar-btn minimize-btn"
          title={t('titlebar.minimize')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 7H12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
        <button
          onClick={async () => {
            const appWindow = getCurrentWindow();
            await appWindow.toggleMaximize();
          }}
          className="titlebar-btn maximize-btn"
          title={t('titlebar.maximize')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="2" y="2" width="10" height="10" stroke="currentColor" strokeWidth="1.5" rx="1"/>
          </svg>
        </button>
        <button
          onClick={async () => {
            const appWindow = getCurrentWindow();
            await appWindow.close();
          }}
          className="titlebar-btn close-btn"
          title={t('titlebar.close')}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
