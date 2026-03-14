import { useEffect, useState, useRef, useCallback, useLayoutEffect, lazy, Suspense } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useTranslation } from 'react-i18next';
import useAppStore from './store/useAppStore';
import { useTheme } from './hooks/useTheme';
import { prewarmCodeLanguageDetection } from './services/codeDetectionService';
import {
  openWidgetWindow,
  closeWidgetWindow,
} from './services/windowService';
import { runSmartCopyCaptureWorkflow } from './services/smartCopyWorkflowService';
import {
  QUICK_NOTE_SAVED_EVENT,
} from './services/quickNoteService';
import DragDrop from './DragDrop';
import TitleBar from './components/TitleBar';
import HistoryStream from './components/HistoryStream';
import PolymorphicPanel from './components/Panel';
import QuickNoteOverlay from './components/QuickNoteOverlay';
import GuidedTour from './components/GuidedTour/GuidedTour';
import ShortcutHelpOverlay from './components/ShortcutHelpOverlay';
import releaseNotes from './data/release-notes.json';
import {
  TOUR_COMPLETED_STORAGE_KEY,
  LAYOUT_LAST_ALL_SPLIT_WIDTH_STORAGE_KEY,
  WINDOW_MODE_STORAGE_KEY,
  WINDOW_NORMAL_SIZE_STORAGE_KEY,
} from './constants/storageKeys';

console.log('[Perf:App] Component definition loaded at', performance.now().toFixed(1), 'ms');

const Settings = lazy(() => import('./Settings'));
const LockScreen = lazy(() => import('./LockScreen'));
const EditModal = lazy(() => import('./EditModal'));
const ShareModal = lazy(() => import('./components/ShareModal/ShareModal'));

const NORMAL_SIZE = { width: 800, height: 600 };
const MINI_SIZE = { width: 320, height: 450 };
const MINI_THRESHOLD = 450;
const PANEL_CLOSE_THRESHOLD = 350;
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
const MINI_PRIMARY_CONTENT_HISTORY = 'history';
const MINI_PRIMARY_CONTENT_PANEL = 'panel';
const LAYOUT_PRESET_DEFAULT_WIDTHS = {
  [LAYOUT_PRESET_FLOW]: 300,
  [LAYOUT_PRESET_DETAIL]: 280,
};
const LAYOUT_PRESET_LEGACY_DEFAULT_WIDTHS = {
  [LAYOUT_PRESET_FLOW]: 360,
  [LAYOUT_PRESET_DETAIL]: 340,
};
const RELEASE_NOTES_SEEN_VERSION_KEY = 'qollect-release-notes-seen-version';
const RELEASE_NOTES_FALLBACK_URL = 'https://qollect.zongqir.com/changelog';

const normalizeVersion = (version) => String(version || '').trim().replace(/^v/i, '');

const getReleaseNotesLocale = (language) => (
  String(language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
);

const getReleaseNotesForVersion = (version) => {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion) return null;
  const releaseList = Array.isArray(releaseNotes?.releases) ? releaseNotes.releases : [];
  return releaseList.find((entry) => normalizeVersion(entry?.version) === normalizedVersion) || null;
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

const normalizeLayoutPresetWidth = (preset, value) => {
  const width = clampHistoryWidth(value);
  const legacyDefault = LAYOUT_PRESET_LEGACY_DEFAULT_WIDTHS[preset];
  if (legacyDefault != null && width === legacyDefault) {
    return LAYOUT_PRESET_DEFAULT_WIDTHS[preset] ?? width;
  }
  return width;
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
      next[LAYOUT_PRESET_FLOW] = normalizeLayoutPresetWidth(LAYOUT_PRESET_FLOW, parsed[LAYOUT_PRESET_FLOW]);
    }
    if (parsed[LAYOUT_PRESET_DETAIL] != null) {
      next[LAYOUT_PRESET_DETAIL] = normalizeLayoutPresetWidth(LAYOUT_PRESET_DETAIL, parsed[LAYOUT_PRESET_DETAIL]);
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

const clampNormalWindowWidth = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NORMAL_SIZE.width;
  return Math.min(Math.max(Math.round(parsed), 520), 2400);
};

const clampNormalWindowHeight = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return NORMAL_SIZE.height;
  return Math.min(Math.max(Math.round(parsed), 420), 1800);
};

const normalizeNormalWindowSize = (size) => ({
  width: clampNormalWindowWidth(size?.width),
  height: clampNormalWindowHeight(size?.height),
});

const readNormalWindowSize = () => {
  if (typeof window === 'undefined') return { ...NORMAL_SIZE };
  try {
    const raw = localStorage.getItem(WINDOW_NORMAL_SIZE_STORAGE_KEY);
    if (!raw) return { ...NORMAL_SIZE };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...NORMAL_SIZE };
    return normalizeNormalWindowSize(parsed);
  } catch (error) {
    console.warn('[WindowMode] read normal size failed:', error);
    return { ...NORMAL_SIZE };
  }
};

