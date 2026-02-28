import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import {
  SquarePen,
  Minus,
  Square,
  SquareSquare,
  X,
  Pin,
  Expand,
  Minimize2,
  PanelLeft,
  PanelRight,
  LayoutGrid,
  Rows2,
  Rows3,
} from 'lucide-react';
import useAppStore from '../store/useAppStore';

const GLASS_STORAGE_KEY = 'qollect-glass-opacity';
const GLASS_DEFAULT = 1.0;
const GLASS_MIN = 0.10;
const GLASS_MAX = 1.0;
const GLASS_STEP = 0.03;
const DENSITY_STORAGE_KEY = 'qollect-density-mode';
const DENSITY_COMPACT = 'compact';
const DENSITY_COZY = 'cozy';

function applyGlassOpacity(value) {
  document.documentElement.style.setProperty('--glass-opacity', value);
}

function TitleBar({
  isAlwaysOnTop,
  onToggleAlwaysOnTop,
  onOpenQuickInput,
  isMiniMode,
  currentViewMode,
  onSelectViewMode,
}) {
  const { t } = useTranslation();
  const panelMode = useAppStore(s => s.panelMode);

  const [glassOpacity, setGlassOpacity] = useState(() => {
    const saved = localStorage.getItem(GLASS_STORAGE_KEY);
    return saved ? parseFloat(saved) : GLASS_DEFAULT;
  });
  const [showIndicator, setShowIndicator] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [densityMode, setDensityMode] = useState(() => {
    const saved = localStorage.getItem(DENSITY_STORAGE_KEY);
    return saved === DENSITY_COMPACT ? DENSITY_COMPACT : DENSITY_COZY;
  });
  const hideTimerRef = useRef(null);

  useEffect(() => {
    applyGlassOpacity(glassOpacity);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('density-compact', densityMode === DENSITY_COMPACT);
    root.classList.toggle('density-cozy', densityMode !== DENSITY_COMPACT);
    localStorage.setItem(DENSITY_STORAGE_KEY, densityMode);
  }, [densityMode]);

  useEffect(() => () => {
    clearTimeout(hideTimerRef.current);
  }, []);

  useEffect(() => {
    const isEditableElement = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      const tagName = target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
      if (target.isContentEditable) return true;
      return Boolean(target.closest('[contenteditable="true"]'));
    };

    const handleShortcut = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isEditableElement(event.target)) return;
      const key = event.key.toLowerCase();
      if (!event.shiftKey && key === 'm') {
        event.preventDefault();
        onSelectViewMode?.(isMiniMode ? 'restore' : 'mini');
        return;
      }
      if (!event.shiftKey && (key === '1' || key === '2' || key === '3')) {
        event.preventDefault();
        if (key === '1') {
          onSelectViewMode?.('left');
          return;
        }
        if (key === '2') {
          onSelectViewMode?.('right');
          return;
        }
        onSelectViewMode?.('all');
        return;
      }
      if (!event.shiftKey) return;
      if (key !== 'd') return;
      event.preventDefault();
      if (key === 'd') {
        setDensityMode(prev => (prev === DENSITY_COMPACT ? DENSITY_COZY : DENSITY_COMPACT));
      }
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [isMiniMode, onSelectViewMode]);

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

  const handleToggleDensity = () => {
    setDensityMode(prev => (prev === DENSITY_COMPACT ? DENSITY_COZY : DENSITY_COMPACT));
  };

  const modeBadgeText = (!isMiniMode && panelMode === 'timeline')
    ? t('titlebar.modeTimeline')
    : null;

  return (
    <div className="titlebar" onWheel={handleWheel}>
      <div className="titlebar-drag-area">
        <div className="titlebar-brand">
          <div data-tauri-drag-region className="titlebar-brand-drag">
            <img
              src="/qollect-logo.svg"
              alt="Qollect logo"
              className="titlebar-logo"
              draggable="false"
            />
            <div className="titlebar-title">{t('app.title')}</div>
          </div>
          <div className="titlebar-mode-cluster">
            {modeBadgeText && (
              <span className={`titlebar-mode-pill ${isMiniMode ? 'mini' : 'normal'}`}>
                {modeBadgeText}
              </span>
            )}
            {isMiniMode && (
              <button
                type="button"
                className="titlebar-mini-flow-btn"
                onClick={() => onSelectViewMode?.('restore')}
                title={t('titlebar.exitMiniRestore')}
                aria-label={t('titlebar.exitMiniRestore')}
                data-tauri-drag-region="false"
              >
                <Expand size={13} strokeWidth={1.9} />
              </button>
            )}
            {!isMiniMode && (
              <>
                <div className="titlebar-layout-presets" role="group" aria-label={t('titlebar.layoutPresetGroup')}>
                  <button
                    type="button"
                    onClick={() => onSelectViewMode?.('mini')}
                    className={`titlebar-layout-btn ${currentViewMode === 'mini' ? 'active' : ''}`}
                    title={t('titlebar.layoutMiniShortcut')}
                    aria-label={t('titlebar.layoutMiniShortcut')}
                  >
                    <Minimize2 size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectViewMode?.('left')}
                    className={`titlebar-layout-btn ${currentViewMode === 'left' ? 'active' : ''}`}
                    title={t('titlebar.layoutFocusShortcut')}
                    aria-label={t('titlebar.layoutFocusShortcut')}
                  >
                    <PanelLeft size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectViewMode?.('right')}
                    className={`titlebar-layout-btn ${currentViewMode === 'right' ? 'active' : ''}`}
                    title={t('titlebar.layoutReviewShortcut')}
                    aria-label={t('titlebar.layoutReviewShortcut')}
                  >
                    <PanelRight size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onSelectViewMode?.('all')}
                    className={`titlebar-layout-btn ${currentViewMode === 'all' ? 'active' : ''}`}
                    title={t('titlebar.layoutAllShortcut')}
                    aria-label={t('titlebar.layoutAllShortcut')}
                  >
                    <LayoutGrid size={13} />
                  </button>
                  <span className="titlebar-layout-separator" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={handleToggleDensity}
                    className={`titlebar-layout-btn titlebar-layout-density-btn ${densityMode === DENSITY_COMPACT ? 'active' : ''}`}
                    title={densityMode === DENSITY_COMPACT ? t('titlebar.switchToCozy') : t('titlebar.switchToCompact')}
                    aria-label={densityMode === DENSITY_COMPACT ? t('titlebar.switchToCozy') : t('titlebar.switchToCompact')}
                  >
                    {densityMode === DENSITY_COMPACT ? <Rows2 size={13} /> : <Rows3 size={13} />}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div data-tauri-drag-region className="titlebar-drag-hitbox" aria-hidden="true" />
      </div>
      <div className={`titlebar-status-group ${showIndicator && !isMiniMode ? 'visible' : ''}`}>
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
      </div>
      <div className="titlebar-buttons" data-tauri-drag-region="false">
        <div className="titlebar-btn-group titlebar-btn-group-capture">
          <button
            onClick={onOpenQuickInput}
            className="titlebar-btn quick-add-btn"
            title={t('titlebar.quickAdd')}
          >
            <SquarePen size={15} />
          </button>
        </div>
        <span className="titlebar-btn-divider" aria-hidden="true" />

        <div className="titlebar-btn-group titlebar-btn-group-window">
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
    </div>
  );
}

export default TitleBar;
