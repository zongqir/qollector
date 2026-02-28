import { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
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
import GuidedTour from './components/GuidedTour/GuidedTour';
import ShortcutHelpOverlay from './components/ShortcutHelpOverlay';

console.log('[Perf:App] Component definition loaded at', performance.now().toFixed(1), 'ms');

const Settings = lazy(() => import('./Settings'));
const LockScreen = lazy(() => import('./LockScreen'));
const EditModal = lazy(() => import('./EditModal'));
const ShareModal = lazy(() => import('./components/ShareModal/ShareModal'));

const NORMAL_SIZE = { width: 800, height: 600 };
const MINI_SIZE = { width: 320, height: 450 };
const WINDOW_MODE_STORAGE_KEY = 'qollect-window-mode';
const WINDOW_MODE_MINI = 'mini';
const WINDOW_MODE_NORMAL = 'normal';
const LAYOUT_PRESET_STORAGE_KEY = 'qollect-layout-preset';
const LAYOUT_PRESET_WIDTHS_STORAGE_KEY = 'qollect-layout-preset-widths';
const LAYOUT_PRESET_FLOW = 'focus';
const LAYOUT_PRESET_DETAIL = 'review';
const LAYOUT_PRESET_DEFAULT = LAYOUT_PRESET_DETAIL;
const VIEW_MODE_MINI = 'mini';
const VIEW_MODE_LEFT = 'left';
const VIEW_MODE_RIGHT = 'right';
const VIEW_MODE_ALL = 'all';
const VIEW_MODE_RESTORE = 'restore';
const LAYOUT_PRESET_DEFAULT_WIDTHS = {
  [LAYOUT_PRESET_FLOW]: 360,
  [LAYOUT_PRESET_DETAIL]: 340,
};

const isValidLayoutPreset = (preset) => (
  preset === LAYOUT_PRESET_FLOW
  || preset === LAYOUT_PRESET_DETAIL
);

const clampHistoryWidth = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return LAYOUT_PRESET_DEFAULT_WIDTHS[LAYOUT_PRESET_DEFAULT];
  return Math.min(Math.max(Math.round(parsed), 220), 600);
};

const readLayoutPreset = () => {
  if (typeof window === 'undefined') return LAYOUT_PRESET_DEFAULT;
  try {
    const raw = localStorage.getItem(LAYOUT_PRESET_STORAGE_KEY);
    if (!isValidLayoutPreset(raw)) return LAYOUT_PRESET_DEFAULT;
    return raw;
  } catch (error) {
    console.warn('[LayoutPreset] read preset failed:', error);
    return LAYOUT_PRESET_DEFAULT;
  }
};

const readLayoutPresetWidths = () => {
  const defaults = { ...LAYOUT_PRESET_DEFAULT_WIDTHS };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(LAYOUT_PRESET_WIDTHS_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return defaults;
    const next = { ...defaults };
    if (parsed[LAYOUT_PRESET_FLOW] != null) {
      next[LAYOUT_PRESET_FLOW] = clampHistoryWidth(parsed[LAYOUT_PRESET_FLOW]);
    }
    if (parsed[LAYOUT_PRESET_DETAIL] != null) {
      next[LAYOUT_PRESET_DETAIL] = clampHistoryWidth(parsed[LAYOUT_PRESET_DETAIL]);
    }
    return next;
  } catch (error) {
    console.warn('[LayoutPreset] read widths failed:', error);
    return defaults;
  }
};

const persistLayoutPreset = (preset) => {
  if (typeof window === 'undefined' || !isValidLayoutPreset(preset)) return;
  try {
    localStorage.setItem(LAYOUT_PRESET_STORAGE_KEY, preset);
  } catch (error) {
    console.warn('[LayoutPreset] persist preset failed:', error);
  }
};

const persistLayoutPresetWidths = (widths) => {
  if (typeof window === 'undefined' || !widths) return;
  try {
    localStorage.setItem(LAYOUT_PRESET_WIDTHS_STORAGE_KEY, JSON.stringify(widths));
  } catch (error) {
    console.warn('[LayoutPreset] persist widths failed:', error);
  }
};

