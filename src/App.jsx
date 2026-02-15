import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useTranslation } from 'react-i18next';
import useAppStore from './store/useAppStore';
import { useTheme } from './hooks/useTheme';
import { initOcrService } from './services/ocrService';
import Settings from './Settings';
import LockScreen from './LockScreen';
import DragDrop from './DragDrop';
import EditModal from './EditModal';
import TitleBar from './components/TitleBar';
import HistoryStream from './components/HistoryStream';
import PolymorphicPanel from './components/Panel';

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
  const openEditModal = useAppStore(s => s.openEditModal);

  // Theme
  const { setThemeMode: applyTheme } = useTheme(themeMode);
  useEffect(() => {
    applyTheme(themeMode);
  }, [themeMode, applyTheme]);

  // 初始化
  useEffect(() => {
    loadItems();
    initOcrService();
    loadConfigs();

    const unlistenPromise = listen('clipboard-changed', () => {
      loadItems();
    });

    return () => {
      unlistenPromise.then(unlisten => unlisten());
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

  if (isLocked && hasPassword) {
    return <LockScreen onUnlock={() => setIsLocked(false)} />;
  }

  return (
    <div className={`app ${isMiniMode ? 'mini-mode' : ''}`}>
      {showSettings && (
        <Settings
          onClose={() => setShowSettings(false)}
          themeMode={themeMode}
          onThemeModeChange={setThemeMode}
          onConfigChange={loadConfigs}
        />
      )}
      <DragDrop onItemAdded={loadItems} onTypeAdded={handleTypeAdded} />

      {showEditModal && (
        <EditModal
          item={editingItem}
          mode={editModalMode}
          onSave={handleEditModalSave}
          onCancel={handleEditModalCancel}
        />
      )}

      <TitleBar
        isAlwaysOnTop={isAlwaysOnTop}
        onToggleAlwaysOnTop={toggleWindowAlwaysOnTop}
        onOpenQuickInput={() => openEditModal()}
        isMiniMode={isMiniMode}
        onToggleMiniMode={() => setMiniMode(!isMiniMode)}
      />

      <div className="workspace">
        <HistoryStream />
        {!isMiniMode && <PolymorphicPanel />}
      </div>
    </div>
  );
}

export default App;