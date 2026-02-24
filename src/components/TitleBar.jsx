import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import { SquarePen, Minus, Square, SquareSquare, X, Pin, Shrink, Expand } from 'lucide-react';

const GLASS_STORAGE_KEY = 'clipbox-glass-opacity';
const GLASS_DEFAULT = 1.0;
const GLASS_MIN = 0.10;
const GLASS_MAX = 1.0;
const GLASS_STEP = 0.03;

function applyGlassOpacity(value) {
  document.documentElement.style.setProperty('--glass-opacity', value);
}

function TitleBar({ isAlwaysOnTop, onToggleAlwaysOnTop, onOpenQuickInput, isMiniMode, onToggleMiniMode }) {
  const { t } = useTranslation();

  const [glassOpacity, setGlassOpacity] = useState(() => {
    const saved = localStorage.getItem(GLASS_STORAGE_KEY);
    return saved ? parseFloat(saved) : GLASS_DEFAULT;
  });
  const [showIndicator, setShowIndicator] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const hideTimerRef = useRef(null);

  useEffect(() => {
    applyGlassOpacity(glassOpacity);
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlistenResize = null;

    const syncMaximizeState = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        setIsMaximized(maximized);
      } catch {
      }
    };

    void syncMaximizeState();
    appWindow.onResized(() => {
      void syncMaximizeState();
    }).then(unlisten => {
      unlistenResize = unlisten;
    }).catch(() => {
      unlistenResize = null;
    });

    return () => {
      if (typeof unlistenResize === 'function') {
        unlistenResize();
      }
    };
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    setGlassOpacity(prev => {
      const delta = e.deltaY > 0 ? -GLASS_STEP : GLASS_STEP;
      const next = Math.round(Math.min(Math.max(prev + delta, GLASS_MIN), GLASS_MAX) * 100) / 100;
      applyGlassOpacity(next);
      localStorage.setItem(GLASS_STORAGE_KEY, next);
      return next;
    });
    setShowIndicator(true);
    clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setShowIndicator(false), 800);
  }, []);

  const handleToggleMini = () => {
    onToggleMiniMode();
  };

  return (
    <div className="titlebar" onWheel={handleWheel}>
      <div data-tauri-drag-region className="titlebar-drag-area">
        <div className="titlebar-brand">
          <img
            src="/clipbox-logo.svg"
            alt="PasteHarbor logo"
            className="titlebar-logo"
            draggable="false"
          />
          <div className="titlebar-title">{t('app.title')}</div>
        </div>
      </div>
      {showIndicator && !isMiniMode && (
        <div className="glass-indicator">
          <div className="glass-indicator-track">
            <div
              className="glass-indicator-fill"
              style={{ width: `${((glassOpacity - GLASS_MIN) / (GLASS_MAX - GLASS_MIN)) * 100}%` }}
            />
          </div>
          <span className="glass-indicator-value">{Math.round(glassOpacity * 100)}%</span>
        </div>
      )}
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
          <Minus size={14} />
        </button>
        {!isMiniMode && (
          <button
            onClick={async () => {
              const appWindow = getCurrentWindow();
              const nextMaximized = !isMaximized;
              setIsMaximized(nextMaximized);
              try {
                await appWindow.toggleMaximize();
              } catch {
                setIsMaximized(!nextMaximized);
              }
            }}
            className="titlebar-btn maximize-btn"
            title={isMaximized ? t('titlebar.restore') : t('titlebar.maximize')}
          >
            {isMaximized ? <SquareSquare size={14} /> : <Square size={14} />}
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
