import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { X, Eye, EyeOff } from 'lucide-react';
import DataSecurityDataSection from './components/Settings/DataSecurityDataSection';
import DataSecuritySecuritySection from './components/Settings/DataSecuritySecuritySection';
import IntegrationsShareSection from './components/Settings/IntegrationsShareSection';
import GeneralSection from './components/Settings/GeneralSection';
import ShortcutsSection from './components/Settings/ShortcutsSection';
import './Settings.css';

const AI_PROVIDERS = ['SiliconFlow', 'Volcano', 'Alibaba', 'Custom'];

const OCR_PROVIDERS = ['Local', 'SiliconFlow', 'DeepSeek', 'Aliyun', 'Tencent', 'Baidu'];

function Settings({ onClose, themeMode, onThemeModeChange, onConfigChange }) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState('general');
  const [aiConfig, setAiConfig] = useState({
    current_provider: { SiliconFlow: null },
    credentials: {},  // { "siliconflow": { api_key: "xxx", model: "xxx" }, ... }
    enabled: false,
  });
  const [ocrConfig, setOcrConfig] = useState({
    enabled: true,
    current_provider: 'SiliconFlow',
    credentials: {},  // { "siliconflow": { api_key: "xxx", api_secret: null }, ... }
    language: 'chi_sim+eng',
    auto_ocr: true,
  });

  const [mcpConfig, setMcpConfig] = useState({
    enabled: true,
    port: 38470,
    mode: 'http',
  });
  const [generalConfig, setGeneralConfig] = useState({
    max_pinned_items: 10,
    language: 'zh-CN',
    theme_mode: themeMode || 'system',
    double_copy_emphasis_enabled: true,
    double_copy_window_ms: 900,
    ctrl_shift_c_shortcut_enabled: false,
    copy_pin_shortcut: 'ctrl+shift+c',
    toggle_window_shortcut_enabled: true,
    toggle_window_shortcut: 'alt+x',
    history_tag_shortcut_enabled: true,
    auto_cleanup_enabled: true,
    cleanup_max_items: 50000,
    cleanup_max_age_days: 90,
    autostart_enabled: false,
    low_memory_mode_enabled: false,
  });
  const [actualMcpPort, setActualMcpPort] = useState(38470);
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState(null);
  const [ocrTesting, setOcrTesting] = useState(false);
  const [ocrTestResult, setOcrTestResult] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);
  const [currentAiApiKey, setCurrentAiApiKey] = useState('');
  const [currentAiModel, setCurrentAiModel] = useState('Qwen/Qwen2.5-7B-Instruct');
  const [showAiApiKey, setShowAiApiKey] = useState(false);
  const [lockHasPassword, setLockHasPassword] = useState(false);
  const [lockOldPassword, setLockOldPassword] = useState('');
  const [lockNewPassword, setLockNewPassword] = useState('');
  const [lockConfirmPassword, setLockConfirmPassword] = useState('');
  const [lockError, setLockError] = useState('');
  const [lockSuccess, setLockSuccess] = useState('');
  const [currentOcrApiKey, setCurrentOcrApiKey] = useState('');
  const [currentOcrApiSecret, setCurrentOcrApiSecret] = useState('');
  const [showOcrApiKey, setShowOcrApiKey] = useState(false);
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
  const [copySuccess, setCopySuccess] = useState(false);
  const [shortcutError, setShortcutError] = useState('');
  const [recordingTarget, setRecordingTarget] = useState(null);
  const [clearDataConfirm, setClearDataConfirm] = useState(false);
  const [clearDataResult, setClearDataResult] = useState(null);
  const [clearing, setClearing] = useState(false);

  // Share config
  const [shareConfig, setShareConfig] = useState({
    provider: 'ZeroX0',
    s3_config: null,
    force_upload_non_ascii_text: false,
  });
  const [shareTestResult, setShareTestResult] = useState(null);
  const [shareTesting, setShareTesting] = useState(false);
  const isIntegrationTab = activeTab === 'integrations';
  const isDataSecurityTab = activeTab === 'dataSecurity';

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

  const normalizeShortcutText = (value) => (value || '').trim().toLowerCase();

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

  const normalizeShortcutToken = (token) => {
    const value = (token || '').trim().toLowerCase();
    if (!value) return '';
    if (value === 'control') return 'ctrl';
    if (value === 'cmd' || value === 'command' || value === 'meta') return 'super';
    if (value === 'option') return 'alt';
    if (value === 'return') return 'enter';
    if (value === 'escape') return 'esc';
    return value;
  };

  const shortcutKey = (shortcut) => {
    const normalized = normalizeShortcutText(shortcut);
    if (!normalized) return '';
    const tokens = normalized
      .split('+')
      .map(normalizeShortcutToken)
      .filter(Boolean);
    if (tokens.length === 0) return '';
    return Array.from(new Set(tokens)).sort().join('+');
  };

  const getShortcutPlatform = () => {
    const rawPlatform = (
      navigator.userAgentData?.platform
      || navigator.platform
      || navigator.userAgent
      || ''
    ).toLowerCase();
    if (rawPlatform.includes('mac')) return 'macos';
    if (rawPlatform.includes('win')) return 'windows';
    if (rawPlatform.includes('linux')) return 'linux';
    return 'other';
  };

  const getPlatformLabel = (platform) => {
    if (platform === 'macos') return 'macOS';
    if (platform === 'windows') return 'Windows';
    if (platform === 'linux') return 'Linux';
    return 'Current OS';
  };

  const getDefaultSuggestedShortcut = (target) => {
    const platform = getShortcutPlatform();
    if (target === 'copy_pin_shortcut') {
      if (platform === 'macos') return 'super+alt+c';
      return 'ctrl+alt+c';
    }
    if (target === 'toggle_window_shortcut') {
      if (platform === 'macos') return 'super+alt+x';
      return 'ctrl+alt+x';
    }
    if (platform === 'macos') return 'super+alt+x';
    return 'ctrl+alt+x';
  };

  const getTagShortcutDisplay = () => {
    const platform = getShortcutPlatform();
    return platform === 'macos' ? 'super+t' : 'ctrl+t';
  };

  const getReservedShortcutKeys = () => {
    const byPlatform = {
      windows: ['alt+tab', 'alt+f4', 'super+l', 'super+d', 'super+tab', 'ctrl+alt+delete'],
      macos: ['super+q', 'super+tab', 'super+space', 'ctrl+space', 'super+h'],
      linux: ['alt+tab', 'alt+f4', 'super+l'],
      other: ['alt+tab'],
    };
    const platform = getShortcutPlatform();
    const source = byPlatform[platform] || byPlatform.other;
    return new Set(source.map(shortcutKey).filter(Boolean));
  };

  const isReservedShortcut = (shortcut) => {
    const key = shortcutKey(shortcut);
    if (!key) return false;
    return getReservedShortcutKeys().has(key);
  };

  const validateShortcutConfigDraft = (draft) => {
    const toggleShortcut = normalizeShortcutText(draft.toggle_window_shortcut || '');
    const copyShortcut = normalizeShortcutText(draft.copy_pin_shortcut || '');

    if (draft.toggle_window_shortcut_enabled && isReservedShortcut(toggleShortcut)) {
      return t('settings.shortcuts.recordReserved', { shortcut: toggleShortcut });
    }
    if (draft.ctrl_shift_c_shortcut_enabled && isReservedShortcut(copyShortcut)) {
      return t('settings.shortcuts.recordReserved', { shortcut: copyShortcut });
    }

    if (draft.toggle_window_shortcut_enabled && draft.ctrl_shift_c_shortcut_enabled) {
      if (shortcutKey(toggleShortcut) === shortcutKey(copyShortcut)) {
        return t('settings.shortcuts.conflictError');
      }
    }

    return '';
  };

  const saveShortcutConfig = async (updated, target = null) => {
    setGeneralConfig(updated);
    setShortcutError('');
    const shortcutValidationError = validateShortcutConfigDraft(updated);
    if (shortcutValidationError) {
      setShortcutError(shortcutValidationError);
      return false;
    }
    try {
      await invoke('update_general_config', { config: updated });
      return true;
    } catch (error) {
      const message = typeof error === 'string' ? error : String(error);
      const enrichedMessage = message.includes('Failed to register shortcut')
        ? `${message} ${t('settings.shortcuts.occupiedHintOne', {
          platform: getPlatformLabel(getShortcutPlatform()),
          shortcut: getDefaultSuggestedShortcut(target),
        })}`
        : message;
      setShortcutError(enrichedMessage);
      console.error('Failed to save shortcut config:', error);
      try {
        await loadConfigs();
      } catch (reloadError) {
        console.error('Failed to reload configs after shortcut save failure:', reloadError);
      }
      return false;
    }
  };

  const getShortcutPrimaryKey = (event) => {
    const { code, key } = event;

    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code.toLowerCase();

    const specialKeyMap = {
      Space: 'space',
      Enter: 'enter',
      Escape: 'esc',
      Tab: 'tab',
      Backspace: 'backspace',
      Delete: 'delete',
      Insert: 'insert',
      Home: 'home',
      End: 'end',
      PageUp: 'pageup',
      PageDown: 'pagedown',
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      Minus: '-',
      Equal: '=',
      BracketLeft: '[',
      BracketRight: ']',
      Backslash: '\\',
      Semicolon: ';',
      Quote: "'",
      Comma: ',',
      Period: '.',
      Slash: '/',
      Backquote: '`',
    };
    if (specialKeyMap[code]) return specialKeyMap[code];

    const normalizedKey = (key || '').toLowerCase();
    if (/^[a-z0-9]$/.test(normalizedKey)) return normalizedKey;
    return null;
  };

  const toRecordedShortcut = (event) => {
    const modifierCodes = new Set([
      'ControlLeft',
      'ControlRight',
      'ShiftLeft',
      'ShiftRight',
      'AltLeft',
      'AltRight',
      'MetaLeft',
      'MetaRight',
    ]);

    if (modifierCodes.has(event.code)) {
      return { shortcut: null, error: t('settings.shortcuts.recordNeedPrimary') };
    }

    const primary = getShortcutPrimaryKey(event);
    if (!primary) {
      return { shortcut: null, error: t('settings.shortcuts.recordUnsupported') };
    }

    const modifiers = [];
    if (event.ctrlKey) modifiers.push('ctrl');
    if (event.altKey) modifiers.push('alt');
    if (event.shiftKey) modifiers.push('shift');
    if (event.metaKey) modifiers.push('super');

    if (modifiers.length === 0) {
      return { shortcut: null, error: t('settings.shortcuts.recordNeedModifier') };
    }

    const recorded = `${modifiers.join('+')}+${primary}`;
    if (isReservedShortcut(recorded)) {
      return {
        shortcut: null,
        error: t('settings.shortcuts.recordReserved', { shortcut: recorded }),
      };
    }

    return { shortcut: recorded, error: null };
  };

  const startShortcutRecording = (target) => {
    setShortcutError('');
    setRecordingTarget(target);
  };

  const stopShortcutRecording = () => {
    setRecordingTarget(null);
  };

  const restoreShortcutDefaults = async () => {
    setRecordingTarget(null);
    await saveShortcutConfig({
      ...generalConfig,
      ctrl_shift_c_shortcut_enabled: false,
      copy_pin_shortcut: 'ctrl+shift+c',
      toggle_window_shortcut_enabled: true,
      toggle_window_shortcut: 'alt+x',
      history_tag_shortcut_enabled: true,
    });
  };

  useEffect(() => {
    loadConfigs();
  }, []);

  useEffect(() => {
    if (!recordingTarget) return undefined;

    const onRecordKeyDown = async (event) => {
      event.preventDefault();
      event.stopPropagation();

      if (event.repeat) return;
      if (event.key === 'Escape') {
        stopShortcutRecording();
        return;
      }

      const { shortcut, error } = toRecordedShortcut(event);
      if (!shortcut) {
        setShortcutError(error);
        return;
      }

      stopShortcutRecording();

      if (recordingTarget === 'toggle_window_shortcut') {
        await saveShortcutConfig({
          ...generalConfig,
          toggle_window_shortcut: shortcut,
        }, 'toggle_window_shortcut');
        return;
      }

      if (recordingTarget === 'copy_pin_shortcut') {
        await saveShortcutConfig({
          ...generalConfig,
          copy_pin_shortcut: shortcut,
        }, 'copy_pin_shortcut');
      }
    };

    window.addEventListener('keydown', onRecordKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onRecordKeyDown, true);
    };
  }, [generalConfig, recordingTarget, t]);

  useEffect(() => {
    if (activeTab !== 'shortcuts' && recordingTarget) {
      setRecordingTarget(null);
    }
  }, [activeTab, recordingTarget]);
  const getProviderKey = (provider) => {
    if (typeof provider === 'string') {
      if (provider === 'SiliconFlow') return 'siliconflow';
      if (provider === 'Volcano') return 'volcano';
      if (provider === 'Alibaba') return 'alibaba';
      return provider.toLowerCase();
    }
    if (provider.SiliconFlow !== undefined) return 'siliconflow';
    if (provider.Volcano !== undefined) return 'volcano';
    if (provider.Alibaba !== undefined) return 'alibaba';
    if (provider.Custom) return `custom_${provider.Custom.name}`;
    return 'siliconflow';
  };
  useEffect(() => {
    if (aiConfig.current_provider) {
      const providerKey = getProviderKey(aiConfig.current_provider);
      const creds = aiConfig.credentials[providerKey];
      const loadModels = async () => {
        const provider = getAiProviderValue();
        try {
          const models = await invoke('get_ai_models', { provider });
          setAvailableModels(models);
          setCurrentAiApiKey(creds?.api_key || '');
          if (creds?.model) {
            setCurrentAiModel(creds.model);
          } else {
            const defaultModel = await invoke('get_default_ai_model', { provider });
            setCurrentAiModel(defaultModel);
          }
        } catch (error) {
          console.error('Settings operation failed:', error);
          setCurrentAiApiKey(creds?.api_key || '');
          setCurrentAiModel(creds?.model || '');
        }
      };
      loadModels();
    }
  }, [aiConfig.current_provider]); // Reload AI credentials when current provider changes.
  useEffect(() => {
    if (ocrConfig.current_provider) {
      const providerKey = ocrConfig.current_provider.toLowerCase();
      const creds = ocrConfig.credentials[providerKey];
      setCurrentOcrApiKey(creds?.api_key || '');
      setCurrentOcrApiSecret(creds?.api_secret || '');
    }
  }, [ocrConfig.current_provider, ocrConfig.credentials]);

  const loadConfigs = async () => {
    try {
      const [ai, ocr, mcp, mcpPort, general, share] = await Promise.all([
        invoke('get_ai_config'),
        invoke('get_ocr_config'),
        invoke('get_mcp_config'),
        invoke('get_mcp_port').catch(() => 38470),
        invoke('get_general_config'),
        invoke('get_share_config').catch(() => ({
          provider: 'ZeroX0',
          s3_config: null,
          force_upload_non_ascii_text: false,
        }))
      ]);
      const hasLock = await invoke('has_lock_password');
      setLockHasPassword(hasLock);
      setAiConfig(ai);
      if (ai.current_provider?.Custom) {
        setCustomName(ai.current_provider.Custom.name || '');
        setCustomUrl(ai.current_provider.Custom.base_url || '');
      } else if (typeof ai.current_provider === 'object' && ai.current_provider.Custom) {
        setCustomName(ai.current_provider.Custom.name || '');
        setCustomUrl(ai.current_provider.Custom.base_url || '');
      }

      setOcrConfig(ocr);
      setMcpConfig(mcp);
      setActualMcpPort(mcpPort);
      setGeneralConfig(general);
      // Migrate old FileIo provider name to ZeroX0 and normalize optional fields.
      const normalizedShareConfig = {
        provider: share.provider === 'FileIo' ? 'ZeroX0' : share.provider,
        s3_config: share.s3_config || null,
        force_upload_non_ascii_text: Boolean(share.force_upload_non_ascii_text),
      };
      setShareConfig(normalizedShareConfig);
    } catch (error) {
      console.error('Settings operation failed:', error);
    }
  };

  const handleClose = () => {
    if (onConfigChange) onConfigChange();
    onClose();
  };


  const handleIntegrationsSave = async () => {
    try {
      const aiProviderKey = getProviderKey(aiConfig.current_provider);
      const aiConfigToSave = {
        ...aiConfig,
        credentials: {
          ...aiConfig.credentials,
          [aiProviderKey]: {
            api_key: currentAiApiKey,
            model: currentAiModel,
          },
        },
      };

      const ocrProviderKey = ocrConfig.current_provider.toLowerCase();
      const ocrConfigToSave = {
        ...ocrConfig,
        credentials: {
          ...ocrConfig.credentials,
          [ocrProviderKey]: {
            api_key: currentOcrApiKey || null,
            api_secret: currentOcrApiSecret || null,
          },
        },
      };

      await Promise.all([
        invoke('update_ai_config', { config: aiConfigToSave }),
        invoke('update_ocr_config', { config: ocrConfigToSave }),
        invoke('update_mcp_config', { config: mcpConfig }),
        invoke('update_share_config', { config: shareConfig }),
      ]);

      setAiConfig(aiConfigToSave);
      setOcrConfig(ocrConfigToSave);
      handleClose();
    } catch (error) {
      console.error('save integrations config failed:', error);
      alert(t('error.saveFailed', { error: String(error) }));
    }
  };
  const handleAiTest = async () => {
    setAiTesting(true);
    setAiTestResult(null);
    try {
      const providerKey = getProviderKey(aiConfig.current_provider);
      const testConfig = {
        current_provider: aiConfig.current_provider,
        credentials: {
          ...aiConfig.credentials,
          [providerKey]: {
            api_key: currentAiApiKey,
            model: currentAiModel,
          },
        },
        enabled: true,
      };

      await invoke('test_ai_connection', { config: testConfig });
      setAiTestResult({ success: true, message: t('settings.ai.testSuccess') });
    } catch (error) {
      setAiTestResult({ success: false, message: t('settings.ai.testFailed', { error }) });
    } finally {
      setAiTesting(false);
    }
  };

  const handleOcrTest = async () => {
    setOcrTesting(true);
    setOcrTestResult(null);

    try {
      if (ocrConfig.current_provider !== 'Local' && !currentOcrApiKey) {
        console.error('api key is empty');
        setOcrTestResult({ success: false, message: t('settings.ocr.apiKeyRequired') });
        setOcrTesting(false);
        return;
      }

      const providerKey = ocrConfig.current_provider.toLowerCase();
      const testConfig = {
        ...ocrConfig,
        credentials: {
          ...ocrConfig.credentials,
          [providerKey]: {
            api_key: currentOcrApiKey || null,
            api_secret: currentOcrApiSecret || null,
          },
        },
      };
      await invoke('update_ocr_config', { config: testConfig });
      const available = await invoke('check_ocr_available');

      if (available) {
        setOcrTestResult({ success: true, message: t('settings.ocr.testSuccess') });
      } else {
        setOcrTestResult({ success: false, message: t('settings.ocr.serviceUnavailable') });
      }
    } catch (error) {
      console.error('ocr test failed:', error);
      setOcrTestResult({ success: false, message: t('settings.ocr.testFailed', { error }) });
    } finally {
      setOcrTesting(false);
    }
  };

  const getAiProviderValue = () => {
    if (!aiConfig.current_provider) return 'SiliconFlow';
    if (typeof aiConfig.current_provider === 'string') {
      return aiConfig.current_provider;
    }
    if (aiConfig.current_provider.SiliconFlow !== undefined) return 'SiliconFlow';
    if (aiConfig.current_provider.Volcano !== undefined) return 'Volcano';
    if (aiConfig.current_provider.Alibaba !== undefined) return 'Alibaba';
    if (aiConfig.current_provider.Custom) return 'Custom';
    return 'SiliconFlow';
  };

  const handleAiProviderChange = async (value) => {
    try {
      const oldProviderKey = getProviderKey(aiConfig.current_provider);
      const configToSave = {
        ...aiConfig,
        credentials: {
          ...aiConfig.credentials,
          [oldProviderKey]: {
            api_key: currentAiApiKey,
            model: currentAiModel,
          },
        },
      };
      await invoke('update_ai_config', { config: configToSave });
      let newProvider;
      if (value === 'Custom') {
        newProvider = { Custom: { name: customName || t('settings.ai.providers.Custom'), base_url: customUrl || '' } };
      } else {
        newProvider = value;
      }
      const newConfig = {
        ...configToSave,
        current_provider: newProvider,
      };
      await invoke('update_ai_config', { config: newConfig });
      const loadedConfig = await invoke('get_ai_config');
      setAiConfig(loadedConfig);
      const models = await invoke('get_ai_models', { provider: value });
      const defaultModel = await invoke('get_default_ai_model', { provider: value });
      setAvailableModels(models);
      const newProviderKey = getProviderKey(loadedConfig.current_provider);
      const newCreds = loadedConfig.credentials[newProviderKey];

      setCurrentAiApiKey(newCreds?.api_key || '');
      setCurrentAiModel(newCreds?.model || defaultModel);

    } catch (error) {
      console.error('Settings operation failed:', error);
      alert(t('error.updateFailed', { error: String(error) }));
    }
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
          <div className="settings-tabs">
            <button
              className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              {t('settings.tabs.general')}
            </button>
            <button
              className={`tab-btn ${activeTab === 'shortcuts' ? 'active' : ''}`}
              onClick={() => setActiveTab('shortcuts')}
            >
              {t('settings.tabs.shortcuts')}
            </button>
            <button
              className={`tab-btn ${isIntegrationTab ? 'active' : ''}`}
              onClick={openIntegrations}
            >
              {t('settings.general.featureModules')}
            </button>
            <button
              className={`tab-btn ${isDataSecurityTab ? 'active' : ''}`}
              onClick={openDataSecurity}
            >
              {`${t('settings.tabs.data')} / ${t('settings.tabs.security')}`}
            </button>
          </div>

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
            <div className="settings-content">
            <div className="setting-group-title section-title">{t('settings.general.featureModules')}</div>
            <div className="setting-group">
              <label className="sg-row setting-toggle-row">
                <span className="toggle-label-group">
                  <span className="toggle-label">{t('settings.general.enableAI')}</span>
                  <span className="toggle-desc">{t('settings.general.enableAIHint')}</span>
                </span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={aiConfig.enabled}
                    onChange={async (e) => {
                      const updated = { ...aiConfig, enabled: e.target.checked };
                      setAiConfig(updated);
                      try {
                        await invoke('update_ai_config', { config: updated });
                      } catch (error) {
                        console.error('save ai config failed:', error);
                      }
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              <label className="sg-row setting-toggle-row">
                <span className="toggle-label-group">
                  <span className="toggle-label">{t('settings.general.enableOCR')}</span>
                  <span className="toggle-desc">{t('settings.general.enableOCRHint')}</span>
                </span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={ocrConfig.enabled}
                    onChange={async (e) => {
                      const updated = { ...ocrConfig, enabled: e.target.checked };
                      setOcrConfig(updated);
                      try {
                        await invoke('update_ocr_config', { config: updated });
                      } catch (error) {
                        console.error('save ocr config failed:', error);
                      }
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              <label className="sg-row setting-toggle-row">
                <span className="toggle-label-group">
                  <span className="toggle-label">{t('settings.general.enableMCP')}</span>
                  <span className="toggle-desc">{t('settings.general.enableMCPHint')}</span>
                </span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={mcpConfig.enabled}
                    onChange={async (e) => {
                      const updated = { ...mcpConfig, enabled: e.target.checked };
                      setMcpConfig(updated);
                      try {
                        await invoke('update_mcp_config', { config: updated });
                      } catch (error) {
                        console.error('save mcp config failed:', error);
                      }
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
            </div>
            {aiConfig.enabled && (
              <>
                <div className="setting-group-title section-title">{t('settings.tabs.ai')}</div>
                <div className="setting-item">
              <label>{t('settings.ai.provider')}</label>
              <select
                value={getAiProviderValue()}
                onChange={(e) => handleAiProviderChange(e.target.value)}
                className="setting-select"
              >
                {AI_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {t(`settings.ai.providers.${provider}`)}
                  </option>
                ))}
              </select>
            </div>

            {getAiProviderValue() === 'Custom' && (
              <>
                <div className="setting-item">
                  <label>{t('settings.ai.customName')}</label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => {
                      setCustomName(e.target.value);
                      const currentCustom = typeof aiConfig.current_provider === 'object' && aiConfig.current_provider.Custom
                        ? aiConfig.current_provider.Custom
                        : { name: customName, base_url: customUrl };
                      setAiConfig({
                        ...aiConfig,
                        current_provider: {
                          Custom: { ...currentCustom, name: e.target.value },
                        },
                      });
                    }}
                    placeholder={t('settings.ai.customNamePlaceholder')}
                    className="setting-input"
                  />
                </div>
                <div className="setting-item">
                  <label>{t('settings.ai.customUrl')}</label>
                  <input
                    type="text"
                    value={customUrl}
                    onChange={(e) => {
                      setCustomUrl(e.target.value);
                      const currentCustom = typeof aiConfig.current_provider === 'object' && aiConfig.current_provider.Custom
                        ? aiConfig.current_provider.Custom
                        : { name: customName, base_url: customUrl };
                      setAiConfig({
                        ...aiConfig,
                        current_provider: {
                          Custom: { ...currentCustom, base_url: e.target.value },
                        },
                      });
                    }}
                    placeholder={t('settings.ai.customUrlPlaceholder')}
                    className="setting-input"
                  />
                </div>
              </>
            )}

            <div className="setting-item">
              <label>{t('settings.ai.apiKey')}</label>
              <div className="password-input-wrapper">
                <input
                  type={showAiApiKey ? "text" : "password"}
                  value={currentAiApiKey}
                  onChange={(e) => setCurrentAiApiKey(e.target.value)}
                  placeholder={t('settings.ai.apiKeyPlaceholder')}
                  className="setting-input"
                />
                {currentAiApiKey && (
                  <button
                    type="button"
                    onClick={() => setShowAiApiKey(!showAiApiKey)}
                    className="password-toggle-btn"
                  >
                    {showAiApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
              </div>
            </div>

            <div className="setting-item">
              <label>{t('settings.ai.model')}</label>
              {getAiProviderValue() === 'Volcano' ? (
                <>
                  <input
                    type="text"
                    value={currentAiModel}
                    onChange={(e) => setCurrentAiModel(e.target.value)}
                    placeholder={t('settings.ai.modelPlaceholder')}
                    className="setting-input"
                  />
                  <small className="setting-hint">
                    {t('settings.ai.volcanoModelHint')}
                  </small>
                </>
              ) : (
                <select
                  value={currentAiModel}
                  onChange={(e) => setCurrentAiModel(e.target.value)}
                  className="setting-select"
                >
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="setting-actions">
              <button onClick={handleAiTest} disabled={aiTesting} className="test-btn">
                {aiTesting ? t('settings.testing') : t('settings.test')}
              </button>
              {aiTestResult && (
                <span className={`test-result ${aiTestResult.success ? 'success' : 'error'}`}>
                  {aiTestResult.message}
                </span>
              )}
            </div>
              </>
            )}
            </div>
          )}

          {activeTab === 'integrations' && ocrConfig.enabled && (
            <div className="settings-content">
            <div className="setting-group-title section-title">{t('settings.tabs.ocr')}</div>
            <div className="setting-group">
              <label className="sg-row setting-toggle-row">
                <span>{t('settings.ocr.autoOcr')}</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={ocrConfig.auto_ocr}
                    onChange={(e) => setOcrConfig({ ...ocrConfig, auto_ocr: e.target.checked })}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
            </div>

            <div className="setting-item">
              <label>{t('settings.ocr.provider')}</label>
              <select
                value={ocrConfig.current_provider}
                onChange={(e) => {
                  const oldProviderKey = ocrConfig.current_provider.toLowerCase();
                  const updatedCredentials = {
                    ...ocrConfig.credentials,
                    [oldProviderKey]: {
                      api_key: currentOcrApiKey || null,
                      api_secret: currentOcrApiSecret || null,
                    },
                  };
                  const newProviderKey = e.target.value.toLowerCase();
                  const newCreds = updatedCredentials[newProviderKey];

                  setOcrConfig({
                    ...ocrConfig,
                    current_provider: e.target.value,
                    credentials: updatedCredentials,
                  });
                  setCurrentOcrApiKey(newCreds?.api_key || '');
                  setCurrentOcrApiSecret(newCreds?.api_secret || '');
                }}
                className="setting-select"
              >
                {OCR_PROVIDERS.map((provider) => (
                  <option key={provider} value={provider}>
                    {t(`settings.ocr.providers.${provider}`)}
                  </option>
                ))}
              </select>
            </div>

            {ocrConfig.current_provider === 'Local' && (
              <div className="setting-item">
                <label>{t('settings.ocr.language')}</label>
                <input
                  type="text"
                  value={ocrConfig.language}
                  onChange={(e) => setOcrConfig({ ...ocrConfig, language: e.target.value })}
                  placeholder={t('settings.ocr.languagePlaceholder')}
                  className="setting-input"
                />
                <small className="setting-hint">
                  {t('settings.ocr.languageHint')}
                </small>
              </div>
            )}

            {ocrConfig.current_provider !== 'Local' && (
              <div className="setting-item">
                <label>{t('settings.ocr.apiKey')}</label>
                <div className="password-input-wrapper">
                  <input
                    type={showOcrApiKey ? "text" : "password"}
                    value={currentOcrApiKey}
                    onChange={(e) => setCurrentOcrApiKey(e.target.value)}
                    placeholder={t('settings.ocr.apiKeyPlaceholder')}
                    className="setting-input"
                  />
                  {currentOcrApiKey && (
                    <button
                      type="button"
                      onClick={() => setShowOcrApiKey(!showOcrApiKey)}
                      className="password-toggle-btn"
                    >
                      {showOcrApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  )}
                </div>
              </div>
            )}

            {ocrConfig.current_provider === 'Local' && (
              <div className="setting-item">
                <div className="info-box">
                  <strong>{t('settings.ocr.localInfo.title')}</strong>
                  <ul>
                    <li>{t('settings.ocr.localInfo.windows')}</li>
                    <li>{t('settings.ocr.localInfo.macos')}</li>
                    <li>{t('settings.ocr.localInfo.linux')}</li>
                  </ul>
                </div>
              </div>
            )}

            <div className="setting-actions">
              <button onClick={handleOcrTest} disabled={ocrTesting} className="test-btn">
                {ocrTesting ? t('settings.testing') : t('settings.test')}
              </button>
              {ocrTestResult && (
                <span className={`test-result ${ocrTestResult.success ? 'success' : 'error'}`}>
                  {ocrTestResult.message}
                </span>
              )}
            </div>
            </div>
          )}

          {activeTab === 'integrations' && mcpConfig.enabled && (
            <div className="settings-content">
            <div className="setting-group-title section-title">{t('settings.tabs.mcp')}</div>
            <div className="setting-item">
              <label>{t('settings.mcp.port')}</label>
              <input
                type="number"
                value={mcpConfig.port || 38470}
                onChange={(e) => setMcpConfig({ ...mcpConfig, port: parseInt(e.target.value) || 38470 })}
                onWheel={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const currentValue = mcpConfig.port || 38470;
                  const value = getWheelNextNumber({
                    rawValue: e.currentTarget.value,
                    fallback: currentValue,
                    min: 1024,
                    max: 65535,
                    deltaY: e.deltaY,
                  });
                  if (value === currentValue) return;
                  setMcpConfig({ ...mcpConfig, port: value });
                }}
                placeholder="38470"
                className="setting-input"
                min="1024"
                max="65535"
              />
              <small className="setting-hint">
                {t('settings.mcp.portHint')}
                {actualMcpPort !== mcpConfig.port && (
                  <span className="setting-warning-inline">
                    {t('settings.mcp.actualPort', { port: actualMcpPort })}
                  </span>
                )}
              </small>
            </div>

            <div className="setting-item">
              <div className="info-box">
                <strong>{t('settings.mcp.info.title')}</strong>
                <ul>
                  <li>{t('settings.mcp.info.search')}</li>
                  <li>{t('settings.mcp.info.recent')}</li>
                  <li>{t('settings.mcp.info.get')}</li>
                  <li>{t('settings.mcp.info.add')}</li>
                  <li>{t('settings.mcp.info.delete')}</li>
                  <li>{t('settings.mcp.info.stats')}</li>
                </ul>
              </div>
            </div>

            <div className="setting-item">
              <div className="info-box">
                <strong>{t('settings.mcp.usage.title')}</strong>
                <p>{t('settings.mcp.usage.description')}</p>
                <pre className="code-block">
{`{
  "mcpServers": {
    "pasteharbor": {
      "url": "http://localhost:${actualMcpPort}/mcp"
    }
  }
}`}
                </pre>
                <button
                  onClick={() => {
                    const config = `{
  "mcpServers": {
    "pasteharbor": {
      "url": "http://localhost:${actualMcpPort}/mcp"
    }
  }
}`;
                    navigator.clipboard.writeText(config);
                    setCopySuccess(true);
                    setTimeout(() => setCopySuccess(false), 2000);
                  }}
                  className={`test-btn${copySuccess ? ' copy-done' : ''}`}
                >
                  {copySuccess ? '[OK] ' + t('settings.mcp.configCopied') : t('settings.mcp.copyConfig')}
                </button>
              </div>
            </div>
            </div>
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
            <IntegrationsShareSection
              t={t}
              shareConfig={shareConfig}
              setShareConfig={setShareConfig}
              shareTesting={shareTesting}
              setShareTesting={setShareTesting}
              shareTestResult={shareTestResult}
              setShareTestResult={setShareTestResult}
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
