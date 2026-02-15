import { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import useAppStore from './store/useAppStore';
import { useTheme } from './hooks/useTheme';
import { openQuickInputWindow } from './services/windowService';
import { QUICK_NOTE_SAVED_EVENT } from './services/quickNoteService';
import DragDrop from './DragDrop';
import TitleBar from './components/TitleBar';
import HistoryStream from './components/HistoryStream';
import PolymorphicPanel from './components/Panel';

const Settings = lazy(() => import('./Settings'));
const LockScreen = lazy(() => import('./LockScreen'));
const EditModal = lazy(() => import('./EditModal'));

function App() {
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

  // Store actions
  const loadItems = useAppStore(s => s.loadItems);
  const loadConfigs = useAppStore(s => s.loadConfigs);
  const setShowSettings = useAppStore(s => s.setShowSettings);
  const setIsLocked = useAppStore(s => s.setIsLocked);
  const setIsAlwaysOnTop = useAppStore(s => s.setIsAlwaysOnTop);
  const setIsMiniMode = useAppStore(s => s.setIsMiniMode);
  const setPinBeforeMini = useAppStore(s => s.setPinBeforeMini);
  const pinBeforeMini = useAppStore(s => s.pinBeforeMini);
  const setThemeMode = useAppStore(s => s.setThemeMode);
  const setSelectedType = useAppStore(s => s.setSelectedType);
  const handleEditModalSave = useAppStore(s => s.handleEditModalSave);
  const handleEditModalCancel = useAppStore(s => s.handleEditModalCancel);

  // Theme
  const { setThemeMode: applyTheme } = useTheme(themeMode);
  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode, applyTheme]);

  // 初始化
  useEffect(() => {
    loadItems();
    loadConfigs();

    const unlistenClipboardPromise = listen('clipboard-changed', () => {
      loadItems();
    });
    const unlistenQuickInputPromise = listen(QUICK_NOTE_SAVED_EVENT, () => {
      loadItems();
    });

    return () => {
      unlistenClipboardPromise.then(unlisten => unlisten());
      unlistenQuickInputPromise.then(unlisten => unlisten());
    };
  }, []);

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

  // Mini 模式
  const MINI_THRESHOLD = 450;

  const setMiniMode = async (enterMini) => {
    if (enterMini === isMiniMode) return;
    const appWindow = getCurrentWindow();
    if (enterMini) {
      setPinBeforeMini(isAlwaysOnTop);
      if (!isAlwaysOnTop) {
        await appWindow.setAlwaysOnTop(true);
        setIsAlwaysOnTop(true);
      }
    } else {
      if (!pinBeforeMini && isAlwaysOnTop) {
        await appWindow.setAlwaysOnTop(false);
        setIsAlwaysOnTop(false);
      }
    }
    setIsMiniMode(enterMini);
  };

  useEffect(() => {
    const handleResize = () => {
      const width = window.innerWidth;
      if (width <= MINI_THRESHOLD && !isMiniMode) {
        setMiniMode(true);
      } else if (width > MINI_THRESHOLD && isMiniMode) {
        setMiniMode(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMiniMode, isAlwaysOnTop, pinBeforeMini]);

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

  // 拖入文件后切换类型
  const handleTypeAdded = (type) => {
    setSelectedType(type);
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
      <DragDrop onItemAdded={loadItems} onTypeAdded={handleTypeAdded} />

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
        <HistoryStream style={{ width: isMiniMode ? '100%' : `${leftWidth}px` }} />
        {!isMiniMode && (
          <>
            <div className="resize-handle" onMouseDown={handleResizeStart} />
            <PolymorphicPanel />
          </>
        )}
      </div>
    </div>
  );
}

export default App;