const persistNormalWindowSize = (size) => {
  if (typeof window === 'undefined' || !size) return;
  try {
    localStorage.setItem(WINDOW_NORMAL_SIZE_STORAGE_KEY, JSON.stringify(normalizeNormalWindowSize(size)));
  } catch (error) {
    console.warn('[WindowMode] persist normal size failed:', error);
  }
};

const readLastAllSplitWidth = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAYOUT_LAST_ALL_SPLIT_WIDTH_STORAGE_KEY);
    if (raw == null) return null;
    return normalizeLayoutPresetWidth(LAYOUT_PRESET_DETAIL, raw);
  } catch (error) {
    console.warn('[LayoutPreset] read last split failed:', error);
    return null;
  }
};

const persistLastAllSplitWidth = (width) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LAYOUT_LAST_ALL_SPLIT_WIDTH_STORAGE_KEY, String(clampHistoryWidth(width)));
  } catch (error) {
    console.warn('[LayoutPreset] persist last split failed:', error);
  }
};

function App() {
  console.log('[Perf:App] App() function called at', performance.now().toFixed(1), 'ms');

  const { t, i18n } = useTranslation();
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
  const [releaseNotesModal, setReleaseNotesModal] = useState(null);
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [isQuickInputOpen, setIsQuickInputOpen] = useState(false);
  const [smartCopyRunning, setSmartCopyRunning] = useState(false);

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
  const workbenchPanelEnabled = useAppStore(s => s.workbenchPanelEnabled);
  const historyStreamEnabled = useAppStore(s => s.historyStreamEnabled);
  const lowMemoryModeEnabled = useAppStore(s => s.lowMemoryModeEnabled);
  const autoLayoutSwitchEnabled = useAppStore(s => s.autoLayoutSwitchEnabled);
  const widgetEnabled = useAppStore(s => s.widgetEnabled);
  const smartCopyEntryEnabled = useAppStore(s => s.smartCopyEntryEnabled);
  const copiedItemId = useAppStore(s => s.copiedItemId);
  const copyFeedbackSource = useAppStore(s => s.copyFeedbackSource);
  const copyFeedbackToken = useAppStore(s => s.copyFeedbackToken);
  const lastCopyWasAutoPaste = useAppStore(s => s.lastCopyWasAutoPaste);
  const panelMode = useAppStore(s => s.panelMode);

  // Store actions
  const loadItems = useAppStore(s => s.loadItems);
  const loadConfigs = useAppStore(s => s.loadConfigs);
  const setShowSettings = useAppStore(s => s.setShowSettings);
  const setIsLocked = useAppStore(s => s.setIsLocked);
  const setIsAlwaysOnTop = useAppStore(s => s.setIsAlwaysOnTop);
  const setIsMiniMode = useAppStore(s => s.setIsMiniMode);
  const setWorkbenchPanelBeforeMini = useAppStore(s => s.setWorkbenchPanelBeforeMini);
  const workbenchPanelBeforeMini = useAppStore(s => s.workbenchPanelBeforeMini);
  const setWorkbenchPanelEnabled = useAppStore(s => s.setWorkbenchPanelEnabled);
  const setHistoryStreamEnabled = useAppStore(s => s.setHistoryStreamEnabled);
  const setThemeMode = useAppStore(s => s.setThemeMode);
  const setPanelMode = useAppStore(s => s.setPanelMode);
  const setSelectedType = useAppStore(s => s.setSelectedType);
  const handleCopyPlainText = useAppStore(s => s.handleCopyPlainText);
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
  const [miniPrimaryContent, setMiniPrimaryContent] = useState(MINI_PRIMARY_CONTENT_HISTORY);
  const autoMiniSwitchPendingRef = useRef(false);

  const mapSmartCopyErrorMessage = useCallback((error) => {
    const raw = typeof error === 'string'
      ? error
      : String(error?.message || error || '');

    if (raw === 'SMART_COPY_TIMEOUT') {
      return t('smartCopy.timeout');
    }
    if (raw.includes('OCR service not initialized')) {
      return t('smartCopy.ocrUnavailable');
    }
    if (raw.includes('OCR returned empty text')) {
      return t('smartCopy.emptyText');
    }
    if (raw.includes('only supported on Windows')) {
      return t('smartCopy.unsupportedPlatform');
    }
    return t('smartCopy.failed', { error: raw });
  }, [t]);

  const handleStartSmartCopy = useCallback(async () => {
    if (smartCopyRunning) return;

    setSmartCopyRunning(true);
    showAppFeedback(t('smartCopy.captureStarted'), 'info', 1800);

    try {
      const result = await runSmartCopyCaptureWorkflow({
        timeoutMs: 45000,
        pollIntervalMs: 380,
        copyToClipboard: false,
      });

      const normalizedText = typeof result?.text === 'string' ? result.text.trim() : '';
      if (!normalizedText) {
        throw new Error('OCR returned empty text');
      }

      await handleCopyPlainText(normalizedText, 'global');
    } catch (error) {
      console.error('[SmartCopy] failed:', error);
      showAppFeedback(mapSmartCopyErrorMessage(error), 'error', 2600);
    } finally {
      setSmartCopyRunning(false);
    }
  }, [handleCopyPlainText, mapSmartCopyErrorMessage, showAppFeedback, smartCopyRunning, t]);

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
    let prewarmTimer = null;
    let idleHandle = null;
    const warmup = () => {
      prewarmCodeLanguageDetection();
    };
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(warmup, { timeout: 1200 });
    } else {
      prewarmTimer = window.setTimeout(warmup, 250);
    }

    console.log('[Perf:App] Calling loadConfigs() at', performance.now().toFixed(1), 'ms');
    loadConfigs({ applyStartupView: true });

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
    if (!localStorage.getItem(TOUR_COMPLETED_STORAGE_KEY)) {
      tourTimer = setTimeout(() => startTour(), 1500);
    }

    return () => {
      if (idleHandle != null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleHandle);
      }
      if (prewarmTimer != null) clearTimeout(prewarmTimer);
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

  const dismissReleaseNotesModal = useCallback((version) => {
    const normalizedVersion = normalizeVersion(version);
    if (normalizedVersion) {
      try {
        localStorage.setItem(RELEASE_NOTES_SEEN_VERSION_KEY, normalizedVersion);
      } catch (error) {
        console.warn('[ReleaseNotes] failed to persist seen version:', error);
      }
    }
    setReleaseNotesModal(null);
  }, []);

  const openReleaseNotesChangelog = useCallback(async (url) => {
    if (!url) return;
    try {
      await invoke('open_url', { url });
    } catch (error) {
      console.warn('[ReleaseNotes] failed to open changelog url:', error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const resolveCurrentVersionNotes = async () => {
      try {
        const currentVersion = normalizeVersion(await getVersion());
        if (!currentVersion) return;

        let seenVersion = '';
        try {
          seenVersion = normalizeVersion(localStorage.getItem(RELEASE_NOTES_SEEN_VERSION_KEY) || '');
        } catch (error) {
          console.warn('[ReleaseNotes] failed to read seen version:', error);
        }
        if (seenVersion === currentVersion) return;

        const locale = getReleaseNotesLocale(i18n.language);
        const releaseEntry = getReleaseNotesForVersion(currentVersion);
        const fallbackSummary = i18n.t('update.releaseNotes.fallbackSummary', { version: currentVersion });

        if (!releaseEntry) {
          if (!cancelled) {
            setReleaseNotesModal({
              version: currentVersion,
              summary: fallbackSummary,
              highlights: [],
              changelogUrl: releaseNotes?.changelogUrl || RELEASE_NOTES_FALLBACK_URL,
            });
          }
          return;
        }

        const localizedSummary = releaseEntry.summary?.[locale]
          || releaseEntry.summary?.['en-US']
          || releaseEntry.summary?.['zh-CN']
          || fallbackSummary;
        const localizedHighlights = releaseEntry.highlights?.[locale]
          || releaseEntry.highlights?.['en-US']
          || releaseEntry.highlights?.['zh-CN']
          || [];

        if (!cancelled) {
          setReleaseNotesModal({
            version: currentVersion,
            summary: localizedSummary,
            highlights: Array.isArray(localizedHighlights)
              ? localizedHighlights.filter((item) => typeof item === 'string' && item.trim().length > 0)
              : [],
            changelogUrl: releaseEntry.changelogUrl || releaseNotes?.changelogUrl || RELEASE_NOTES_FALLBACK_URL,
          });
        }
      } catch (error) {
        console.warn('[ReleaseNotes] failed to resolve notes:', error);
      }
    };

    resolveCurrentVersionNotes();

    return () => {
      cancelled = true;
    };
  }, [i18n.language]);

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
  const normalWindowSizeRef = useRef(readNormalWindowSize());
  const lastAllSplitWidthRef = useRef(readLastAllSplitWidth());
  const [layoutPreset, setLayoutPreset] = useState(initialLayoutPresetRef.current);
  const [leftWidth, setLeftWidth] = useState(() => {
    const preset = initialLayoutPresetRef.current;
    const widths = layoutPresetWidthsRef.current;
    const fallback = LAYOUT_PRESET_DEFAULT_WIDTHS[preset] || LAYOUT_PRESET_DEFAULT_WIDTHS[LAYOUT_PRESET_DEFAULT];
    const preferredAllWidth = preset === LAYOUT_PRESET_DETAIL ? lastAllSplitWidthRef.current : null;
    return clampHistoryWidth(widths[preset] ?? preferredAllWidth ?? fallback);
  });
  const leftWidthRef = useRef(leftWidth);
  const showMiniPanel = isMiniMode && miniPrimaryContent === MINI_PRIMARY_CONTENT_PANEL;
  const showStandalonePanel = !isMiniMode
    && !workbenchPanelEnabled
    && panelMode !== 'workbench';
  const showHistoryStream = isMiniMode
    ? !showMiniPanel
    : !showStandalonePanel && (historyStreamEnabled || !workbenchPanelEnabled);
  const previewOverlayActive = !isMiniMode
    && workbenchPanelEnabled
    && showHistoryStream
    && panelMode === 'preview';
  const workspaceRef = useRef(null);
  const prevPanelRectRef = useRef(null);
  const prevOverlayActiveRef = useRef(previewOverlayActive);

  useEffect(() => {
    leftWidthRef.current = leftWidth;
  }, [leftWidth]);

  useLayoutEffect(() => {
    const workspaceEl = workspaceRef.current;
    if (!(workspaceEl instanceof HTMLElement)) return;
    const panelEl = workspaceEl.querySelector('.polymorphic-panel');
    if (!(panelEl instanceof HTMLElement)) {
      prevPanelRectRef.current = null;
      prevOverlayActiveRef.current = previewOverlayActive;
      return;
    }

    const nextRect = panelEl.getBoundingClientRect();
    const prevRect = prevPanelRectRef.current;
    const overlayStateChanged = prevOverlayActiveRef.current !== previewOverlayActive;

    prevPanelRectRef.current = nextRect;
    prevOverlayActiveRef.current = previewOverlayActive;

    if (
      !overlayStateChanged
      || !prevRect
      || prevRect.width <= 0
      || prevRect.height <= 0
      || nextRect.width <= 0
      || nextRect.height <= 0
    ) {
      return;
    }

    const deltaX = prevRect.left - nextRect.left;
    const deltaY = prevRect.top - nextRect.top;
    const scaleX = prevRect.width / nextRect.width;
    const scaleY = prevRect.height / nextRect.height;
    const easing = 'var(--ease-emphasized)';
    const duration = 'var(--motion-slow)';
    let rafId = null;

    panelEl.style.willChange = 'transform, opacity';
    panelEl.style.transition = 'none';
    panelEl.style.transformOrigin = 'top left';
    panelEl.style.transform = `translate(${deltaX}px, ${deltaY}px) scale(${scaleX}, ${scaleY})`;
    panelEl.style.opacity = '0.9';

    rafId = requestAnimationFrame(() => {
      panelEl.style.transition = `transform ${duration} ${easing}, opacity ${duration} ${easing}`;
      panelEl.style.transform = 'translate(0, 0) scale(1, 1)';
      panelEl.style.opacity = '1';
    });

    const clearInlineMotionStyles = () => {
      panelEl.style.willChange = '';
      panelEl.style.transition = '';
      panelEl.style.transformOrigin = '';
      panelEl.style.transform = '';
      panelEl.style.opacity = '';
    };

    const clearTimer = window.setTimeout(() => {
      panelEl.removeEventListener('transitionend', handleTransitionEnd);
      clearInlineMotionStyles();
    }, 520);

    const handleTransitionEnd = (event) => {
      if (event.propertyName !== 'transform' && event.propertyName !== 'opacity') return;
      panelEl.removeEventListener('transitionend', handleTransitionEnd);
      clearTimeout(clearTimer);
      clearInlineMotionStyles();
    };

    panelEl.addEventListener('transitionend', handleTransitionEnd);
    return () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
      }
      clearTimeout(clearTimer);
      panelEl.removeEventListener('transitionend', handleTransitionEnd);
      clearInlineMotionStyles();
    };
  }, [previewOverlayActive]);

  const rememberPresetWidth = useCallback((preset, width) => {
    if (!isValidLayoutPreset(preset)) return;
    const normalized = clampHistoryWidth(width);
    const current = layoutPresetWidthsRef.current[preset];
    if (current !== normalized) {
      const next = { ...layoutPresetWidthsRef.current, [preset]: normalized };
      layoutPresetWidthsRef.current = next;
      persistLayoutPresetWidths(next);
    }
    if (preset === LAYOUT_PRESET_DETAIL && lastAllSplitWidthRef.current !== normalized) {
      lastAllSplitWidthRef.current = normalized;
      persistLastAllSplitWidth(normalized);
    }
  }, []);

  const applyLayoutPreset = useCallback((preset, options = {}) => {
    if (!isValidLayoutPreset(preset)) return;
    const preferredWidth = options?.preferredWidth;

    if (workbenchPanelEnabled && showHistoryStream) {
      rememberPresetWidth(layoutPreset, leftWidthRef.current);
    }

    const nextShowPanel = preset !== LAYOUT_PRESET_FLOW;
    const targetWidth = clampHistoryWidth(
      preferredWidth
        ?? layoutPresetWidthsRef.current[preset]
        ?? LAYOUT_PRESET_DEFAULT_WIDTHS[preset]
    );

    setLayoutPreset(preset);
    persistLayoutPreset(preset);
    setWorkbenchPanelBeforeMini(null);
    setHistoryStreamEnabled(true);
    setWorkbenchPanelEnabled(nextShowPanel);
    setLeftWidth(targetWidth);
    if (preset === LAYOUT_PRESET_DETAIL) {
      rememberPresetWidth(preset, targetWidth);
    }
  }, [
    workbenchPanelEnabled,
    layoutPreset,
    rememberPresetWidth,
    setWorkbenchPanelBeforeMini,
    setWorkbenchPanelEnabled,
    setHistoryStreamEnabled,
    showHistoryStream,
  ]);

  const activeDesktopViewMode = !workbenchPanelEnabled
    ? VIEW_MODE_LEFT
    : (!historyStreamEnabled ? VIEW_MODE_RIGHT : VIEW_MODE_ALL);

  const activeViewMode = isMiniMode ? VIEW_MODE_MINI : activeDesktopViewMode;
  const activeDesktopViewModeRef = useRef(activeDesktopViewMode);
  const lastDesktopViewModeRef = useRef(activeDesktopViewMode);
  const hasDesktopRestoreTargetRef = useRef(false);
  const miniTransitionTargetRef = useRef(null);
  const viewModeSwitchQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    activeDesktopViewModeRef.current = activeDesktopViewMode;
    if (isMiniMode || miniTransitionTargetRef.current === true) return;
    lastDesktopViewModeRef.current = activeDesktopViewMode;
    hasDesktopRestoreTargetRef.current = true;
  }, [activeDesktopViewMode, isMiniMode]);

  useEffect(() => {
    if (miniTransitionTargetRef.current == null) return;
    if (miniTransitionTargetRef.current === isMiniMode) {
      miniTransitionTargetRef.current = null;
    }
  }, [isMiniMode]);

  const resolveMiniPrimaryContent = useCallback(() => {
    const state = useAppStore.getState();
    if (state.showFavoritesOnly) return MINI_PRIMARY_CONTENT_HISTORY;
    if (state.workbenchPanelBeforeMini === true && state.panelMode === 'workbench') {
      return MINI_PRIMARY_CONTENT_PANEL;
    }
    if (activeDesktopViewModeRef.current === VIEW_MODE_LEFT) return MINI_PRIMARY_CONTENT_HISTORY;
    if (
      state.panelMode === 'workbench'
      && (
        activeDesktopViewModeRef.current === VIEW_MODE_RIGHT
        || activeDesktopViewModeRef.current === VIEW_MODE_ALL
      )
    ) {
      return MINI_PRIMARY_CONTENT_PANEL;
    }
    return MINI_PRIMARY_CONTENT_HISTORY;
  }, []);

  const setMiniMode = useCallback(async (enterMini, options = {}) => {
    const keepCurrentSizeOnExit = options?.keepCurrentSizeOnExit === true;
    const currentMiniMode = useAppStore.getState().isMiniMode;
    if (enterMini === currentMiniMode) return;
    miniTransitionTargetRef.current = enterMini;

    if (enterMini) {
      setMiniPrimaryContent(resolveMiniPrimaryContent());
      lastDesktopViewModeRef.current = activeDesktopViewModeRef.current;
      hasDesktopRestoreTargetRef.current = true;

      const currentWidth = window.innerWidth;
      const currentHeight = window.innerHeight;
      if (currentWidth > MINI_THRESHOLD) {
        const nextNormalSize = normalizeNormalWindowSize({ width: currentWidth, height: currentHeight });
        normalWindowSizeRef.current = nextNormalSize;
        persistNormalWindowSize(nextNormalSize);
      }
      if (activeDesktopViewModeRef.current === VIEW_MODE_ALL) {
        const currentSplit = clampHistoryWidth(leftWidthRef.current);
        lastAllSplitWidthRef.current = currentSplit;
        persistLastAllSplitWidth(currentSplit);
        rememberPresetWidth(LAYOUT_PRESET_DETAIL, currentSplit);
      }
    }

    const shouldApplySize = enterMini || !keepCurrentSizeOnExit;
    if (shouldApplySize) {
      const targetSize = enterMini ? MINI_SIZE : normalWindowSizeRef.current;
      try {
        const appWindow = getCurrentWindow();
        await appWindow.setSize(new LogicalSize(targetSize.width, targetSize.height));
      } catch (error) {
        console.warn('[WindowMode] setSize failed, fallback to state sync:', error);
      }
    }

    localStorage.setItem(
      WINDOW_MODE_STORAGE_KEY,
      enterMini ? WINDOW_MODE_MINI : WINDOW_MODE_NORMAL
    );
    if (!enterMini) {
      setMiniPrimaryContent(MINI_PRIMARY_CONTENT_HISTORY);
    }
    setIsMiniMode(enterMini);
  }, [rememberPresetWidth, resolveMiniPrimaryContent, setIsMiniMode]);

  useEffect(() => {
    if (!isMiniMode) return;

    if (panelMode === 'preview' || panelMode === 'compare' || panelMode === 'timeline') {
      if (miniPrimaryContent !== MINI_PRIMARY_CONTENT_PANEL) {
        setMiniPrimaryContent(MINI_PRIMARY_CONTENT_PANEL);
      }
      return;
    }

    const nextPrimaryContent = resolveMiniPrimaryContent();
    if (miniPrimaryContent !== nextPrimaryContent) {
      setMiniPrimaryContent(nextPrimaryContent);
    }
  }, [isMiniMode, miniPrimaryContent, panelMode, resolveMiniPrimaryContent]);

  const performViewModeSwitch = useCallback(async (mode) => {
    const currentMiniMode = useAppStore.getState().isMiniMode;

    if (mode === VIEW_MODE_MINI) {
      if (currentMiniMode) return;
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
        if (workbenchPanelEnabled && showHistoryStream) {
          rememberPresetWidth(layoutPreset, leftWidthRef.current);
        }
        setLayoutPreset(LAYOUT_PRESET_DETAIL);
        persistLayoutPreset(LAYOUT_PRESET_DETAIL);
        setWorkbenchPanelBeforeMini(null);
        setWorkbenchPanelEnabled(true);
        setHistoryStreamEnabled(false);
      } else {
        applyLayoutPreset(LAYOUT_PRESET_DETAIL, { preferredWidth: lastAllSplitWidthRef.current });
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
      if (workbenchPanelEnabled && showHistoryStream) {
        rememberPresetWidth(layoutPreset, leftWidthRef.current);
      }
      setLayoutPreset(LAYOUT_PRESET_DETAIL);
      persistLayoutPreset(LAYOUT_PRESET_DETAIL);
      setWorkbenchPanelBeforeMini(null);
      setWorkbenchPanelEnabled(true);
      setHistoryStreamEnabled(false);
      showAppFeedback(t('feedback.mode.right'), 'info');
      return;
    }

    if (mode === VIEW_MODE_ALL) {
      if (currentMiniMode) {
        await setMiniMode(false);
      }
      applyLayoutPreset(LAYOUT_PRESET_DETAIL, { preferredWidth: lastAllSplitWidthRef.current });
      showAppFeedback(t('feedback.mode.all'), 'info');
    }
  }, [
    applyLayoutPreset,
    workbenchPanelEnabled,
    layoutPreset,
    rememberPresetWidth,
    setWorkbenchPanelBeforeMini,
    setWorkbenchPanelEnabled,
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

  const handleDensityModeChange = useCallback((nextDensityMode) => {
    showAppFeedback(
      nextDensityMode === 'compact'
        ? t('feedback.density.compact')
        : t('feedback.density.cozy'),
      'info',
      1200,
    );
  }, [showAppFeedback, t]);

  const handleOpenQuickInput = useCallback(() => {
    setIsQuickInputOpen((prev) => !prev);
  }, []);

  const handleCloseQuickInput = useCallback(() => {
    setIsQuickInputOpen(false);
  }, []);

  const handleQuickInputSaved = useCallback(() => {
    setIsQuickInputOpen(false);
    showAppFeedback(t('editModal.savedToast'), 'success', 1200);
  }, [showAppFeedback, t]);

  useEffect(() => {
    if (!initialWindowModeReady || isMiniMode) return undefined;

    const persistCurrentNormalSize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (width <= MINI_THRESHOLD) return;
      const normalized = normalizeNormalWindowSize({ width, height });
      const current = normalWindowSizeRef.current;
      if (current.width === normalized.width && current.height === normalized.height) return;
      normalWindowSizeRef.current = normalized;
      persistNormalWindowSize(normalized);
    };

    persistCurrentNormalSize();
    window.addEventListener('resize', persistCurrentNormalSize);
    return () => window.removeEventListener('resize', persistCurrentNormalSize);
  }, [initialWindowModeReady, isMiniMode]);

  useEffect(() => {
    let cancelled = false;

    const applyInitialWindowMode = async () => {
      const storedWindowMode = localStorage.getItem(WINDOW_MODE_STORAGE_KEY);
      const mode = storedWindowMode === WINDOW_MODE_NORMAL ? WINDOW_MODE_NORMAL : WINDOW_MODE_MINI;
      const enterMini = mode === WINDOW_MODE_MINI;
      const targetSize = enterMini ? MINI_SIZE : normalWindowSizeRef.current;

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
    if (!autoLayoutSwitchEnabled) return undefined;

    const handleResize = () => {
      // Skip auto mode switching during guided tour
      if (useAppStore.getState().tourActive) return;

      const width = window.innerWidth;
      const skipPanelAutoToggle = isMiniMode || miniTransitionTargetRef.current === true;

      // Handle panel auto-close/restore
      if (!skipPanelAutoToggle && width <= PANEL_CLOSE_THRESHOLD && workbenchPanelEnabled) {
        // Save current state and close panel
        setWorkbenchPanelBeforeMini(true);
        setWorkbenchPanelEnabled(false);
        showAppFeedback(t('feedback.autoLayout.panelHidden'), 'info', 1300);
      } else if (!skipPanelAutoToggle && width > PANEL_CLOSE_THRESHOLD && workbenchPanelBeforeMini === true && !workbenchPanelEnabled) {
        // Restore panel when window gets bigger
        setWorkbenchPanelEnabled(true);
        setWorkbenchPanelBeforeMini(null);
        showAppFeedback(t('feedback.autoLayout.panelShown'), 'info', 1300);
      }

      // Handle mini mode
      if (width <= MINI_THRESHOLD && !isMiniMode && !autoMiniSwitchPendingRef.current) {
        autoMiniSwitchPendingRef.current = true;
        setMiniMode(true)
          .then(() => {
            showAppFeedback(t('feedback.autoLayout.miniEnabled'), 'info', 1300);
          })
          .catch((error) => {
            console.error('[AutoLayout] enter mini mode failed:', error);
          })
          .finally(() => {
            autoMiniSwitchPendingRef.current = false;
          });
      } else if (width > MINI_THRESHOLD && isMiniMode && !autoMiniSwitchPendingRef.current) {
        autoMiniSwitchPendingRef.current = true;
        setMiniMode(false, { keepCurrentSizeOnExit: true })
          .then(() => {
            showAppFeedback(t('feedback.autoLayout.miniDisabled'), 'info', 1300);
          })
          .catch((error) => {
            console.error('[AutoLayout] exit mini mode failed:', error);
          })
          .finally(() => {
            autoMiniSwitchPendingRef.current = false;
          });
      }
    };
    // Apply once on startup so initial layout does not wait for a manual resize.
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [
    autoLayoutSwitchEnabled,
    initialWindowModeReady,
    isMiniMode,
    setMiniMode,
    setWorkbenchPanelBeforeMini,
    setWorkbenchPanelEnabled,
    showAppFeedback,
    t,
    workbenchPanelBeforeMini,
    workbenchPanelEnabled,
  ]);

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
  const pendingDragWidthRef = useRef(null);
  const splitWidthRafRef = useRef(null);

  const applyWorkspaceSplitWidth = useCallback((width) => {
    const workspaceEl = workspaceRef.current;
    if (!(workspaceEl instanceof HTMLElement)) return;
    workspaceEl.style.setProperty('--workspace-history-split-width', `${clampHistoryWidth(width)}px`);
  }, []);

  const clearWorkspaceSplitWidth = useCallback(() => {
    const workspaceEl = workspaceRef.current;
    if (!(workspaceEl instanceof HTMLElement)) return;
    workspaceEl.style.removeProperty('--workspace-history-split-width');
  }, []);

  const flushPendingDragWidth = useCallback(() => {
    if (splitWidthRafRef.current != null) {
      cancelAnimationFrame(splitWidthRafRef.current);
      splitWidthRafRef.current = null;
    }
    if (pendingDragWidthRef.current == null) return null;
    const nextWidth = clampHistoryWidth(pendingDragWidthRef.current);
    applyWorkspaceSplitWidth(nextWidth);
    return nextWidth;
  }, [applyWorkspaceSplitWidth]);

  const scheduleDragWidthUpdate = useCallback((width) => {
    pendingDragWidthRef.current = clampHistoryWidth(width);
    if (splitWidthRafRef.current != null) return;
    splitWidthRafRef.current = requestAnimationFrame(() => {
      splitWidthRafRef.current = null;
      if (pendingDragWidthRef.current == null) return;
      applyWorkspaceSplitWidth(pendingDragWidthRef.current);
    });
  }, [applyWorkspaceSplitWidth]);

  useLayoutEffect(() => {
    if (isMiniMode || !workbenchPanelEnabled || !showHistoryStream) {
      clearWorkspaceSplitWidth();
      return;
    }
    applyWorkspaceSplitWidth(leftWidth);
  }, [
    applyWorkspaceSplitWidth,
    clearWorkspaceSplitWidth,
    isMiniMode,
    leftWidth,
    showHistoryStream,
    workbenchPanelEnabled,
  ]);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    isDraggingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = leftWidthRef.current;
    pendingDragWidthRef.current = leftWidthRef.current;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isDraggingRef.current) return;
      const delta = e.clientX - startXRef.current;
      const newWidth = clampHistoryWidth(startWidthRef.current + delta);
      scheduleDragWidthUpdate(newWidth);
    };
    const handleMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      const finalWidth = flushPendingDragWidth() ?? leftWidthRef.current;
      pendingDragWidthRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      leftWidthRef.current = finalWidth;
      setLeftWidth(finalWidth);
      if (!isMiniMode && workbenchPanelEnabled && showHistoryStream) {
        rememberPresetWidth(layoutPreset, finalWidth);
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      if (splitWidthRafRef.current != null) {
        cancelAnimationFrame(splitWidthRafRef.current);
        splitWidthRafRef.current = null;
      }
      pendingDragWidthRef.current = null;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    flushPendingDragWidth,
    workbenchPanelEnabled,
    isMiniMode,
    layoutPreset,
    rememberPresetWidth,
    scheduleDragWidthUpdate,
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
      className={`app ${isMiniMode ? 'mini-mode' : ''} ${!isMiniMode && !workbenchPanelEnabled ? 'panel-hidden' : ''} ${isQuickInputOpen ? 'quick-note-open' : ''}`.trim()}
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
        onStartSmartCopy={handleStartSmartCopy}
        smartCopyRunning={smartCopyRunning}
        showSmartCopyEntry={smartCopyEntryEnabled}
        onOpenQuickInput={handleOpenQuickInput}
        isQuickInputOpen={isQuickInputOpen}
        isMiniMode={isMiniMode}
        currentViewMode={activeViewMode}
        onSelectViewMode={handleSelectViewMode}
        onDensityModeChange={handleDensityModeChange}
      />

      <QuickNoteOverlay
        isOpen={isQuickInputOpen}
        isMiniMode={isMiniMode}
        onClose={handleCloseQuickInput}
        onSaved={handleQuickInputSaved}
      />

      <div ref={workspaceRef} className={`workspace ${previewOverlayActive ? 'preview-overlay-active' : ''}`.trim()}>
        {showHistoryStream && (
          <HistoryStream style={{ width: isMiniMode || !workbenchPanelEnabled ? '100%' : 'var(--workspace-history-split-width, 340px)' }} />
        )}
        {(showMiniPanel || (!isMiniMode && (workbenchPanelEnabled || showStandalonePanel))) && (
          <>
            {!isMiniMode && showHistoryStream && !previewOverlayActive && <div className="resize-handle" onMouseDown={handleResizeStart} />}
            <PolymorphicPanel />
          </>
        )}
      </div>

      {tourActive && <GuidedTour />}

      {appFeedback && (
        <div className={`app-feedback-toast ${appFeedback.type}`} role="status" aria-live="polite">
          {appFeedback.text}
        </div>
      )}

      {releaseNotesModal && (
        <div
          className="release-notes-overlay"
          onClick={() => dismissReleaseNotesModal(releaseNotesModal.version)}
        >
          <div
            className="release-notes-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="release-notes-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="release-notes-header">
              <h3 id="release-notes-title">
                {t('update.releaseNotes.title', { version: releaseNotesModal.version })}
              </h3>
              <button
                type="button"
                className="release-notes-close"
                onClick={() => dismissReleaseNotesModal(releaseNotesModal.version)}
                aria-label={t('common.close')}
              >
                ×
              </button>
            </div>
            <div className="release-notes-body">
              {releaseNotesModal.summary && (
                <p className="release-notes-summary">{releaseNotesModal.summary}</p>
              )}
              {Array.isArray(releaseNotesModal.highlights) && releaseNotesModal.highlights.length > 0 ? (
                <ul className="release-notes-list">
                  {releaseNotesModal.highlights.map((item, index) => (
                    <li key={`${index}-${item}`}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="release-notes-empty">{t('update.releaseNotes.empty')}</p>
              )}
            </div>
            <div className="release-notes-actions">
              <button
                type="button"
                className="release-notes-btn secondary"
                onClick={() => openReleaseNotesChangelog(releaseNotesModal.changelogUrl)}
              >
                {t('update.releaseNotes.viewFull')}
              </button>
              <button
                type="button"
                className="release-notes-btn primary"
                onClick={() => dismissReleaseNotesModal(releaseNotesModal.version)}
              >
                {t('update.releaseNotes.gotIt')}
              </button>
            </div>
          </div>
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
                {t('update.downloadNow')}
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