function App() {
  console.log('[Perf:App] App() function called at', performance.now().toFixed(1), 'ms');

  const { t } = useTranslation();
  const appFeedbackTimerRef = useRef(null);

  // Beta expiry state
  const [betaExpired, setBetaExpired] = useState(false);
  const [betaStatus, setBetaStatus] = useState(null);
  const [appFeedback, setAppFeedback] = useState(null);

  // Update state
  const [updateInfo, setUpdateInfo] = useState(null); // { version, update }
  const [updateProgress, setUpdateProgress] = useState(null); // null | number (0-100) | 'ready'
  const [updateError, setUpdateError] = useState(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);

  const showAppFeedback = useCallback((text, type = 'info', duration = 1200) => {
    if (!text) return;
    setAppFeedback({ type, text });
    if (appFeedbackTimerRef.current) {
      clearTimeout(appFeedbackTimerRef.current);
    }
    appFeedbackTimerRef.current = setTimeout(() => {
      setAppFeedback(null);
      appFeedbackTimerRef.current = null;
    }, duration);
  }, []);

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
  const historyStreamEnabled = useAppStore(s => s.historyStreamEnabled);
  const lowMemoryModeEnabled = useAppStore(s => s.lowMemoryModeEnabled);
  const widgetEnabled = useAppStore(s => s.widgetEnabled);
  const copiedItemId = useAppStore(s => s.copiedItemId);
  const copyFeedbackSource = useAppStore(s => s.copyFeedbackSource);
  const copyFeedbackToken = useAppStore(s => s.copyFeedbackToken);
  const lastCopyWasAutoPaste = useAppStore(s => s.lastCopyWasAutoPaste);
  const shouldUseHoverPreview = isMiniMode || !collectionPanelEnabled;
  const showHistoryStream = isMiniMode || historyStreamEnabled || !collectionPanelEnabled;

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
  const setHistoryStreamEnabled = useAppStore(s => s.setHistoryStreamEnabled);
  const setThemeMode = useAppStore(s => s.setThemeMode);
  const setSelectedType = useAppStore(s => s.setSelectedType);
  const handleEditModalSave = useAppStore(s => s.handleEditModalSave);
  const handleEditModalCancel = useAppStore(s => s.handleEditModalCancel);
  const suspendForMinimize = useAppStore(s => s.suspendForMinimize);
  const resumeFromMinimize = useAppStore(s => s.resumeFromMinimize);

  // Tour state
  const tourActive = useAppStore(s => s.tourActive);
  const startTour = useAppStore(s => s.startTour);

  // Share state
  const shareModalItem = useAppStore(s => s.shareModalItem);
  const shareResult = useAppStore(s => s.shareResult);
  const shareLoading = useAppStore(s => s.shareLoading);
  const shareError = useAppStore(s => s.shareError);
  const sharePendingConfirm = useAppStore(s => s.sharePendingConfirm);
  const sharePendingProvider = useAppStore(s => s.sharePendingProvider);
  const closeShareModal = useAppStore(s => s.closeShareModal);
  const retryShare = useAppStore(s => s.retryShare);
  const confirmShareUpload = useAppStore(s => s.confirmShareUpload);
  const switchShareProvider = useAppStore(s => s.switchShareProvider);
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

    // Auto-start guided tour for first-time users
    let tourTimer = null;
    if (!localStorage.getItem('qollect-tour-completed')) {
      tourTimer = setTimeout(() => startTour(), 1500);
    }

    return () => {
      if (tourTimer) clearTimeout(tourTimer);
      unlistenClipboardPromise.then(unlisten => unlisten());
      unlistenQuickInputPromise.then(unlisten => unlisten());
      unlistenOpenSettingsPromise.then(unlisten => unlisten());
    };
  }, []);

  // Beta expiry check
  useEffect(() => {
    invoke('get_beta_status').then(status => {
      setBetaStatus(status);
      if (status.expired) setBetaExpired(true);
    }).catch(err => console.warn('[BetaGuard] failed to get status:', err));

    const unlistenBetaExpired = listen('beta-expired', (event) => {
      setBetaStatus(event.payload);
      setBetaExpired(true);
    });

    return () => {
      unlistenBetaExpired.then(unlisten => unlisten());
    };
  }, []);

  // Update check logic
  const checkForUpdate = useCallback(async (silent = false) => {
    if (!silent) setUpdateChecking(true);
    setUpdateError(null);
    try {
      const update = await check();
      if (update) {
        setUpdateInfo({ version: update.version, update });
      } else if (!silent) {
        // No update available — briefly show "up to date" then clear
        setUpdateInfo(null);
        setUpdateProgress('upToDate');
        setTimeout(() => setUpdateProgress(null), 3000);
      }
    } catch (err) {
      console.warn('[Updater] check failed:', err);
      if (!silent) setUpdateError(String(err));
    } finally {
      if (!silent) setUpdateChecking(false);
    }
  }, []);

  const downloadAndInstall = useCallback(async () => {
    if (!updateInfo?.update) return;
    setUpdateProgress(0);
    setUpdateError(null);
    try {
      await updateInfo.update.downloadAndInstall((event) => {
        if (event.event === 'Started' && event.data?.contentLength) {
          setUpdateProgress(0);
        } else if (event.event === 'Progress') {
          setUpdateProgress((prev) => {
            const current = typeof prev === 'number' ? prev : 0;
            const chunk = event.data?.chunkLength || 0;
            const total = event.data?.contentLength || 1;
            return Math.min(current + (chunk / total) * 100, 99);
          });
        } else if (event.event === 'Finished') {
          setUpdateProgress('ready');
        }
      });
      setUpdateProgress('ready');
    } catch (err) {
      console.error('[Updater] download failed:', err);
      setUpdateError(String(err));
      setUpdateProgress(null);
    }
  }, [updateInfo]);

  // Auto-check for updates 3s after startup (silent)
  useEffect(() => {
    const timer = setTimeout(() => checkForUpdate(true), 3000);
    return () => clearTimeout(timer);
  }, [checkForUpdate]);

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

  useEffect(() => {
    if (!copiedItemId) return undefined;

    const channelKey = copyFeedbackSource || 'global';
    const channelLabel = t(`feedback.channel.${channelKey}`, { defaultValue: t('feedback.channel.global') });
    const actionLabel = lastCopyWasAutoPaste ? t('item.autoPasted') : t('item.copied');
    showAppFeedback(`${actionLabel} - ${channelLabel}`, 'success', 1400);

    return undefined;
  }, [copiedItemId, copyFeedbackToken, copyFeedbackSource, lastCopyWasAutoPaste, showAppFeedback, t]);

  useEffect(() => () => {
    if (appFeedbackTimerRef.current) {
      clearTimeout(appFeedbackTimerRef.current);
      appFeedbackTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const isEditableElement = (target) => {
      if (!(target instanceof HTMLElement)) return false;
      const tagName = target.tagName;
      if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
      if (target.isContentEditable) return true;
      return Boolean(target.closest('[contenteditable="true"]'));
    };

    const handleShortcutHelpHotkey = (event) => {
      if (event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isEditableElement(event.target)) return;
      const isQuestionMark = event.key === '?' || (event.key === '/' && event.shiftKey);
      if (!isQuestionMark) return;
      event.preventDefault();
      setShowShortcutHelp(current => !current);
    };

    window.addEventListener('keydown', handleShortcutHelpHotkey);
    return () => window.removeEventListener('keydown', handleShortcutHelpHotkey);
  }, []);

  // Mini 模式
  const initialLayoutPresetRef = useRef(readLayoutPreset());
  const layoutPresetWidthsRef = useRef(readLayoutPresetWidths());
  const [layoutPreset, setLayoutPreset] = useState(initialLayoutPresetRef.current);
  const [leftWidth, setLeftWidth] = useState(() => {
    const preset = initialLayoutPresetRef.current;
    const widths = layoutPresetWidthsRef.current;
    const fallback = LAYOUT_PRESET_DEFAULT_WIDTHS[preset] || LAYOUT_PRESET_DEFAULT_WIDTHS[LAYOUT_PRESET_DEFAULT];
    return clampHistoryWidth(widths[preset] ?? fallback);
  });
  const leftWidthRef = useRef(leftWidth);

  useEffect(() => {
    leftWidthRef.current = leftWidth;
  }, [leftWidth]);

  const rememberPresetWidth = useCallback((preset, width) => {
    if (!isValidLayoutPreset(preset)) return;
    const normalized = clampHistoryWidth(width);
    const current = layoutPresetWidthsRef.current[preset];
    if (current === normalized) return;
    const next = { ...layoutPresetWidthsRef.current, [preset]: normalized };
    layoutPresetWidthsRef.current = next;
    persistLayoutPresetWidths(next);
  }, []);

  const applyLayoutPreset = useCallback((preset) => {
    if (!isValidLayoutPreset(preset)) return;

    if (collectionPanelEnabled && showHistoryStream) {
      rememberPresetWidth(layoutPreset, leftWidthRef.current);
    }

    const nextShowPanel = preset !== LAYOUT_PRESET_FLOW;
    const targetWidth = layoutPresetWidthsRef.current[preset] ?? LAYOUT_PRESET_DEFAULT_WIDTHS[preset];

    setLayoutPreset(preset);
    persistLayoutPreset(preset);
    setCollectionPanelBeforeMini(null);
    setHistoryStreamEnabled(true);
    setCollectionPanelEnabled(nextShowPanel);
    setLeftWidth(clampHistoryWidth(targetWidth));
  }, [
    collectionPanelEnabled,
    layoutPreset,
    rememberPresetWidth,
    setCollectionPanelBeforeMini,
    setCollectionPanelEnabled,
    setHistoryStreamEnabled,
    showHistoryStream,
  ]);

  const activeDesktopViewMode = !collectionPanelEnabled
    ? VIEW_MODE_LEFT
    : (!historyStreamEnabled ? VIEW_MODE_RIGHT : VIEW_MODE_ALL);

  const activeViewMode = isMiniMode ? VIEW_MODE_MINI : activeDesktopViewMode;
  const activeDesktopViewModeRef = useRef(activeDesktopViewMode);
  const lastDesktopViewModeRef = useRef(activeDesktopViewMode);
  const hasDesktopRestoreTargetRef = useRef(false);
  const viewModeSwitchQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    activeDesktopViewModeRef.current = activeDesktopViewMode;
    if (isMiniMode) return;
    lastDesktopViewModeRef.current = activeDesktopViewMode;
    hasDesktopRestoreTargetRef.current = true;
  }, [activeDesktopViewMode, isMiniMode]);

  const setMiniMode = useCallback(async (enterMini) => {
    const currentMiniMode = useAppStore.getState().isMiniMode;
    if (enterMini === currentMiniMode) return;
    const targetSize = enterMini ? MINI_SIZE : NORMAL_SIZE;
    try {
      const appWindow = getCurrentWindow();
      await appWindow.setSize(new LogicalSize(targetSize.width, targetSize.height));
    } catch (error) {
      console.warn('[WindowMode] setSize failed, fallback to state sync:', error);
    }
    localStorage.setItem(
      WINDOW_MODE_STORAGE_KEY,
      enterMini ? WINDOW_MODE_MINI : WINDOW_MODE_NORMAL
    );
    setIsMiniMode(enterMini);
  }, [setIsMiniMode]);

  const performViewModeSwitch = useCallback(async (mode) => {
    const currentMiniMode = useAppStore.getState().isMiniMode;

    if (mode === VIEW_MODE_MINI) {
      if (currentMiniMode) return;
      lastDesktopViewModeRef.current = activeDesktopViewModeRef.current;
      hasDesktopRestoreTargetRef.current = true;
      await setMiniMode(true);
      showAppFeedback(t('feedback.mode.mini'), 'info');
      return;
    }

    if (mode === VIEW_MODE_RESTORE) {
      const restoreMode = hasDesktopRestoreTargetRef.current
        ? (lastDesktopViewModeRef.current || VIEW_MODE_ALL)
        : VIEW_MODE_ALL;
      if (currentMiniMode) {
        await setMiniMode(false);
      }
      if (restoreMode === VIEW_MODE_LEFT) {
        applyLayoutPreset(LAYOUT_PRESET_FLOW);
      } else if (restoreMode === VIEW_MODE_RIGHT) {
        if (collectionPanelEnabled && showHistoryStream) {
          rememberPresetWidth(layoutPreset, leftWidthRef.current);
        }
        setLayoutPreset(LAYOUT_PRESET_DETAIL);
        persistLayoutPreset(LAYOUT_PRESET_DETAIL);
        setCollectionPanelBeforeMini(null);
        setCollectionPanelEnabled(true);
        setHistoryStreamEnabled(false);
      } else {
        applyLayoutPreset(LAYOUT_PRESET_DETAIL);
      }
      showAppFeedback(
        restoreMode === VIEW_MODE_LEFT
          ? t('feedback.mode.left')
          : restoreMode === VIEW_MODE_RIGHT
            ? t('feedback.mode.right')
            : t('feedback.mode.all'),
        'info'
      );
      return;
    }

    if (mode === VIEW_MODE_LEFT) {
      if (currentMiniMode) {
        await setMiniMode(false);
      }
      applyLayoutPreset(LAYOUT_PRESET_FLOW);
      showAppFeedback(t('feedback.mode.left'), 'info');
      return;
    }

    if (mode === VIEW_MODE_RIGHT) {
      if (currentMiniMode) {
        await setMiniMode(false);
      }
      if (collectionPanelEnabled && showHistoryStream) {
        rememberPresetWidth(layoutPreset, leftWidthRef.current);
      }
      setLayoutPreset(LAYOUT_PRESET_DETAIL);
      persistLayoutPreset(LAYOUT_PRESET_DETAIL);
      setCollectionPanelBeforeMini(null);
      setCollectionPanelEnabled(true);
      setHistoryStreamEnabled(false);
      showAppFeedback(t('feedback.mode.right'), 'info');
      return;
    }

    if (mode === VIEW_MODE_ALL) {
      if (currentMiniMode) {
        await setMiniMode(false);
      }
      applyLayoutPreset(LAYOUT_PRESET_DETAIL);
      showAppFeedback(t('feedback.mode.all'), 'info');
    }
  }, [
    applyLayoutPreset,
    collectionPanelEnabled,
    layoutPreset,
    rememberPresetWidth,
    setCollectionPanelBeforeMini,
    setCollectionPanelEnabled,
    setHistoryStreamEnabled,
    setMiniMode,
    showAppFeedback,
    showHistoryStream,
    t,
  ]);

  const handleSelectViewMode = useCallback((mode) => {
    viewModeSwitchQueueRef.current = viewModeSwitchQueueRef.current
      .catch(() => undefined)
      .then(() => performViewModeSwitch(mode));
  }, [performViewModeSwitch]);

  const MINI_THRESHOLD = 450;
  const PANEL_CLOSE_THRESHOLD = 350;

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
      // Skip auto mode switching during guided tour
      if (useAppStore.getState().tourActive) return;

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
  }, [initialWindowModeReady, isMiniMode, collectionPanelEnabled, collectionPanelBeforeMini, setMiniMode]);

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
      const newWidth = clampHistoryWidth(startWidthRef.current + delta);
      setLeftWidth(newWidth);
    };
    const handleMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (!isMiniMode && collectionPanelEnabled && showHistoryStream) {
        rememberPresetWidth(layoutPreset, leftWidthRef.current);
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    collectionPanelEnabled,
    isMiniMode,
    layoutPreset,
    rememberPresetWidth,
    showHistoryStream,
  ]);

  // Beta expired overlay removed - soft banner is shown at the bottom instead

  if (isLocked && hasPassword) {
    return (
      <Suspense fallback={null}>
        <LockScreen onUnlock={() => setIsLocked(false)} />
      </Suspense>
    );
  }

  return (
    <div
      className={`app ${isMiniMode ? 'mini-mode' : ''} ${!isMiniMode && !collectionPanelEnabled ? 'panel-hidden' : ''}`}
      role="application"
      aria-label={t('app.title')}
    >
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
      <ShortcutHelpOverlay
        isOpen={showShortcutHelp}
        onClose={() => setShowShortcutHelp(false)}
      />
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
            pendingConfirm={sharePendingConfirm}
            pendingProvider={sharePendingProvider}
            onClose={closeShareModal}
            onRetry={retryShare}
            onConfirmUpload={confirmShareUpload}
            onSwitchProvider={switchShareProvider}
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
        currentViewMode={activeViewMode}
        onSelectViewMode={handleSelectViewMode}
      />

      <div className="workspace">
        {showHistoryStream && (
          <HistoryStream style={{ width: isMiniMode || !collectionPanelEnabled ? '100%' : `${leftWidth}px` }} />
        )}
        {!isMiniMode && collectionPanelEnabled && (
          <>
            {showHistoryStream && <div className="resize-handle" onMouseDown={handleResizeStart} />}
            <PolymorphicPanel />
          </>
        )}
      </div>
      {shouldUseHoverPreview && <HoverPreview />}

      {tourActive && <GuidedTour />}

      {appFeedback && (
        <div className={`app-feedback-toast ${appFeedback.type}`} role="status" aria-live="polite">
          {appFeedback.text}
        </div>
      )}

      {/* Beta expired soft banner */}
      {betaExpired && !updateInfo && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9998,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          padding: '8px 16px', fontSize: 13,
          background: 'rgba(217,119,6,0.95)', color: '#fff',
          backdropFilter: 'blur(8px)',
        }}>
          <span>{t('beta.expiredBanner')}</span>
          <button
            onClick={async () => {
              await checkForUpdate(false);
              if (updateInfo?.update) {
                await downloadAndInstall();
              }
            }}
            disabled={updateChecking || (typeof updateProgress === 'number')}
            style={{ background: '#fff', color: '#b45309', border: 'none', borderRadius: 6, padding: '4px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
          >
            {updateChecking ? t('update.checking') :
             typeof updateProgress === 'number' ? t('update.progress', { percent: Math.round(updateProgress) }) :
             t('update.checkNow')}
          </button>
          {updateError && <span style={{ color: '#fecaca', fontSize: 12 }}>{updateError}</span>}
        </div>
      )}

      {/* Update notification bar */}
      {updateInfo && updateProgress !== 'upToDate' && (
        <div style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          padding: '8px 16px', fontSize: 13,
          background: 'rgba(59,130,246,0.95)', color: '#fff',
          backdropFilter: 'blur(8px)',
        }}>
          {typeof updateProgress === 'number' ? (
            <span>{t('update.progress', { percent: Math.round(updateProgress) })}</span>
          ) : updateProgress === 'ready' ? (
            <button
              onClick={() => relaunch()}
              style={{ background: '#fff', color: '#3b82f6', border: 'none', borderRadius: 6, padding: '4px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
            >
              {t('update.ready')}
            </button>
          ) : (
            <>
              <span>{t('update.available', { version: updateInfo.version })}</span>
              <button
                onClick={downloadAndInstall}
                style={{ background: '#fff', color: '#3b82f6', border: 'none', borderRadius: 6, padding: '4px 14px', fontWeight: 600, cursor: 'pointer', fontSize: 13 }}
              >
                {t('update.downloading').replace('...', '')}
              </button>
            </>
          )}
          {updateError && <span style={{ color: '#fecaca', fontSize: 12 }}>{updateError}</span>}
        </div>
      )}
    </div>
  );
}

export default App;
