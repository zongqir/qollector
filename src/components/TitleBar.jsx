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
  Rows2,
  Rows3,
  Minimize2,
  Maximize2,
  PanelLeftOpen,
  PanelLeftClose,
  PanelRightOpen,
  PanelRightClose,
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
  onToggleMiniMode,
  layoutPreset,
  onApplyLayoutPreset,
}) {
  const { t } = useTranslation();
  const panelMode = useAppStore(s => s.panelMode);
  const collectionPanelEnabled = useAppStore(s => s.collectionPanelEnabled);
  const historyStreamEnabled = useAppStore(s => s.historyStreamEnabled);
  const toggleCollectionPanel = useAppStore(s => s.toggleCollectionPanel);
  const toggleHistoryStream = useAppStore(s => s.toggleHistoryStream);
  const historyStreamVisible = historyStreamEnabled || !collectionPanelEnabled;

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
      if (!event.shiftKey && !isMiniMode && (key === '1' || key === '2' || key === '3')) {
        event.preventDefault();
        if (key === '1') {
          onApplyLayoutPreset?.('focus');
          return;
        }
        if (key === '2') {
          onApplyLayoutPreset?.('review');
          return;
        }
        onApplyLayoutPreset?.('compare');
        return;
      }
      if (!event.shiftKey) return;
      if (key !== 'd' && key !== 'p' && key !== 'h') return;
      event.preventDefault();
      if (key === 'd') {
        setDensityMode(prev => (prev === DENSITY_COMPACT ? DENSITY_COZY : DENSITY_COMPACT));
        return;
      }
      if (isMiniMode) {
        return;
      }
      if (key === 'p') {
        toggleCollectionPanel();
        return;
      }
      toggleHistoryStream();
    };

    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [isMiniMode, onApplyLayoutPreset, toggleCollectionPanel, toggleHistoryStream]);

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
  const handleTogglePanel = () => {
    if (isMiniMode) return;
    toggleCollectionPanel();
  };
  const handleToggleDensity = () => {
    setDensityMode(prev => (prev === DENSITY_COMPACT ? DENSITY_COZY : DENSITY_COMPACT));
  };

  const modeBadgeText = isMiniMode
    ? t('titlebar.modeMini')
    : (panelMode === 'timeline' ? t('titlebar.modeTimeline') : null);

  return (
    <div className="titlebar" onWheel={handleWheel}>
      <div data-tauri-drag-region className="titlebar-drag-area">
        <div className="titlebar-brand">
          <img
            src="/qollect-logo.svg"
            alt="Qollect logo"
            className="titlebar-logo"
            draggable="false"
          />
          <div className="titlebar-title">{t('app.title')}</div>
          <div className="titlebar-mode-cluster">
            {modeBadgeText && (
              <span className={`titlebar-mode-pill ${isMiniMode ? 'mini' : 'normal'}`}>
                {modeBadgeText}
              </span>
            )}
            {!isMiniMode && (
              <div className="titlebar-layout-presets" role="group" aria-label={t('titlebar.layoutPresetGroup')}>
                <button
                  onClick={() => onApplyLayoutPreset?.('focus')}
                  className={`titlebar-layout-btn ${layoutPreset === 'focus' ? 'active' : ''}`}
                  title={t('titlebar.layoutFocusShortcut')}
                >
                  {t('titlebar.layoutFocusShort')}
                </button>
                <button
                  onClick={() => onApplyLayoutPreset?.('review')}
                  className={`titlebar-layout-btn ${layoutPreset === 'review' ? 'active' : ''}`}
                  title={t('titlebar.layoutReviewShortcut')}
                >
                  {t('titlebar.layoutReviewShort')}
                </button>
                <button
                  onClick={() => onApplyLayoutPreset?.('compare')}
                  className={`titlebar-layout-btn ${layoutPreset === 'compare' ? 'active' : ''}`}
                  title={t('titlebar.layoutCompareShortcut')}
                >
                  {t('titlebar.layoutCompareShort')}
                </button>
              </div>
            )}
          </div>
        </div>
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
      <div className="titlebar-buttons">
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

        <div className="titlebar-btn-group titlebar-btn-group-layout">
          <button
            onClick={handleToggleDensity}
            className={`titlebar-btn density-btn ${densityMode === DENSITY_COMPACT ? 'active' : ''}`}
            title={densityMode === DENSITY_COMPACT ? t('titlebar.switchToCozy') : t('titlebar.switchToCompact')}
          >
            {densityMode === DENSITY_COMPACT ? <Rows2 size={14} /> : <Rows3 size={14} />}
          </button>
          {!isMiniMode && (
            <button
              onClick={toggleHistoryStream}
              className={`titlebar-btn history-btn ${historyStreamVisible ? 'active' : ''}`}
              title={historyStreamVisible ? t('titlebar.hideHistoryShortcut') : t('titlebar.showHistoryShortcut')}
            >
              {historyStreamVisible ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
            </button>
          )}
          {!isMiniMode && (
            <button
              onClick={handleTogglePanel}
              className={`titlebar-btn panel-btn ${collectionPanelEnabled ? 'active' : ''}`}
              title={collectionPanelEnabled ? t('titlebar.hidePanelShortcut') : t('titlebar.showPanelShortcut')}
            >
              {collectionPanelEnabled ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
            </button>
          )}
          <button
            onClick={handleToggleMini}
            className={`titlebar-btn mini-btn ${isMiniMode ? 'active' : ''}`}
            title={isMiniMode ? t('titlebar.exitMini') : t('titlebar.miniMode')}
          >
            {isMiniMode ? <Maximize2 size={14} /> : <Minimize2 size={14} />}
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
