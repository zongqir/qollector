import { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import useAppStore from './store/useAppStore';
import { useTheme } from './hooks/useTheme';
import { openQuickInputWindow, openWidgetWindow, closeWidgetWindow } from './services/windowService';
import { QUICK_NOTE_SAVED_EVENT } from './services/quickNoteService';
import DragDrop from './DragDrop';
import TitleBar from './components/TitleBar';
import HistoryStream from './components/HistoryStream';
import PolymorphicPanel from './components/Panel';
import HoverPreview from './components/HoverPreview';

console.log('[Perf:App] Component definition loaded at', performance.now().toFixed(1), 'ms');

const Settings = lazy(() => import('./Settings'));
const LockScreen = lazy(() => import('./LockScreen'));
const EditModal = lazy(() => import('./EditModal'));
const ShareModal = lazy(() => import('./components/ShareModal/ShareModal'));

const NORMAL_SIZE = { width: 800, height: 600 };
const MINI_SIZE = { width: 320, height: 450 };
const WINDOW_MODE_STORAGE_KEY = 'clipbox-window-mode';
const WINDOW_MODE_MINI = 'mini';
const WINDOW_MODE_NORMAL = 'normal';

function App() {
  console.log('[Perf:App] App() function called at', performance.now().toFixed(1), 'ms');

  const { t } = useTranslation();

  // Store state
  const isLocked = useAppStore(s => s.isLocked);
  const hasPassword = useAppStore(s => s.hasPassword);
  const showSettings = useAppStore(s => s.showSettings);
  const showEditModal = useAppStore(s => s.showEditModal);
  const editingItem = useAppStore(s => s.editingItem);
  const editModalMode = useAppStore(s => s.editModalMode);
  const isAlwaysOnTop = useAppStore(s => s.isAlwaysOnTop);
  const isMiniMode = useAppStore(s => s.isMiniMode);
  const themeMode = useAppStore(s => s.themeMode);
  const collectionPanelEnabled = useAppStore(s => s.collectionPanelEnabled);
  const lowMemoryModeEnabled = useAppStore(s => s.lowMemoryModeEnabled);
  const widgetEnabled = useAppStore(s => s.widgetEnabled);
  const shouldUseHoverPreview = isMiniMode || !collectionPanelEnabled;

  // Store actions
  const loadItems = useAppStore(s => s.loadItems);
  const loadConfigs = useAppStore(s => s.loadConfigs);
  const setShowSettings = useAppStore(s => s.setShowSettings);
  const setIsLocked = useAppStore(s => s.setIsLocked);
  const setIsAlwaysOnTop = useAppStore(s => s.setIsAlwaysOnTop);
  const setIsMiniMode = useAppStore(s => s.setIsMiniMode);
  const setCollectionPanelBeforeMini = useAppStore(s => s.setCollectionPanelBeforeMini);
  const collectionPanelBeforeMini = useAppStore(s => s.collectionPanelBeforeMini);
  const setCollectionPanelEnabled = useAppStore(s => s.setCollectionPanelEnabled);
  const setThemeMode = useAppStore(s => s.setThemeMode);
  const setSelectedType = useAppStore(s => s.setSelectedType);
  const handleEditModalSave = useAppStore(s => s.handleEditModalSave);
  const handleEditModalCancel = useAppStore(s => s.handleEditModalCancel);
  const suspendForMinimize = useAppStore(s => s.suspendForMinimize);
  const resumeFromMinimize = useAppStore(s => s.resumeFromMinimize);

  // Share state
  const shareModalItem = useAppStore(s => s.shareModalItem);
  const shareResult = useAppStore(s => s.shareResult);
  const shareLoading = useAppStore(s => s.shareLoading);
  const shareError = useAppStore(s => s.shareError);
  const closeShareModal = useAppStore(s => s.closeShareModal);
  const retryShare = useAppStore(s => s.retryShare);
  const [initialWindowModeReady, setInitialWindowModeReady] = useState(false);

  // Theme
  const { setThemeMode: applyTheme } = useTheme(themeMode);
  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode, applyTheme]);

  // 初始化
  useEffect(() => {
    console.log('[Perf:App] Init useEffect START at', performance.now().toFixed(1), 'ms');

    console.log('[Perf:App] Calling loadItems() at', performance.now().toFixed(1), 'ms');
    loadItems();

    console.log('[Perf:App] Calling loadConfigs() at', performance.now().toFixed(1), 'ms');
    loadConfigs();

    console.log('[Perf:App] Setting up event listeners at', performance.now().toFixed(1), 'ms');
    const unlistenClipboardPromise = listen('clipboard-changed', () => {
      loadItems();
    });
    const unlistenQuickInputPromise = listen(QUICK_NOTE_SAVED_EVENT, () => {
      loadItems();
    });
    const unlistenOpenSettingsPromise = listen('open-settings', () => {
      setShowSettings(true);
    });

    console.log('[Perf:App] Init useEffect COMPLETE at', performance.now().toFixed(1), 'ms');

    return () => {
      unlistenClipboardPromise.then(unlisten => unlisten());
      unlistenQuickInputPromise.then(unlisten => unlisten());
      unlistenOpenSettingsPromise.then(unlisten => unlisten());
    };
  }, []);

  // Widget window lifecycle driven by config
  useEffect(() => {
    if (widgetEnabled) {
      openWidgetWindow().catch(err => console.warn('widget launch failed:', err));
    } else {
      closeWidgetWindow().catch(err => console.warn('widget close failed:', err));
    }
  }, [widgetEnabled]);

  useEffect(() => {
    let raf1 = 0;
    let raf2 = 0;

    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(async () => {
        const frontendReadyAt = performance.now();
        console.log(`[Startup:frontend] first_interactive at ${frontendReadyAt.toFixed(1)} ms`);

        try {
          const metrics = await invoke('get_startup_metrics');
          const frontendReadyUnixMs = Math.round(performance.timeOrigin + frontendReadyAt);
          const processToFrontendReadyMs =
            frontendReadyUnixMs - Number(metrics.processStartedAtUnixMs || 0);

          console.log('[Startup:e2e] backend_metrics', metrics);
          console.log(
            `[Startup:e2e] process_to_frontend_ready ${processToFrontendReadyMs} ms`
          );
        } catch (error) {
          console.warn('[Startup:e2e] failed to fetch backend metrics:', error);
        }
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, []);

  useEffect(() => {
    const isWindowsRuntime = navigator.userAgent.toLowerCase().includes('windows');
    if (!isWindowsRuntime) return;

    if (!lowMemoryModeEnabled) {
      resumeFromMinimize().catch((error) => {
        console.error('[MemorySuspend] resume check failed:', error);
      });
      return;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        suspendForMinimize();
        return;
      }

      resumeFromMinimize().catch((error) => {
        console.error('[MemorySuspend] resume failed:', error);
      });
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [lowMemoryModeEnabled, suspendForMinimize, resumeFromMinimize]);

  // Mini 模式
  const MINI_THRESHOLD = 450;
  const PANEL_CLOSE_THRESHOLD = 350;

  const setMiniMode = async (enterMini) => {
    if (enterMini === isMiniMode) return;
    const appWindow = getCurrentWindow();
    const targetSize = enterMini ? MINI_SIZE : NORMAL_SIZE;
    await appWindow.setSize(new LogicalSize(targetSize.width, targetSize.height));
    localStorage.setItem(
      WINDOW_MODE_STORAGE_KEY,
      enterMini ? WINDOW_MODE_MINI : WINDOW_MODE_NORMAL
    );
    setIsMiniMode(enterMini);
  };

  useEffect(() => {
    let cancelled = false;

    const applyInitialWindowMode = async () => {
      const storedWindowMode = localStorage.getItem(WINDOW_MODE_STORAGE_KEY);
      const mode = storedWindowMode === WINDOW_MODE_NORMAL ? WINDOW_MODE_NORMAL : WINDOW_MODE_MINI;
      const enterMini = mode === WINDOW_MODE_MINI;
      const targetSize = enterMini ? MINI_SIZE : NORMAL_SIZE;

      try {
        const appWindow = getCurrentWindow();
        await appWindow.setSize(new LogicalSize(targetSize.width, targetSize.height));
        if (!cancelled) {
          setIsMiniMode(enterMini);
        }
      } catch (error) {
        console.error('failed to apply initial window mode:', error);
      } finally {
        if (!cancelled) {
          setInitialWindowModeReady(true);
        }
      }
    };

    applyInitialWindowMode();

    return () => {
      cancelled = true;
    };
  }, [setIsMiniMode]);

  useEffect(() => {
    if (!initialWindowModeReady) return undefined;

    const handleResize = () => {
      const width = window.innerWidth;

      // Handle panel auto-close/restore
      if (width <= PANEL_CLOSE_THRESHOLD && collectionPanelEnabled) {
        // Save current state and close panel
        setCollectionPanelBeforeMini(true);
        setCollectionPanelEnabled(false);
      } else if (width > PANEL_CLOSE_THRESHOLD && collectionPanelBeforeMini === true && !collectionPanelEnabled) {
        // Restore panel when window gets bigger
        setCollectionPanelEnabled(true);
        setCollectionPanelBeforeMini(null);
      }

      // Handle mini mode
      if (width <= MINI_THRESHOLD && !isMiniMode) {
        setMiniMode(true);
      } else if (width > MINI_THRESHOLD && isMiniMode) {
        setMiniMode(false);
      }
    };
    // Apply once on startup so initial layout does not wait for a manual resize.
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [initialWindowModeReady, isMiniMode, collectionPanelEnabled, collectionPanelBeforeMini]);

  // 窗口置顶
  const toggleWindowAlwaysOnTop = async () => {
    try {
      const appWindow = getCurrentWindow();
      const newState = !isAlwaysOnTop;
      await appWindow.setAlwaysOnTop(newState);
      setIsAlwaysOnTop(newState);
    } catch (error) {
      console.error(t('error.toggleWindowPinFailed', { error }));
    }
  };

  // ========== 分割线拖拽 ==========
  const [leftWidth, setLeftWidth] = useState(340);
  const isDraggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = leftWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [leftWidth]);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingRef.current) return;
      const delta = e.clientX - startXRef.current;
      const newWidth = Math.min(Math.max(startWidthRef.current + delta, 220), 600);
      setLeftWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  if (isLocked && hasPassword) {
    return (
      <Suspense fallback={null}>
        <LockScreen onUnlock={() => setIsLocked(false)} />
      </Suspense>
    );
  }

  return (
    <div className={`app ${isMiniMode ? 'mini-mode' : ''}`}>
      {showSettings && (
        <Suspense fallback={null}>
          <Settings
            onClose={() => setShowSettings(false)}
            themeMode={themeMode}
            onThemeModeChange={setThemeMode}
            onConfigChange={loadConfigs}
          />
        </Suspense>
      )}
      <DragDrop onItemAdded={loadItems} />

      {showEditModal && (
        <Suspense fallback={null}>
          <EditModal
            item={editingItem}
            mode={editModalMode}
            isMiniMode={isMiniMode}
            onSave={handleEditModalSave}
            onCancel={handleEditModalCancel}
          />
        </Suspense>
      )}

      {shareModalItem && (
        <Suspense fallback={null}>
          <ShareModal
            item={shareModalItem}
            shareResult={shareResult}
            shareLoading={shareLoading}
            shareError={shareError}
            onClose={closeShareModal}
            onRetry={retryShare}
          />
        </Suspense>
      )}

      <TitleBar
        isAlwaysOnTop={isAlwaysOnTop}
        onToggleAlwaysOnTop={toggleWindowAlwaysOnTop}
        onOpenQuickInput={() => {
          openQuickInputWindow(t).catch((error) => {
            console.error(t('quickInput.failed', { error }));
          });
        }}
        isMiniMode={isMiniMode}
        onToggleMiniMode={() => setMiniMode(!isMiniMode)}
      />

      <div className="workspace">
        <HistoryStream style={{ width: isMiniMode || !collectionPanelEnabled ? '100%' : `${leftWidth}px` }} />
        {!isMiniMode && collectionPanelEnabled && (
          <>
            <div className="resize-handle" onMouseDown={handleResizeStart} />
            <PolymorphicPanel />
          </>
        )}
      </div>
      {shouldUseHoverPreview && <HoverPreview />}
    </div>
  );
}

export default App;
