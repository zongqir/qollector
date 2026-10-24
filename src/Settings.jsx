import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import useAppStore from './store/useAppStore';
import { createUpdaterProgressHandler } from './utils/updaterProgress';
import DataSecurityDataSection from './components/Settings/DataSecurityDataSection';
import DataSecuritySecuritySection from './components/Settings/DataSecuritySecuritySection';
import IntegrationsShareSection from './components/Settings/IntegrationsShareSection';
import IntegrationsCoreSection from './components/Settings/IntegrationsCoreSection';
import GeneralSection from './components/Settings/GeneralSection';
import ShortcutsSection from './components/Settings/ShortcutsSection';
import SettingsTabNav from './components/Settings/SettingsTabNav';
import AboutSection from './components/Settings/AboutSection';
import useShortcutSettings from './components/Settings/hooks/useShortcutSettings';
import useIntegrationsSettings from './components/Settings/hooks/useIntegrationsSettings';
import './Settings.css';

const SETTINGS_SEARCH_ANCHOR = {
  general: 'general-main',
  shortcuts: 'shortcuts-main',
  integrationsCore: 'integrations-core',
  integrationsShare: 'integrations-share',
  data: 'data-security-data',
  security: 'data-security-security',
  about: 'about-main',
};

const normalizeSearchText = (value) => (
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
);

