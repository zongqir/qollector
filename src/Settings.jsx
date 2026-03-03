import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import useAppStore from './store/useAppStore';
import DataSecurityDataSection from './components/Settings/DataSecurityDataSection';
import DataSecuritySecuritySection from './components/Settings/DataSecuritySecuritySection';
import IntegrationsLanSyncSection from './components/Settings/IntegrationsLanSyncSection';
import IntegrationsShareSection from './components/Settings/IntegrationsShareSection';
import IntegrationsCoreSection from './components/Settings/IntegrationsCoreSection';
import GeneralSection from './components/Settings/GeneralSection';
import ShortcutsSection from './components/Settings/ShortcutsSection';
import SettingsTabNav from './components/Settings/SettingsTabNav';
import AboutSection from './components/Settings/AboutSection';
import useShortcutSettings from './components/Settings/hooks/useShortcutSettings';
import useIntegrationsSettings from './components/Settings/hooks/useIntegrationsSettings';
import './Settings.css';

function Settings({ onClose, themeMode, onThemeModeChange, onConfigChange }) {
  const { t, i18n } = useTranslation();
  const settingsInitialTab = useAppStore(s => s.settingsInitialTab);
  const [activeTab, setActiveTab] = useState(settingsInitialTab || 'general');

  useEffect(() => {
    if (settingsInitialTab) {
      setActiveTab(settingsInitialTab);
    }
  }, [settingsInitialTab]);
  const [generalConfig, setGeneralConfig] = useState({
    max_pinned_items: 10,
    language: 'zh-CN',
    theme_mode: themeMode || 'system',
    double_copy_emphasis_enabled: true,
    double_copy_window_ms: 900,
    ctrl_shift_c_shortcut_enabled: true,
    copy_pin_shortcut: 'ctrl+shift+c',
    toggle_window_shortcut_enabled: true,
    toggle_window_shortcut: 'alt+x',
    history_tag_shortcut_enabled: true,
    auto_cleanup_enabled: true,
    cleanup_max_items: 50000,
    cleanup_max_age_days: 90,
    startup_favorites_view_enabled: false,
    autostart_enabled: false,
    low_memory_mode_enabled: false,
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

  // License
  const [licenseConfig, setLicenseConfig] = useState(null);
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [licenseActivating, setLicenseActivating] = useState(false);
  const [licenseDeactivating, setLicenseDeactivating] = useState(false);
  const [licenseError, setLicenseError] = useState('');
  const [licenseSuccess, setLicenseSuccess] = useState('');
  const [aboutUpdateStatus, setAboutUpdateStatus] = useState(null); // null | 'checking' | 'downloading' | 'ready' | 'upToDate' | 'error'
  const [aboutUpdateError, setAboutUpdateError] = useState('');
  const [aboutUpdateVersion, setAboutUpdateVersion] = useState('');
  const [aboutUpdateRef, setAboutUpdateRef] = useState(null);
  const [aboutDownloadPercent, setAboutDownloadPercent] = useState(0);

  useEffect(() => {
    getVersion().then(v => setAppVersion(v)).catch(() => {});
  }, []);

  const handleCheckUpdate = async () => {
    setAboutUpdateStatus('checking');
    setAboutUpdateError('');
    setAboutDownloadPercent(0);
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
    setAboutDownloadPercent(0);
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

      await targetUpdate.downloadAndInstall((event) => {
        if (event.event === 'Progress') {
          setAboutDownloadPercent((prev) => {
            const chunk = event.data?.chunkLength || 0;
            const total = event.data?.contentLength || 1;
            return Math.min(prev + (chunk / total) * 100, 99);
          });
        } else if (event.event === 'Finished') {
          setAboutDownloadPercent(100);
        }
      });
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
    handleOcrEnabledChange,
    handleMcpEnabledChange,
    saveIntegrations,
    getAiProviderValue,
    handleAiProviderChange,
    handleRefreshModels,
    handleAiTest,
    handleOcrTest,
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

      try {
        const license = await invoke('get_license_info');
        setLicenseConfig(license);
      } catch (e) {
        console.error('Failed to load license config:', e);
      }
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

  const handleActivateLicense = async () => {
    if (!licenseKeyInput.trim()) return;
    setLicenseActivating(true);
    setLicenseError('');
    setLicenseSuccess('');
    try {
      const result = await invoke('activate_license', { key: licenseKeyInput.trim() });
      setLicenseConfig(result);
      setLicenseKeyInput('');
      setLicenseSuccess(t('license.activateSuccess'));
      if (onConfigChange) onConfigChange();
    } catch (err) {
      const msg = String(err);
      if (msg.includes('max_devices') || msg.includes('Maximum')) {
        setLicenseError(t('license.maxDevices'));
      } else if (msg.includes('invalid') || msg.includes('Invalid')) {
        setLicenseError(t('license.invalidKey'));
      } else {
        setLicenseError(msg);
      }
    } finally {
      setLicenseActivating(false);
    }
  };

  const handleDeactivateLicense = async () => {
    setLicenseDeactivating(true);
    setLicenseError('');
    setLicenseSuccess('');
    try {
      await invoke('deactivate_license');
      const updated = await invoke('get_license_info');
      setLicenseConfig(updated);
      setLicenseSuccess(t('license.deactivateSuccess'));
      if (onConfigChange) onConfigChange();
    } catch (err) {
      setLicenseError(String(err));
    } finally {
      setLicenseDeactivating(false);
    }
  };

  const maskLicenseKey = (key) => {
    if (!key || key.length < 10) return key || '';
    return key.substring(0, 7) + '****' + key.substring(key.length - 4);
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

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>{t('settings.title')}</h2>
          <button onClick={handleClose} className="close-btn"><X size={20} /></button>
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

          <div className="settings-panels">
                    {activeTab === 'general' && (
            <GeneralSection
              t={t}
              i18nLanguage={i18n.language}
              changeLanguage={changeLanguage}
              generalConfig={generalConfig}
              setGeneralConfig={setGeneralConfig}
              onThemeModeChange={onThemeModeChange}
              getWheelNextNumber={getWheelNextNumber}
            />
          )}

          {activeTab === 'shortcuts' && (
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
              getWheelNextNumber={getWheelNextNumber}
            />
          )}

          {activeTab === 'integrations' && (
            <IntegrationsCoreSection
              t={t}
              aiConfig={aiConfig}
              ocrConfig={ocrConfig}
              mcpConfig={mcpConfig}
              actualMcpPort={actualMcpPort}
              collapsedSections={collapsedSections}
              toggleSection={toggleSection}
              onToggleAiEnabled={handleAiEnabledChange}
              onToggleOcrEnabled={handleOcrEnabledChange}
              onToggleMcpEnabled={handleMcpEnabledChange}
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
          )}

          {activeTab === 'dataSecurity' && (
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
          )}

          {activeTab === 'dataSecurity' && (
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
          )}

          {activeTab === 'integrations' && (
            <IntegrationsLanSyncSection
              t={t}
              collapsed={collapsedSections.lanSync}
              onToggle={() => toggleSection('lanSync')}
            />
          )}

          {activeTab === 'integrations' && (
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
          )}

          {/* License panel - temporarily hidden for beta
          {activeTab === 'license' && (
            <div className="settings-section">
              <div className="setting-group-title">{t('license.title')}</div>
              <div className="setting-group" style={{ gap: 16 }}>
                <div className="sg-row" style={{ justifyContent: 'space-between' }}>
                  <span className="toggle-label">{t('license.status')}</span>
                  <span style={{
                    fontWeight: 600,
                    color: licenseConfig?.status === 'Active' ? '#22c55e' : 'var(--text-secondary)',
                  }}>
                    {licenseConfig?.status === 'Active' ? t('license.pro') : t('license.free')}
                  </span>
                </div>

                {licenseConfig?.status === 'Active' && (
                  <>
                    <div className="sg-row" style={{ justifyContent: 'space-between' }}>
                      <span className="toggle-label">{t('license.devices')}</span>
                      <span>{t('license.devicesCount', {
                        current: licenseConfig.activated_devices || 0,
                        max: licenseConfig.max_devices || 3,
                      })}</span>
                    </div>
                    <div className="sg-row" style={{ justifyContent: 'space-between' }}>
                      <span className="toggle-label">{t('license.currentKey')}</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 12, opacity: 0.7 }}>
                        {maskLicenseKey(licenseConfig.license_key)}
                      </span>
                    </div>
                    <button
                      onClick={handleDeactivateLicense}
                      disabled={licenseDeactivating}
                      className="cancel-btn"
                      style={{ alignSelf: 'flex-start' }}
                    >
                      {licenseDeactivating ? t('license.deactivating') : t('license.deactivate')}
                    </button>
                  </>
                )}

                {licenseConfig?.status !== 'Active' && (
                  <>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        type="text"
                        value={licenseKeyInput}
                        onChange={(e) => setLicenseKeyInput(e.target.value)}
                        placeholder={t('license.keyPlaceholder')}
                        className="setting-input"
                        style={{ flex: 1, fontFamily: 'monospace' }}
                        onKeyDown={(e) => e.key === 'Enter' && handleActivateLicense()}
                      />
                      <button
                        onClick={handleActivateLicense}
                        disabled={licenseActivating || !licenseKeyInput.trim()}
                        className="save-btn"
                      >
                        {licenseActivating ? t('license.activating') : t('license.activate')}
                      </button>
                    </div>
                  </>
                )}

                {licenseError && (
                  <div style={{ color: '#f87171', fontSize: 12 }}>{licenseError}</div>
                )}
                {licenseSuccess && (
                  <div style={{ color: '#22c55e', fontSize: 12 }}>{licenseSuccess}</div>
                )}

                <div style={{ marginTop: 8, padding: '12px 16px', borderRadius: 8, background: 'var(--bg-tertiary)', fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('license.paidFeatures')}</div>
                  <div style={{ opacity: 0.7 }}>{t('license.paidFeatureList')}</div>
                </div>
              </div>
            </div>
          )}
          */}

          {activeTab === 'about' && (
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
