import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { useTranslation } from 'react-i18next';
import { SquarePen, Minimize2, Maximize2, X, Pin, Shrink, Expand } from 'lucide-react';

const NORMAL_SIZE = { width: 800, height: 600 };
const MINI_SIZE = { width: 320, height: 450 };

function TitleBar({ isAlwaysOnTop, onToggleAlwaysOnTop, onOpenQuickInput, isMiniMode, onToggleMiniMode }) {
  const { t } = useTranslation();

  const handleToggleMini = async () => {
    const appWindow = getCurrentWindow();
    const nextMini = !isMiniMode;
    const size = nextMini ? MINI_SIZE : NORMAL_SIZE;
    await appWindow.setSize(new LogicalSize(size.width, size.height));
    onToggleMiniMode();
  };

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
          <SquarePen size={15} />
        </button>
        <button
          onClick={handleToggleMini}
          className={`titlebar-btn mini-btn ${isMiniMode ? 'active' : ''}`}
          title={isMiniMode ? t('titlebar.exitMini') : t('titlebar.miniMode')}
        >
          {isMiniMode ? <Expand size={14} /> : <Shrink size={14} />}
        </button>
        <button
          onClick={onToggleAlwaysOnTop}
          className={`titlebar-btn pin-btn ${isAlwaysOnTop ? 'active' : ''}`}
          title={isAlwaysOnTop ? t('titlebar.unpin') : t('titlebar.pin')}
        >
          <Pin size={14} />
        </button>
        <button
          onClick={async () => {
            const appWindow = getCurrentWindow();
            await appWindow.minimize();
          }}
          className="titlebar-btn minimize-btn"
          title={t('titlebar.minimize')}
        >
          <Minimize2 size={14} />
        </button>
        {!isMiniMode && (
          <button
            onClick={async () => {
              const appWindow = getCurrentWindow();
              await appWindow.toggleMaximize();
            }}
            className="titlebar-btn maximize-btn"
            title={t('titlebar.maximize')}
          >
            <Maximize2 size={14} />
          </button>
        )}
        <button
          onClick={async () => {
            const appWindow = getCurrentWindow();
            await appWindow.close();
          }}
          className="titlebar-btn close-btn"
          title={t('titlebar.close')}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

export default TitleBar;