function Settings({ onClose, themeMode, onThemeModeChange, onConfigChange }) {
  const { t, i18n } = useTranslation();
  const settingsInitialTab = useAppStore(s => s.settingsInitialTab);
  const [activeTab, setActiveTab] = useState(settingsInitialTab || 'general');
  const settingsPanelsRef = useRef(null);
  const [settingsSearchQuery, setSettingsSearchQuery] = useState('');
  const [pendingSearchTarget, setPendingSearchTarget] = useState(null);
  const [settingsSearchDropdownOpen, setSettingsSearchDropdownOpen] = useState(false);
  const [settingsSearchActiveIndex, setSettingsSearchActiveIndex] = useState(0);

  useEffect(() => {
    if (settingsInitialTab) {
      setActiveTab(settingsInitialTab);
    }
  }, [settingsInitialTab]);

  const settingsSearchEntries = useMemo(() => {
    const entries = [
      {
        id: 'general',
        tab: 'general',
        tabLabel: t('settings.tabs.general'),
        anchor: SETTINGS_SEARCH_ANCHOR.general,
        title: t('settings.tabs.general'),
        keywords: [
          t('settings.general.language'),
          t('settings.general.theme'),
          t('settings.general.startupDefaultView'),
          t('settings.general.autoPaste'),
          t('settings.general.copyOnSelect'),
          t('settings.general.startTour'),
        ],
      },
      {
        id: 'shortcuts',
        tab: 'shortcuts',
        tabLabel: t('settings.tabs.shortcuts'),
        anchor: SETTINGS_SEARCH_ANCHOR.shortcuts,
        title: t('settings.tabs.shortcuts'),
        keywords: [
          t('settings.shortcuts.toggleWindow'),
          t('settings.shortcuts.tagQuickAdd'),
        ],
      },
      {
        id: 'integrations-core',
        tab: 'integrations',
        tabLabel: t('settings.general.featureModules'),
        anchor: SETTINGS_SEARCH_ANCHOR.integrationsCore,
        title: t('settings.general.featureModules'),
        keywords: [
          t('settings.tabs.ai'),
          t('settings.tabs.ocr'),
          t('settings.tabs.mcp'),
          t('settings.general.enableAI'),
          t('settings.ocr.autoOcr'),
          t('settings.general.enableMCP'),
          t('settings.general.inputCapture'),
          t('settings.general.textChunkSplitter'),
          t('settings.collector.title'),
          t('settings.collector.endpoint'),
          t('settings.ai.provider'),
          t('settings.ai.model'),
          t('settings.ocr.provider'),
          t('settings.mcp.port'),
        ],
      },
      {
        id: 'integrations-share',
        tab: 'integrations',
        tabLabel: t('settings.tabs.share'),
        anchor: SETTINGS_SEARCH_ANCHOR.integrationsShare,
        title: t('settings.tabs.share'),
        keywords: [
          t('settings.share.provider'),
          t('settings.share.endpoint'),
          t('settings.share.bucket'),
          t('settings.share.testConnection'),
        ],
      },
      {
        id: 'data',
        tab: 'dataSecurity',
        tabLabel: t('settings.tabs.data'),
        anchor: SETTINGS_SEARCH_ANCHOR.data,
        title: t('settings.tabs.data'),
        keywords: [
          t('settings.general.autoCleanup'),
          t('settings.general.cleanupMaxItems'),
          t('settings.general.cleanupMaxAgeDays'),
          t('export.title'),
          t('export.export'),
          t('export.import'),
          t('export.clearData'),
        ],
      },
      {
        id: 'security',
        tab: 'dataSecurity',
        tabLabel: t('settings.tabs.security'),
        anchor: SETTINGS_SEARCH_ANCHOR.security,
        title: t('settings.tabs.security'),
        keywords: [
          t('lock.settingsTitle'),
          t('lock.enableLock'),
          t('lock.removeLock'),
          t('lock.changePassword'),
        ],
      },
      {
        id: 'about',
        tab: 'about',
        tabLabel: t('settings.tabs.about'),
        anchor: SETTINGS_SEARCH_ANCHOR.about,
        title: t('settings.tabs.about'),
        keywords: [
          t('settings.about.website'),
        ],
      },
    ];

    return entries.map((entry) => {
      const allTerms = [entry.title, ...(entry.keywords || [])]
        .filter(Boolean)
        .map(normalizeSearchText)
        .filter(Boolean);
      return {
        ...entry,
        allTerms,
        searchText: allTerms.join(' '),
      };
    });
  }, [t, i18n.language]);

  const settingsSearchResults = useMemo(() => {
    const query = normalizeSearchText(settingsSearchQuery);
    if (!query) return [];
    const tokens = query.split(' ').filter(Boolean);

    return settingsSearchEntries
      .map((entry) => {
        const matchedAllTokens = tokens.every((token) => entry.searchText.includes(token));
        if (!matchedAllTokens) return null;
        const titleText = normalizeSearchText(entry.title);

        let score = 0;
        if (titleText === query) score += 120;
        else if (titleText.startsWith(query)) score += 90;
        else if (titleText.includes(query)) score += 70;

        for (const term of entry.allTerms) {
          if (term === query) score += 60;
          else if (term.startsWith(query)) score += 35;
          else if (term.includes(query)) score += 18;
        }
        score += Math.min(tokens.length, 4) * 5;

        return { ...entry, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [settingsSearchEntries, settingsSearchQuery]);
  const selectedSettingsSearchResult = settingsSearchResults[settingsSearchActiveIndex]
    || settingsSearchResults[0]
    || null;
  const [generalConfig, setGeneralConfig] = useState({
    max_pinned_items: 10,
    language: 'zh-CN',
    theme_mode: themeMode || 'system',
    toggle_window_shortcut_enabled: true,
    toggle_window_shortcut: 'alt+x',
    history_tag_shortcut_enabled: true,
    auto_cleanup_enabled: true,
    cleanup_max_items: 50000,
    cleanup_max_age_days: 90,
    copy_qollect_source_items: false,
    startup_favorites_view_enabled: false,
    autostart_enabled: true,
    auto_layout_switch_enabled: true,
  });
  const [lockHasPassword, setLockHasPassword] = useState(false);
  const [lockOldPassword, setLockOldPassword] = useState('');
  const [lockNewPassword, setLockNewPassword] = useState('');
  const [lockConfirmPassword, setLockConfirmPassword] = useState('');
  const [lockError, setLockError] = useState('');
  const [lockSuccess, setLockSuccess] = useState('');
  const [exportIncludeImages, setExportIncludeImages] = useState(false);
  const [exportEncrypt, setExportEncrypt] = useState(false);
  const [exportPassword, setExportPassword] = useState('');
  const [exportConfirmPassword, setExportConfirmPassword] = useState('');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [importNeedPassword, setImportNeedPassword] = useState(false);
  const [importPassword, setImportPassword] = useState('');
  const [importFilePath, setImportFilePath] = useState(null);
  const [clearDataConfirm, setClearDataConfirm] = useState(false);
  const [clearDataResult, setClearDataResult] = useState(null);
  const [clearing, setClearing] = useState(false);

  // About / Update
  const [appVersion, setAppVersion] = useState('');

  const [aboutUpdateStatus, setAboutUpdateStatus] = useState(null); // null | 'checking' | 'downloading' | 'installing' | 'ready' | 'upToDate' | 'error'
  const [aboutUpdateError, setAboutUpdateError] = useState('');
  const [aboutUpdateVersion, setAboutUpdateVersion] = useState('');
  const [aboutUpdateRef, setAboutUpdateRef] = useState(null);
  const [aboutDownloadPercent, setAboutDownloadPercent] = useState(null);

  useEffect(() => {
    getVersion().then(v => setAppVersion(v)).catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setAboutUpdateStatus('checking');
    setAboutUpdateError('');
    setAboutDownloadPercent(null);
    try {
      const update = await check();
      if (update) {
        setAboutUpdateVersion(update.version);
        setAboutUpdateRef(update);
        setAboutUpdateStatus(null);
      } else {
        setAboutUpdateVersion('');
        setAboutUpdateRef(null);
        setAboutUpdateStatus('upToDate');
      }
    } catch (err) {
      setAboutUpdateStatus('error');
      setAboutUpdateError(String(err));
    }
  };

  const handleDownloadAndRestart = async () => {
    setAboutUpdateError('');
    setAboutDownloadPercent(null);
    try {
      let targetUpdate = aboutUpdateRef;
      if (!targetUpdate) {
        setAboutUpdateStatus('checking');
        targetUpdate = await check();
      }
      if (!targetUpdate) {
        setAboutUpdateVersion('');
        setAboutUpdateRef(null);
        setAboutUpdateStatus('upToDate');
        return;
      }

      setAboutUpdateVersion(targetUpdate.version);
      setAboutUpdateRef(targetUpdate);
      setAboutUpdateStatus('downloading');

      await targetUpdate.downloadAndInstall(createUpdaterProgressHandler({
        onDownloadStart: ({ totalBytes }) => {
          setAboutUpdateStatus('downloading');
          setAboutDownloadPercent(totalBytes ? 0 : null);
        },
        onDownloadProgress: ({ percent }) => {
          setAboutDownloadPercent(percent);
        },
        onInstalling: () => {
          setAboutUpdateStatus('installing');
        },
      }));
      setAboutUpdateStatus('ready');
      await relaunch();
    } catch (err) {
      setAboutUpdateStatus('error');
      setAboutUpdateError(String(err));
    }
  };

  const {
    aiConfig,
    setAiConfig,
    ocrConfig,
    setOcrConfig,
    mcpConfig,
    setMcpConfig,
    collectorConfig,
    setCollectorConfig,
    collectorTesting,
    collectorTestResult,
    collectorStatus,
    collectorSyncing,
    collectorSyncResult,
    showCollectorToken,
    setShowCollectorToken,
    actualMcpPort,
    customName,
    setCustomName,
    customUrl,
    setCustomUrl,
    aiTesting,
    aiTestResult,
    ocrTesting,
    ocrTestResult,
    availableModels,
    currentAiApiKey,
    setCurrentAiApiKey,
    currentAiModel,
    setCurrentAiModel,
    showAiApiKey,
    setShowAiApiKey,
    currentOcrApiKey,
    setCurrentOcrApiKey,
    currentOcrApiSecret,
    setCurrentOcrApiSecret,
    showOcrApiKey,
    setShowOcrApiKey,
    copySuccess,
    setCopySuccess,
    refreshingModels,
    refreshModelsResult,
    modelInputMode,
    setModelInputMode,
    shareConfig,
    setShareConfig,
    shareTestResult,
    setShareTestResult,
    shareTesting,
    setShareTesting,
    collapsedSections,
    toggleSection,
    loadIntegrationConfigs,
    handleAiEnabledChange,
    handleAutoTranslateEnabledChange,
    handleAutoTranslateSourceLangChange,
    handleAutoTranslateTargetLangChange,
    handleMcpEnabledChange,
    handleCollectorEnabledChange,
    handleCollectorTest,
    handleCollectorSync,
    saveIntegrations,
    getAiProviderValue,
    handleAiProviderChange,
    handleRefreshModels,
    handleAiTest,
    handleOcrTest,
    emailRelayConfig,
    setEmailRelayConfig,
    emailRelayTesting,
    emailRelayTestResult,
    showEmailPassword,
    setShowEmailPassword,
    handleEmailRelayEnabledChange,
    handleEmailRelayTest,
  } = useIntegrationsSettings({ t, onConfigChange });

  const openIntegrations = () => {
    if (activeTab === 'integrations') return;
    setActiveTab('integrations');
  };

  const openDataSecurity = () => {
    if (activeTab === 'dataSecurity') return;
    setActiveTab('dataSecurity');
  };

  const changeLanguage = async (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('language', lng);
    const updated = { ...generalConfig, language: lng };
    setGeneralConfig(updated);
    try {
      await invoke('update_general_config', { config: updated });
    } catch (error) {
      console.error('Settings operation failed:', error);
    }
  };

  const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

  const parseInteger = (rawValue, fallback) => {
    const parsed = parseInt(rawValue, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const getWheelNextNumber = ({
    rawValue,
    fallback,
    min,
    max,
    step = 1,
    deltaY,
  }) => {
    const current = clampNumber(parseInteger(rawValue, fallback), min, max);
    if (deltaY === 0) return current;
    const direction = deltaY < 0 ? 1 : -1;
    return clampNumber(current + (direction * step), min, max);
  };

  async function loadConfigs() {
    try {
      const [general, hasLock] = await Promise.all([
        invoke('get_general_config'),
        invoke('has_lock_password'),
      ]);
      setGeneralConfig(general);
      setLockHasPassword(hasLock);
      await loadIntegrationConfigs();
    } catch (error) {
      console.error('Settings operation failed:', error);
    }
  }

  const {
    normalizeShortcutText,
    shortcutError,
    recordingTarget,
    stopShortcutRecording,
    startShortcutRecording,
    getTagShortcutDisplay,
    restoreShortcutDefaults,
    saveShortcutConfig,
  } = useShortcutSettings({
    t,
    activeTab,
    generalConfig,
    setGeneralConfig,
    reloadConfigs: loadConfigs,
  });

  useEffect(() => {
    loadConfigs();
  }, []);

  const handleClose = () => {
    if (onConfigChange) onConfigChange();
    onClose();
  };

  const handleIntegrationsSave = async () => {
    const result = await saveIntegrations();
    if (result.success) {
      handleClose();
      return;
    }
    alert(t('error.saveFailed', { error: String(result.error) }));
  };

  const handleExport = async () => {
    if (exportEncrypt) {
      if (!exportPassword) return;
      if (exportPassword !== exportConfirmPassword) {
        setExportResult({ success: false, message: t('export.passwordMismatch') });
        return;
      }
    }
    setExporting(true);
    setExportResult(null);
    try {
      const path = await invoke('export_data', {
        includeImages: exportIncludeImages,
        password: exportEncrypt ? exportPassword : null,
      });
      setExportResult({ success: true, message: t('export.exportSuccess', { path }) });
    } catch (error) {
      if (error === 'CANCELLED') {
        setExportResult({ success: false, message: t('export.cancelled') });
      } else {
        setExportResult({ success: false, message: t('export.exportFailed', { error }) });
      }
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (pwd, path) => {
    setImporting(true);
    setImportResult(null);
    try {
      const result = await invoke('import_data', { password: pwd || null, filePath: path || null });
      setImportResult({ success: true, message: t('export.importSuccess', { imported: result.imported, skipped: result.skipped }) });
      setImportNeedPassword(false);
      setImportPassword('');
      setImportFilePath(null);
      if (onConfigChange) onConfigChange();
    } catch (error) {
      if (typeof error === 'string' && error.startsWith('ENCRYPTED:')) {
        const encPath = error.substring('ENCRYPTED:'.length);
        setImportNeedPassword(true);
        setImportFilePath(encPath);
        setImportResult({ success: false, message: t('export.importNeedPassword') });
      } else if (error === 'CANCELLED') {
        setImportResult({ success: false, message: t('export.cancelled') });
      } else {
        setImportResult({ success: false, message: t('export.importFailed', { error }) });
      }
    } finally {
      setImporting(false);
    }
  };

  const handleClearAllData = async () => {
    if (!clearDataConfirm) {
      setClearDataConfirm(true);
      return;
    }

    setClearing(true);
    setClearDataResult(null);
    try {
      await invoke('clear_all_data');
      setClearDataResult({ success: true, message: t('export.clearSuccess') });
      setClearDataConfirm(false);
      // Notify parent to refresh
      if (onConfigChange) onConfigChange();
    } catch (error) {
      setClearDataResult({ success: false, message: t('export.clearFailed', { error }) });
    } finally {
      setClearing(false);
    }
  };

  const navigateToSettingsSearchResult = (entry) => {
    if (!entry) return;
    setPendingSearchTarget(entry);
    setSettingsSearchDropdownOpen(false);
    if (activeTab !== entry.tab) {
      setActiveTab(entry.tab);
    }
  };

  const handleSettingsSearchSubmit = () => {
    if (!selectedSettingsSearchResult) return;
    navigateToSettingsSearchResult(selectedSettingsSearchResult);
  };

  useEffect(() => {
    if (!settingsSearchQuery.trim()) {
      setSettingsSearchDropdownOpen(false);
      setSettingsSearchActiveIndex(0);
      return;
    }
    setSettingsSearchDropdownOpen(true);
  }, [settingsSearchQuery]);

  useEffect(() => {
    if (settingsSearchActiveIndex < settingsSearchResults.length) return;
    setSettingsSearchActiveIndex(0);
  }, [settingsSearchActiveIndex, settingsSearchResults.length]);

  useEffect(() => {
    if (!pendingSearchTarget) return;

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 10;

    const tryScroll = () => {
      if (cancelled) return;
      attempts += 1;

      const container = settingsPanelsRef.current;
      const selector = `[data-settings-anchor="${pendingSearchTarget.anchor}"]`;
      const target = container?.querySelector(selector);

      if (!target) {
        if (attempts < maxAttempts) {
          requestAnimationFrame(tryScroll);
        } else {
          setPendingSearchTarget(null);
        }
        return;
      }

      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.remove('settings-search-hit');
      void target.offsetWidth;
      target.classList.add('settings-search-hit');
      setPendingSearchTarget(null);
    };

    requestAnimationFrame(tryScroll);
    return () => {
      cancelled = true;
    };
  }, [activeTab, pendingSearchTarget]);

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <div className="settings-header-top">
            <h2>{t('settings.title')}</h2>
            <button onClick={handleClose} className="close-btn"><X size={20} /></button>
          </div>
          <div className="settings-search-row">
            <div className="settings-search-input-wrap">
              <input
                type="text"
                value={settingsSearchQuery}
                onChange={(event) => {
                  setSettingsSearchQuery(event.target.value);
                  setSettingsSearchActiveIndex(0);
                }}
                onFocus={() => {
                  if (settingsSearchQuery.trim()) {
                    setSettingsSearchDropdownOpen(true);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault();
                    if (!settingsSearchDropdownOpen) {
                      setSettingsSearchDropdownOpen(true);
                    }
                    if (settingsSearchResults.length > 0) {
                      setSettingsSearchActiveIndex((prev) => (
                        prev + 1 >= settingsSearchResults.length ? 0 : prev + 1
                      ));
                    }
                    return;
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault();
                    if (settingsSearchResults.length > 0) {
                      setSettingsSearchActiveIndex((prev) => (
                        prev - 1 < 0 ? settingsSearchResults.length - 1 : prev - 1
                      ));
                    }
                    return;
                  }
                  if (event.key === 'Escape') {
                    setSettingsSearchDropdownOpen(false);
                    return;
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    handleSettingsSearchSubmit();
                  }
                }}
                placeholder={t('settings.search.placeholder')}
                aria-label={t('settings.search.placeholder')}
                className="setting-input settings-search-input"
              />
              {settingsSearchDropdownOpen && settingsSearchQuery.trim() && (
                <div className="settings-search-dropdown" role="listbox">
                  {settingsSearchResults.length > 0 ? (
                    settingsSearchResults.map((entry, index) => {
                      const active = index === settingsSearchActiveIndex;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          className={`settings-search-option ${active ? 'active' : ''}`}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setSettingsSearchActiveIndex(index)}
                          onClick={() => navigateToSettingsSearchResult(entry)}
                        >
                          <span className="settings-search-option-title">{entry.title}</span>
                          <span className="settings-search-option-tab">{entry.tabLabel}</span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="settings-search-empty">{t('settings.search.noResult')}</div>
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              className="test-btn secondary settings-search-jump-btn"
              onClick={handleSettingsSearchSubmit}
              disabled={!settingsSearchQuery.trim() || settingsSearchResults.length === 0}
            >
              {t('settings.search.jump')}
            </button>
          </div>
          {settingsSearchQuery.trim() && (
            <div className="settings-search-meta">
              {settingsSearchResults.length > 0
                ? t('settings.search.resultHint', {
                  count: settingsSearchResults.length,
                  target: selectedSettingsSearchResult?.title || settingsSearchResults[0].title,
                })
                : t('settings.search.noResult')}
            </div>
          )}
        </div>

        <div className="settings-main">
          <SettingsTabNav
            t={t}
            activeTab={activeTab}
            onOpenGeneral={() => setActiveTab('general')}
            onOpenShortcuts={() => setActiveTab('shortcuts')}
            onOpenIntegrations={openIntegrations}
            onOpenDataSecurity={openDataSecurity}
            onOpenAbout={() => setActiveTab('about')}
          />

          <div className="settings-panels" ref={settingsPanelsRef}>
          {activeTab === 'general' && (
            <div className="settings-anchor-target" data-settings-anchor={SETTINGS_SEARCH_ANCHOR.general}>
              <GeneralSection
                t={t}
                i18nLanguage={i18n.language}
                changeLanguage={changeLanguage}
                generalConfig={generalConfig}
                setGeneralConfig={setGeneralConfig}
                onThemeModeChange={onThemeModeChange}
                getWheelNextNumber={getWheelNextNumber}
              />
            </div>
          )}

          {activeTab === 'shortcuts' && (
            <div className="settings-anchor-target" data-settings-anchor={SETTINGS_SEARCH_ANCHOR.shortcuts}>
              <ShortcutsSection
                t={t}
                generalConfig={generalConfig}
                setGeneralConfig={setGeneralConfig}
                saveShortcutConfig={saveShortcutConfig}
                normalizeShortcutText={normalizeShortcutText}
                recordingTarget={recordingTarget}
                stopShortcutRecording={stopShortcutRecording}
                startShortcutRecording={startShortcutRecording}
                onConfigChange={onConfigChange}
                getTagShortcutDisplay={getTagShortcutDisplay}
                shortcutError={shortcutError}
                restoreShortcutDefaults={restoreShortcutDefaults}
              />
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="settings-anchor-target" data-settings-anchor={SETTINGS_SEARCH_ANCHOR.integrationsCore}>
              <IntegrationsCoreSection
                t={t}
                generalConfig={generalConfig}
                setGeneralConfig={setGeneralConfig}
                aiConfig={aiConfig}
                ocrConfig={ocrConfig}
                mcpConfig={mcpConfig}
                collectorConfig={collectorConfig}
                setCollectorConfig={setCollectorConfig}
                collectorTesting={collectorTesting}
                collectorTestResult={collectorTestResult}
                collectorStatus={collectorStatus}
                collectorSyncing={collectorSyncing}
                collectorSyncResult={collectorSyncResult}
                showCollectorToken={showCollectorToken}
                setShowCollectorToken={setShowCollectorToken}
                actualMcpPort={actualMcpPort}
                collapsedSections={collapsedSections}
                toggleSection={toggleSection}
                onToggleAiEnabled={handleAiEnabledChange}
                onToggleAutoTranslateEnabled={handleAutoTranslateEnabledChange}
                onChangeAutoTranslateSourceLang={handleAutoTranslateSourceLangChange}
                onChangeAutoTranslateTargetLang={handleAutoTranslateTargetLangChange}
                onToggleMcpEnabled={handleMcpEnabledChange}
                onToggleCollectorEnabled={handleCollectorEnabledChange}
                handleCollectorTest={handleCollectorTest}
                handleCollectorSync={handleCollectorSync}
                emailRelayConfig={emailRelayConfig}
                setEmailRelayConfig={setEmailRelayConfig}
                emailRelayTesting={emailRelayTesting}
                emailRelayTestResult={emailRelayTestResult}
                showEmailPassword={showEmailPassword}
                setShowEmailPassword={setShowEmailPassword}
                onToggleEmailRelayEnabled={handleEmailRelayEnabledChange}
                handleEmailRelayTest={handleEmailRelayTest}
                getAiProviderValue={getAiProviderValue}
                handleAiProviderChange={handleAiProviderChange}
                customName={customName}
                setCustomName={setCustomName}
                customUrl={customUrl}
                setCustomUrl={setCustomUrl}
                setAiConfig={setAiConfig}
                currentAiApiKey={currentAiApiKey}
                setCurrentAiApiKey={setCurrentAiApiKey}
                currentAiModel={currentAiModel}
                setCurrentAiModel={setCurrentAiModel}
                showAiApiKey={showAiApiKey}
                setShowAiApiKey={setShowAiApiKey}
                availableModels={availableModels}
                modelInputMode={modelInputMode}
                setModelInputMode={setModelInputMode}
                handleRefreshModels={handleRefreshModels}
                refreshingModels={refreshingModels}
                refreshModelsResult={refreshModelsResult}
                handleAiTest={handleAiTest}
                aiTesting={aiTesting}
                aiTestResult={aiTestResult}
                currentOcrApiKey={currentOcrApiKey}
                setCurrentOcrApiKey={setCurrentOcrApiKey}
                currentOcrApiSecret={currentOcrApiSecret}
                setCurrentOcrApiSecret={setCurrentOcrApiSecret}
                showOcrApiKey={showOcrApiKey}
                setShowOcrApiKey={setShowOcrApiKey}
                setOcrConfig={setOcrConfig}
                handleOcrTest={handleOcrTest}
                ocrTesting={ocrTesting}
                ocrTestResult={ocrTestResult}
                setMcpConfig={setMcpConfig}
                getWheelNextNumber={getWheelNextNumber}
                copySuccess={copySuccess}
                setCopySuccess={setCopySuccess}
              />
            </div>
          )}

          {activeTab === 'dataSecurity' && (
            <div className="settings-anchor-target" data-settings-anchor={SETTINGS_SEARCH_ANCHOR.data}>
              <DataSecurityDataSection
                t={t}
                generalConfig={generalConfig}
                setGeneralConfig={setGeneralConfig}
                getWheelNextNumber={getWheelNextNumber}
                exportIncludeImages={exportIncludeImages}
                setExportIncludeImages={setExportIncludeImages}
                exportEncrypt={exportEncrypt}
                setExportEncrypt={setExportEncrypt}
                exportPassword={exportPassword}
                setExportPassword={setExportPassword}
                exportConfirmPassword={exportConfirmPassword}
                setExportConfirmPassword={setExportConfirmPassword}
                exporting={exporting}
                importing={importing}
                handleExport={handleExport}
                setImportNeedPassword={setImportNeedPassword}
                setImportPassword={setImportPassword}
                setImportFilePath={setImportFilePath}
                setImportResult={setImportResult}
                handleImport={handleImport}
                importNeedPassword={importNeedPassword}
                importPassword={importPassword}
                importFilePath={importFilePath}
                exportResult={exportResult}
                importResult={importResult}
                clearDataConfirm={clearDataConfirm}
                handleClearAllData={handleClearAllData}
                clearing={clearing}
                setClearDataConfirm={setClearDataConfirm}
                setClearDataResult={setClearDataResult}
                clearDataResult={clearDataResult}
              />
            </div>
          )}

          {activeTab === 'dataSecurity' && (
            <div className="settings-anchor-target" data-settings-anchor={SETTINGS_SEARCH_ANCHOR.security}>
              <DataSecuritySecuritySection
                t={t}
                lockHasPassword={lockHasPassword}
                lockOldPassword={lockOldPassword}
                setLockOldPassword={setLockOldPassword}
                lockNewPassword={lockNewPassword}
                setLockNewPassword={setLockNewPassword}
                lockConfirmPassword={lockConfirmPassword}
                setLockConfirmPassword={setLockConfirmPassword}
                lockError={lockError}
                setLockError={setLockError}
                lockSuccess={lockSuccess}
                setLockSuccess={setLockSuccess}
                setLockHasPassword={setLockHasPassword}
              />
            </div>
          )}

          {activeTab === 'integrations' && (
            <div className="settings-anchor-target" data-settings-anchor={SETTINGS_SEARCH_ANCHOR.integrationsShare}>
              <IntegrationsShareSection
                t={t}
                shareConfig={shareConfig}
                setShareConfig={setShareConfig}
                shareTesting={shareTesting}
                setShareTesting={setShareTesting}
                shareTestResult={shareTestResult}
                setShareTestResult={setShareTestResult}
                collapsed={collapsedSections.share}
                onToggle={() => toggleSection('share')}
              />
            </div>
          )}

          {activeTab === 'about' && (
            <div className="settings-anchor-target" data-settings-anchor={SETTINGS_SEARCH_ANCHOR.about}>
              <AboutSection
                t={t}
                appVersion={appVersion}
                aboutUpdateVersion={aboutUpdateVersion}
                aboutUpdateRef={aboutUpdateRef}
                aboutUpdateStatus={aboutUpdateStatus}
                aboutDownloadPercent={aboutDownloadPercent}
                aboutUpdateError={aboutUpdateError}
                onCheckUpdate={handleCheckUpdate}
                onDownloadAndRestart={handleDownloadAndRestart}
              />
            </div>
          )}
        </div>
        </div>

        <div className="settings-footer">
          <button onClick={handleClose} className="cancel-btn">{t('settings.close')}</button>
          {activeTab === 'integrations' && (
            <button
              onClick={handleIntegrationsSave}
              className="save-btn"
            >
              {t('settings.save')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default Settings;
