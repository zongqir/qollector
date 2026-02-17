import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { X, Eye, EyeOff } from 'lucide-react';
import useAppStore from './store/useAppStore';
import './Settings.css';

const AI_PROVIDERS = [
  { value: 'SiliconFlow', label: '硅基流动' },
  { value: 'Volcano', label: '火山引擎' },
  { value: 'Alibaba', label: '阿里云' },
  { value: 'Custom', label: '自定义' },
];

const OCR_PROVIDERS = [
  { value: 'Local', label: '本地 Tesseract' },
  { value: 'SiliconFlow', label: '硅基流动 OCR' },
  { value: 'DeepSeek', label: 'DeepSeek OCR' },
  { value: 'Aliyun', label: '阿里云 OCR' },
  { value: 'Tencent', label: '腾讯云 OCR' },
  { value: 'Baidu', label: '百度 OCR' },
];

function Settings({ onClose, themeMode, onThemeModeChange, onConfigChange }) {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState('general');

  // AI 配置：新结构
  const [aiConfig, setAiConfig] = useState({
    current_provider: { SiliconFlow: null },
    credentials: {},  // { "siliconflow": { api_key: "xxx", model: "xxx" }, ... }
    enabled: false,
  });

  // OCR 配置：新结构
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
    max_pinned_items: 3,
    language: 'zh-CN',
    theme_mode: themeMode || 'system',
    double_copy_emphasis_enabled: true,
    double_copy_window_ms: 900,
    ctrl_shift_c_shortcut_enabled: false,
    copy_pin_shortcut: 'ctrl+shift+c',
    toggle_window_shortcut_enabled: true,
    toggle_window_shortcut: 'alt+x',
    auto_cleanup_enabled: true,
    cleanup_max_items: 50000,
    cleanup_max_age_days: 90,
  });
  const [actualMcpPort, setActualMcpPort] = useState(38470);
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [availableModels, setAvailableModels] = useState([]);

  // 当前 AI 供应商的凭证（用于 UI 显示和编辑）
  const [currentAiApiKey, setCurrentAiApiKey] = useState('');
  const [currentAiModel, setCurrentAiModel] = useState('Qwen/Qwen2.5-7B-Instruct');
  const [showAiApiKey, setShowAiApiKey] = useState(false);

  // 应用锁状态
  const [lockHasPassword, setLockHasPassword] = useState(false);
  const [lockOldPassword, setLockOldPassword] = useState('');
  const [lockNewPassword, setLockNewPassword] = useState('');
  const [lockConfirmPassword, setLockConfirmPassword] = useState('');
  const [lockError, setLockError] = useState('');
  const [lockSuccess, setLockSuccess] = useState('');

  // 当前 OCR 供应商的凭证（用于 UI 显示和编辑）
  const [currentOcrApiKey, setCurrentOcrApiKey] = useState('');
  const [currentOcrApiSecret, setCurrentOcrApiSecret] = useState('');
  const [showOcrApiKey, setShowOcrApiKey] = useState(false);

  // 导入导出状态
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
  const [shareConfig, setShareConfig] = useState({ provider: 'ZeroX0', s3_config: null });
  const [shareTestResult, setShareTestResult] = useState(null);
  const [shareTesting, setShareTesting] = useState(false);

  const changeLanguage = async (lng) => {
    i18n.changeLanguage(lng);
    localStorage.setItem('language', lng);
    const updated = { ...generalConfig, language: lng };
    setGeneralConfig(updated);
    try {
      await invoke('update_general_config', { config: updated });
    } catch (error) {
      console.error('保存语言配置失败:', error);
    }
  };

  const normalizeShortcutText = (value) => (value || '').trim().toLowerCase();

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
      return;
    }
    if (recordingTarget === 'toggle_window_shortcut' && !generalConfig.toggle_window_shortcut_enabled) {
      setRecordingTarget(null);
      return;
    }
    if (recordingTarget === 'copy_pin_shortcut' && !generalConfig.ctrl_shift_c_shortcut_enabled) {
      setRecordingTarget(null);
    }
  }, [
    activeTab,
    recordingTarget,
    generalConfig.toggle_window_shortcut_enabled,
    generalConfig.ctrl_shift_c_shortcut_enabled,
  ]);

  // 辅助函数：获取供应商的键名
  const getProviderKey = (provider) => {
    // 处理字符串格式（后端序列化的格式）
    if (typeof provider === 'string') {
      if (provider === 'SiliconFlow') return 'siliconflow';
      if (provider === 'Volcano') return 'volcano';
      if (provider === 'Alibaba') return 'alibaba';
      return provider.toLowerCase();
    }

    // 处理对象格式（前端使用的格式）
    if (provider.SiliconFlow !== undefined) return 'siliconflow';
    if (provider.Volcano !== undefined) return 'volcano';
    if (provider.Alibaba !== undefined) return 'alibaba';
    if (provider.Custom) return `custom_${provider.Custom.name}`;
    return 'siliconflow';
  };

  // 当 AI 配置加载或供应商切换时，更新当前凭证
  useEffect(() => {
    if (aiConfig.current_provider) {
      const providerKey = getProviderKey(aiConfig.current_provider);
      const creds = aiConfig.credentials[providerKey];

      // 加载模型列表
      const loadModels = async () => {
        const provider = getAiProviderValue();
        try {
          const models = await invoke('get_ai_models', { provider });
          setAvailableModels(models);

          // 设置 API Key 和模型
          // 注意：这里只在初次加载时设置，不要在每次 credentials 变化时都覆盖
          setCurrentAiApiKey(creds?.api_key || '');

          // 如果有保存的模型，使用保存的；否则使用默认模型
          if (creds?.model) {
            setCurrentAiModel(creds.model);
          } else {
            const defaultModel = await invoke('get_default_ai_model', { provider });
            setCurrentAiModel(defaultModel);
          }
        } catch (error) {
          console.error('获取模型列表失败:', error);
          // 即使失败也要设置凭证
          setCurrentAiApiKey(creds?.api_key || '');
          setCurrentAiModel(creds?.model || '');
        }
      };
      loadModels();
    }
  }, [aiConfig.current_provider]); // 只依赖 current_provider，不依赖 credentials

  // 当 OCR 配置加载或供应商切换时，更新当前凭证
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
      console.log('📥 加载配置...');
      const [ai, ocr, mcp, mcpPort, general, share] = await Promise.all([
        invoke('get_ai_config'),
        invoke('get_ocr_config'),
        invoke('get_mcp_config'),
        invoke('get_mcp_port').catch(() => 38470),
        invoke('get_general_config'),
        invoke('get_share_config').catch(() => ({ provider: 'ZeroX0', s3_config: null }))
      ]);
      console.log('后端返回的 AI 配置:', ai);
      console.log('后端返回的 OCR 配置:', ocr);
      console.log('后端返回的 MCP 配置:', mcp);
      console.log('MCP 实际端口:', mcpPort);
      console.log('后端返回的通用配置:', general);

      // 检查锁屏密码状态
      const hasLock = await invoke('has_lock_password');
      setLockHasPassword(hasLock);

      // 设置 AI 配置
      setAiConfig(ai);

      // 如果是自定义供应商，设置 customName 和 customUrl
      if (ai.current_provider?.Custom) {
        setCustomName(ai.current_provider.Custom.name || '');
        setCustomUrl(ai.current_provider.Custom.base_url || '');
      } else if (typeof ai.current_provider === 'object' && ai.current_provider.Custom) {
        // 处理对象格式的 Custom
        setCustomName(ai.current_provider.Custom.name || '');
        setCustomUrl(ai.current_provider.Custom.base_url || '');
      }

      setOcrConfig(ocr);
      setMcpConfig(mcp);
      setActualMcpPort(mcpPort);
      setGeneralConfig(general);
      // Migrate old FileIo provider name to ZeroX0
      if (share.provider === 'FileIo') {
        share.provider = 'ZeroX0';
      }
      setShareConfig(share);
      console.log('✅ 配置加载完成');
    } catch (error) {
      console.error('❌ 加载配置失败:', error);
    }
  };

  const handleClose = () => {
    if (onConfigChange) onConfigChange();
    onClose();
  };

  const handleAiSave = async () => {
    try {
      // 保存当前供应商的凭证到 credentials 对象
      const providerKey = getProviderKey(aiConfig.current_provider);
      const updatedCredentials = {
        ...aiConfig.credentials,
        [providerKey]: {
          api_key: currentAiApiKey,
          model: currentAiModel,
        },
      };

      const configToSave = {
        ...aiConfig,
        credentials: updatedCredentials,
      };

      await invoke('update_ai_config', { config: configToSave });

      // 更新前端状态，确保下次打开时显示正确
      setAiConfig(configToSave);

      handleClose();
    } catch (error) {
      console.error('保存 AI 配置失败:', error);
      alert('保存失败: ' + error);
    }
  };

  const handleOcrSave = async () => {
    try {
      // 保存当前供应商的凭证到 credentials 对象
      const providerKey = ocrConfig.current_provider.toLowerCase();
      const updatedCredentials = {
        ...ocrConfig.credentials,
        [providerKey]: {
          api_key: currentOcrApiKey || null,
          api_secret: currentOcrApiSecret || null,
        },
      };

      const configToSave = {
        ...ocrConfig,
        credentials: updatedCredentials,
      };

      await invoke('update_ocr_config', { config: configToSave });

      // 更新前端状态，确保下次打开时显示正确
      setOcrConfig(configToSave);

      handleClose();
    } catch (error) {
      console.error('保存 OCR 配置失败:', error);
      alert('保存失败: ' + error);
    }
  };

  const handleMcpSave = async () => {
    try {
      await invoke('update_mcp_config', { config: mcpConfig });
      handleClose();
    } catch (error) {
      console.error('保存 MCP 配置失败:', error);
      alert('保存失败: ' + error);
    }
  };

  const handleAiTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // 构造测试配置
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
      setTestResult({ success: true, message: t('settings.ai.testSuccess') });
    } catch (error) {
      setTestResult({ success: false, message: t('settings.ai.testFailed', { error }) });
    } finally {
      setTesting(false);
    }
  };

  const handleOcrTest = async () => {
    setTesting(true);
    setTestResult(null);

    console.log('=== OCR 测试开始 ===');
    console.log('当前配置:', ocrConfig);

    try {
      // 验证配置
      if (ocrConfig.current_provider !== 'Local' && !currentOcrApiKey) {
        console.error('❌ API Key 为空');
        setTestResult({ success: false, message: t('settings.ocr.apiKeyRequired') });
        setTesting(false);
        return;
      }

      // 构造测试配置
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

      console.log('准备保存的配置:', testConfig);

      // 先保存配置
      console.log('📤 发送配置到后端...');
      await invoke('update_ocr_config', { config: testConfig });
      console.log('✅ 配置保存成功');

      // 然后测试可用性
      console.log('🔍 检查服务可用性...');
      const available = await invoke('check_ocr_available');
      console.log('可用性结果:', available);

      if (available) {
        console.log('✅ OCR 服务可用');
        setTestResult({ success: true, message: t('settings.ocr.testSuccess') });
      } else {
        console.error('❌ OCR 服务不可用');
        setTestResult({ success: false, message: t('settings.ocr.serviceUnavailable') });
      }
    } catch (error) {
      console.error('❌ OCR 测试失败:', error);
      setTestResult({ success: false, message: t('settings.ocr.testFailed', { error }) });
    } finally {
      setTesting(false);
      console.log('=== OCR 测试结束 ===');
    }
  };

  const getAiProviderValue = () => {
    if (!aiConfig.current_provider) return 'SiliconFlow';

    // 处理字符串格式（后端序列化的格式）
    if (typeof aiConfig.current_provider === 'string') {
      return aiConfig.current_provider;
    }

    // 处理对象格式（前端使用的格式）
    if (aiConfig.current_provider.SiliconFlow !== undefined) return 'SiliconFlow';
    if (aiConfig.current_provider.Volcano !== undefined) return 'Volcano';
    if (aiConfig.current_provider.Alibaba !== undefined) return 'Alibaba';
    if (aiConfig.current_provider.Custom) return 'Custom';
    return 'SiliconFlow';
  };

  const handleAiProviderChange = async (value) => {
    try {
      // 1. 先保存当前供应商的配置到数据库
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

      // 2. 构造新的 provider
      let newProvider;
      if (value === 'Custom') {
        newProvider = { Custom: { name: customName || '自定义', base_url: customUrl || '' } };
      } else {
        newProvider = value;
      }

      // 3. 切换到新供应商并保存
      const newConfig = {
        ...configToSave,
        current_provider: newProvider,
      };
      await invoke('update_ai_config', { config: newConfig });

      // 4. 从数据库重新加载配置
      const loadedConfig = await invoke('get_ai_config');
      setAiConfig(loadedConfig);

      // 5. 加载新供应商的模型列表
      const models = await invoke('get_ai_models', { provider: value });
      const defaultModel = await invoke('get_default_ai_model', { provider: value });
      setAvailableModels(models);

      // 6. 从加载的配置中读取新供应商的凭证
      const newProviderKey = getProviderKey(loadedConfig.current_provider);
      const newCreds = loadedConfig.credentials[newProviderKey];

      setCurrentAiApiKey(newCreds?.api_key || '');
      setCurrentAiModel(newCreds?.model || defaultModel);

    } catch (error) {
      console.error('切换供应商失败:', error);
      alert('切换失败: ' + error);
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
            className={`tab-btn ${activeTab === 'ai' ? 'active' : ''} ${!aiConfig.enabled ? 'disabled' : ''}`}
            onClick={() => aiConfig.enabled && setActiveTab('ai')}
            disabled={!aiConfig.enabled}
          >
            {t('settings.tabs.ai')}
          </button>
          <button
            className={`tab-btn ${activeTab === 'ocr' ? 'active' : ''} ${!ocrConfig.enabled ? 'disabled' : ''}`}
            onClick={() => ocrConfig.enabled && setActiveTab('ocr')}
            disabled={!ocrConfig.enabled}
          >
            {t('settings.tabs.ocr')}
          </button>
          <button
            className={`tab-btn ${activeTab === 'mcp' ? 'active' : ''} ${!mcpConfig.enabled ? 'disabled' : ''}`}
            onClick={() => mcpConfig.enabled && setActiveTab('mcp')}
            disabled={!mcpConfig.enabled}
          >
            {t('settings.tabs.mcp')}
          </button>
          <button
            className={`tab-btn ${activeTab === 'data' ? 'active' : ''}`}
            onClick={() => setActiveTab('data')}
          >
            {t('settings.tabs.data')}
          </button>
          <button
            className={`tab-btn ${activeTab === 'security' ? 'active' : ''}`}
            onClick={() => setActiveTab('security')}
          >
            {t('settings.tabs.security')}
          </button>
          <button
            className={`tab-btn ${activeTab === 'share' ? 'active' : ''}`}
            onClick={() => setActiveTab('share')}
          >
            {t('settings.tabs.share')}
          </button>
        </div>

        {activeTab === 'general' && (
          <div className="settings-content">
            {/* 外观设置分组 */}
            <div className="setting-group">
              <div className="sg-row">
                <span>{t('settings.general.language')}</span>
                <select
                  value={i18n.language}
                  onChange={(e) => changeLanguage(e.target.value)}
                  className="setting-select"
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                </select>
              </div>
              <div className="sg-row">
                <span>{t('settings.general.theme')}</span>
                <select
                  value={generalConfig.theme_mode || 'system'}
                  onChange={async (e) => {
                    const newMode = e.target.value;
                    const updated = { ...generalConfig, theme_mode: newMode };
                    setGeneralConfig(updated);
                    if (onThemeModeChange) onThemeModeChange(newMode);
                    try {
                      await invoke('update_general_config', { config: updated });
                    } catch (error) {
                      console.error('保存主题配置失败:', error);
                    }
                  }}
                  className="setting-select"
                >
                  <option value="system">{t('settings.general.themeSystem')}</option>
                  <option value="light">{t('settings.general.themeLight')}</option>
                  <option value="dark">{t('settings.general.themeDark')}</option>
                </select>
              </div>
              <div className="sg-row">
                <span>{t('settings.general.maxPinnedItems')}</span>
                <input
                  type="number"
                  value={generalConfig.max_pinned_items}
                  onChange={async (e) => {
                    let value = parseInt(e.target.value) || 3;
                    if (value < 1) value = 1;
                    if (value > 10) value = 10;
                    const updated = { ...generalConfig, max_pinned_items: value };
                    setGeneralConfig(updated);
                    try {
                      await invoke('update_general_config', { config: updated });
                    } catch (error) {
                      console.error('保存置顶数配置失败:', error);
                    }
                  }}
                  min="1"
                  max="10"
                  className="setting-input-small"
                />
              </div>
            </div>
            {generalConfig.max_pinned_items > 5 && (
              <small className="setting-hint">
                <span className="setting-warning">
                  {t('settings.general.maxPinnedItemsWarning')}
                </span>
              </small>
            )}

            {/* 功能模块分组 */}
            <div className="setting-group-title">{t('settings.general.featureModules')}</div>
            <div className="feature-toggles">
              <label className="setting-toggle-row">
                <span className="toggle-label-group">
                  <span className="toggle-label">{t('settings.general.autoPaste')}</span>
                  <span className="toggle-desc">{t('settings.general.autoPasteHint')}</span>
                </span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={generalConfig.auto_paste_on_double_click || false}
                    onChange={async (e) => {
                      const checked = e.target.checked;
                      const updated = { ...generalConfig, auto_paste_on_double_click: checked };
                      setGeneralConfig(updated);
                      useAppStore.setState({ autoPasteOnDoubleClick: checked });
                      try {
                        await invoke('update_general_config', { config: updated });
                      } catch (error) {
                        console.error('save auto_paste config failed:', error);
                      }
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              <label className="setting-toggle-row">
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
                      if (!e.target.checked && activeTab === 'ai') setActiveTab('general');
                      try {
                        await invoke('update_ai_config', { config: updated });
                      } catch (error) {
                        console.error('保存 AI 配置失败:', error);
                      }
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              <label className="setting-toggle-row">
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
                      if (!e.target.checked && activeTab === 'ocr') setActiveTab('general');
                      try {
                        await invoke('update_ocr_config', { config: updated });
                      } catch (error) {
                        console.error('保存 OCR 配置失败:', error);
                      }
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              <label className="setting-toggle-row">
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
                      if (!e.target.checked && activeTab === 'mcp') setActiveTab('general');
                      try {
                        await invoke('update_mcp_config', { config: updated });
                      } catch (error) {
                        console.error('保存 MCP 配置失败:', error);
                      }
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
            </div>
          </div>
        )}

        {activeTab === 'shortcuts' && (
          <div className="settings-content">
            <div className="setting-group-title">{t('settings.shortcuts.globalHotkeys')}</div>
            <div className="setting-group">
              <label className="sg-row setting-toggle-row">
                <span>{t('settings.shortcuts.toggleWindow')}</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(generalConfig.toggle_window_shortcut_enabled)}
                    onChange={async (e) => {
                      await saveShortcutConfig({
                        ...generalConfig,
                        toggle_window_shortcut_enabled: e.target.checked,
                      }, 'toggle_window_shortcut');
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              <div className="sg-row">
                <span>{t('settings.shortcuts.toggleWindowKey')}</span>
                <div className="shortcut-editor">
                  <input
                    type="text"
                    value={generalConfig.toggle_window_shortcut ?? 'alt+x'}
                    onChange={(e) => {
                      setGeneralConfig({
                        ...generalConfig,
                        toggle_window_shortcut: e.target.value,
                      });
                    }}
                    onBlur={async () => {
                      const normalized = normalizeShortcutText(generalConfig.toggle_window_shortcut);
                      await saveShortcutConfig({
                        ...generalConfig,
                        toggle_window_shortcut: normalized || 'alt+x',
                      }, 'toggle_window_shortcut');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    className="shortcut-input"
                    disabled={!generalConfig.toggle_window_shortcut_enabled || recordingTarget === 'toggle_window_shortcut'}
                  />
                  <button
                    type="button"
                    className={`shortcut-record-btn ${recordingTarget === 'toggle_window_shortcut' ? 'recording' : ''}`}
                    onClick={() => {
                      if (recordingTarget === 'toggle_window_shortcut') {
                        stopShortcutRecording();
                      } else {
                        startShortcutRecording('toggle_window_shortcut');
                      }
                    }}
                    disabled={!generalConfig.toggle_window_shortcut_enabled}
                  >
                    {recordingTarget === 'toggle_window_shortcut'
                      ? t('settings.shortcuts.stopRecording')
                      : t('settings.shortcuts.startRecording')}
                  </button>
                </div>
              </div>
              <label className="sg-row setting-toggle-row">
                <span>{t('settings.shortcuts.ctrlShiftC')}</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(generalConfig.ctrl_shift_c_shortcut_enabled)}
                    onChange={async (e) => {
                      await saveShortcutConfig({
                        ...generalConfig,
                        ctrl_shift_c_shortcut_enabled: e.target.checked,
                      }, 'copy_pin_shortcut');
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              <div className="sg-row">
                <span>{t('settings.shortcuts.ctrlShiftCKey')}</span>
                <div className="shortcut-editor">
                  <input
                    type="text"
                    value={generalConfig.copy_pin_shortcut ?? 'ctrl+shift+c'}
                    onChange={(e) => {
                      setGeneralConfig({
                        ...generalConfig,
                        copy_pin_shortcut: e.target.value,
                      });
                    }}
                    onBlur={async () => {
                      const normalized = normalizeShortcutText(generalConfig.copy_pin_shortcut);
                      await saveShortcutConfig({
                        ...generalConfig,
                        copy_pin_shortcut: normalized || 'ctrl+shift+c',
                      }, 'copy_pin_shortcut');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                    className="shortcut-input"
                    disabled={!generalConfig.ctrl_shift_c_shortcut_enabled || recordingTarget === 'copy_pin_shortcut'}
                  />
                  <button
                    type="button"
                    className={`shortcut-record-btn ${recordingTarget === 'copy_pin_shortcut' ? 'recording' : ''}`}
                    onClick={() => {
                      if (recordingTarget === 'copy_pin_shortcut') {
                        stopShortcutRecording();
                      } else {
                        startShortcutRecording('copy_pin_shortcut');
                      }
                    }}
                    disabled={!generalConfig.ctrl_shift_c_shortcut_enabled}
                  >
                    {recordingTarget === 'copy_pin_shortcut'
                      ? t('settings.shortcuts.stopRecording')
                      : t('settings.shortcuts.startRecording')}
                  </button>
                </div>
              </div>
            </div>
            {recordingTarget && (
              <small className="setting-hint">{t('settings.shortcuts.recordingHint')}</small>
            )}
            <small className="setting-hint">{t('settings.shortcuts.ctrlShiftCHint')}</small>
            <small className="setting-hint">{t('settings.shortcuts.platformNotice')}</small>
            {shortcutError && (
              <small className="setting-hint">
                <span className="setting-warning">{shortcutError}</span>
              </small>
            )}
            <div className="shortcut-actions">
              <button
                type="button"
                className="shortcut-reset-btn"
                onClick={restoreShortcutDefaults}
              >
                {t('settings.shortcuts.restoreDefaults')}
              </button>
            </div>

            <div className="setting-group-title">{t('settings.shortcuts.emphasisCopy')}</div>
            <div className="setting-group">
              <label className="sg-row setting-toggle-row">
                <span className="toggle-label-group">
                  <span className="toggle-label">{t('settings.general.doubleCopyEmphasis')}</span>
                  <span className="toggle-desc">{t('settings.general.doubleCopyEmphasisHint')}</span>
                </span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(generalConfig.double_copy_emphasis_enabled)}
                    onChange={async (e) => {
                      const updated = {
                        ...generalConfig,
                        double_copy_emphasis_enabled: e.target.checked,
                      };
                      await saveShortcutConfig(updated);
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              <div className="sg-row">
                <span className="toggle-label-group">
                  <span className="toggle-label">{t('settings.general.doubleCopyWindowMs')}</span>
                  <span className="toggle-desc">{t('settings.general.doubleCopyWindowMsHint')}</span>
                </span>
                <input
                  type="number"
                  value={generalConfig.double_copy_window_ms ?? 900}
                  onChange={async (e) => {
                    let value = parseInt(e.target.value) || 900;
                    if (value < 300) value = 300;
                    if (value > 2500) value = 2500;
                    const updated = {
                      ...generalConfig,
                      double_copy_window_ms: value,
                    };
                    await saveShortcutConfig(updated);
                  }}
                  min="300"
                  max="2500"
                  step="50"
                  className="setting-input-small"
                />
              </div>
            </div>
            <small className="setting-hint">{t('settings.shortcuts.emphasisCopyHint')}</small>
          </div>
        )}

        {activeTab === 'ai' && (
          <div className="settings-content">
            <div className="setting-item">
              <label>{t('settings.ai.provider')}</label>
              <select
                value={getAiProviderValue()}
                onChange={(e) => handleAiProviderChange(e.target.value)}
                className="setting-select"
              >
                {AI_PROVIDERS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {t(`settings.ai.providers.${provider.value}`)}
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
                    placeholder="例如: doubao-seed-1-8-251228"
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
              <button onClick={handleAiTest} disabled={testing} className="test-btn">
                {testing ? t('settings.testing') : t('settings.test')}
              </button>
              {testResult && (
                <span className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                  {testResult.message}
                </span>
              )}
            </div>
          </div>
        )}

        {activeTab === 'ocr' && (
          <div className="settings-content">
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
                  // 保存当前供应商的凭证
                  const oldProviderKey = ocrConfig.current_provider.toLowerCase();
                  const updatedCredentials = {
                    ...ocrConfig.credentials,
                    [oldProviderKey]: {
                      api_key: currentOcrApiKey || null,
                      api_secret: currentOcrApiSecret || null,
                    },
                  };

                  // 切换到新供应商
                  const newProviderKey = e.target.value.toLowerCase();
                  const newCreds = updatedCredentials[newProviderKey];

                  setOcrConfig({
                    ...ocrConfig,
                    current_provider: e.target.value,
                    credentials: updatedCredentials,
                  });

                  // 更新 UI 显示的凭证
                  setCurrentOcrApiKey(newCreds?.api_key || '');
                  setCurrentOcrApiSecret(newCreds?.api_secret || '');
                }}
                className="setting-select"
              >
                {OCR_PROVIDERS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {t(`settings.ocr.providers.${provider.value}`)}
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
              <button onClick={handleOcrTest} disabled={testing} className="test-btn">
                {testing ? t('settings.testing') : t('settings.test')}
              </button>
              {testResult && (
                <span className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                  {testResult.message}
                </span>
              )}
            </div>
          </div>
        )}

        {activeTab === 'mcp' && (
          <div className="settings-content">
            <div className="setting-item">
              <label>{t('settings.mcp.port')}</label>
              <input
                type="number"
                value={mcpConfig.port || 38470}
                onChange={(e) => setMcpConfig({ ...mcpConfig, port: parseInt(e.target.value) || 38470 })}
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
    "clipbox": {
      "url": "http://localhost:${actualMcpPort}/mcp"
    }
  }
}`}
                </pre>
                <button
                  onClick={() => {
                    const config = `{
  "mcpServers": {
    "clipbox": {
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
                  {copySuccess ? '✓ ' + t('settings.mcp.configCopied') : t('settings.mcp.copyConfig')}
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'data' && (
          <div className="settings-content">
            <div className="setting-options-group">
              <label className="setting-toggle-row">
                <span>{t('settings.general.autoCleanup')}</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={generalConfig.auto_cleanup_enabled}
                    onChange={(e) => {
                      const updated = { ...generalConfig, auto_cleanup_enabled: e.target.checked };
                      setGeneralConfig(updated);
                      invoke('update_general_config', { config: updated });
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              <small className="setting-hint">{t('settings.general.autoCleanupHint')}</small>

              {generalConfig.auto_cleanup_enabled && (
                <>
                  <div className="setting-inline-row">
                    <span>{t('settings.general.cleanupMaxItems')}</span>
                    <input
                      type="number"
                      min={100}
                      max={999999}
                      value={generalConfig.cleanup_max_items}
                      onChange={(e) => {
                        const value = Math.max(100, Math.min(999999, parseInt(e.target.value) || 100));
                        const updated = { ...generalConfig, cleanup_max_items: value };
                        setGeneralConfig(updated);
                        invoke('update_general_config', { config: updated });
                      }}
                      className="setting-input compact"
                    />
                  </div>
                  <small className="setting-hint">{t('settings.general.cleanupMaxItemsHint')}</small>

                  <div className="setting-inline-row">
                    <span>{t('settings.general.cleanupMaxAgeDays')}</span>
                    <input
                      type="number"
                      min={1}
                      max={3650}
                      value={generalConfig.cleanup_max_age_days}
                      onChange={(e) => {
                        const value = Math.max(1, Math.min(3650, parseInt(e.target.value) || 90));
                        const updated = { ...generalConfig, cleanup_max_age_days: value };
                        setGeneralConfig(updated);
                        invoke('update_general_config', { config: updated });
                      }}
                      className="setting-input compact"
                    />
                  </div>
                  <small className="setting-hint">{t('settings.general.cleanupMaxAgeDaysHint')}</small>
                </>
              )}
            </div>

            <div className="setting-options-group">
              <label className="setting-toggle-row">
                <span>{t('export.includeImages')}</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={exportIncludeImages}
                    onChange={(e) => setExportIncludeImages(e.target.checked)}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              <label className="setting-toggle-row">
                <span>{t('export.encrypt')}</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={exportEncrypt}
                    onChange={(e) => { setExportEncrypt(e.target.checked); setExportPassword(''); setExportConfirmPassword(''); }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              {exportEncrypt && (
                <div className="setting-password-group">
                  <input
                    type="password"
                    value={exportPassword}
                    onChange={(e) => setExportPassword(e.target.value)}
                    placeholder={t('export.password')}
                    className="setting-input"
                  />
                  <input
                    type="password"
                    value={exportConfirmPassword}
                    onChange={(e) => setExportConfirmPassword(e.target.value)}
                    placeholder={t('export.confirmPassword')}
                    className="setting-input"
                  />
                </div>
              )}
            </div>

            <div className="setting-btn-row">
              <button
                className="test-btn"
                onClick={handleExport}
                disabled={exporting || importing}
              >
                {exporting ? t('export.exporting') : t('export.export')}
              </button>
              <button
                className="test-btn secondary"
                onClick={() => { setImportNeedPassword(false); setImportPassword(''); setImportFilePath(null); setImportResult(null); handleImport(null, null); }}
                disabled={exporting || importing}
              >
                {importing ? t('export.importing') : t('export.import')}
              </button>
            </div>

            {importNeedPassword && (
              <div className="setting-inline-row">
                <input
                  type="password"
                  value={importPassword}
                  onChange={(e) => setImportPassword(e.target.value)}
                  placeholder={t('export.password')}
                  className="setting-input"
                  onKeyDown={(e) => { if (e.key === 'Enter' && importPassword) handleImport(importPassword, importFilePath); }}
                />
                <button
                  className="test-btn"
                  onClick={() => handleImport(importPassword, importFilePath)}
                  disabled={!importPassword || importing}
                >
                  {t('export.import')}
                </button>
              </div>
            )}

            {(exportResult || importResult) && (
              <small className={`setting-status ${(exportResult || importResult)?.success ? 'success' : 'error'}`}>
                {(exportResult || importResult)?.message}
              </small>
            )}

            <div className="setting-group" style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
              <label className="setting-label">{t('export.clearData')}</label>
              <small className="setting-hint-block" style={{ color: '#ff6b6b' }}>
                {t('export.clearDataWarning')}
              </small>
              <div className="setting-btn-row">
                <button
                  className={`test-btn ${clearDataConfirm ? 'danger' : 'secondary'}`}
                  onClick={handleClearAllData}
                  disabled={clearing || exporting || importing}
                >
                  {clearing ? t('export.clearing') : clearDataConfirm ? t('export.confirmClear') : t('export.clearAllData')}
                </button>
                {clearDataConfirm && (
                  <button
                    className="test-btn"
                    onClick={() => { setClearDataConfirm(false); setClearDataResult(null); }}
                    disabled={clearing}
                  >
                    {t('common.cancel')}
                  </button>
                )}
              </div>
              {clearDataResult && (
                <small className={`setting-status ${clearDataResult.success ? 'success' : 'error'}`}>
                  {clearDataResult.message}
                </small>
              )}
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="settings-content">
            <small className="setting-hint-block">
              {lockHasPassword ? t('lock.statusEnabled') : t('lock.statusDisabled')}
            </small>

            {lockHasPassword && (
              <div className="setting-password-group with-margin">
                <input
                  type="password"
                  value={lockOldPassword}
                  onChange={(e) => { setLockOldPassword(e.target.value); setLockError(''); setLockSuccess(''); }}
                  placeholder={t('lock.oldPassword')}
                  className="setting-input"
                />
              </div>
            )}

            <div className="setting-password-group">
              <input
                type="password"
                value={lockNewPassword}
                onChange={(e) => { setLockNewPassword(e.target.value); setLockError(''); setLockSuccess(''); }}
                placeholder={lockHasPassword ? t('lock.newPassword') : t('lock.setPassword')}
                className="setting-input"
              />
              {lockNewPassword && (
                <input
                  type="password"
                  value={lockConfirmPassword}
                  onChange={(e) => { setLockConfirmPassword(e.target.value); setLockError(''); setLockSuccess(''); }}
                  placeholder={t('lock.confirmPassword')}
                  className="setting-input"
                />
              )}
            </div>

            {lockError && <small className="setting-status error">{lockError}</small>}
            {lockSuccess && <small className="setting-status success">{lockSuccess}</small>}

            <div className="setting-btn-row">
              <button
                className="test-btn"
                onClick={async () => {
                  setLockError('');
                  setLockSuccess('');
                  if (lockNewPassword) {
                    if (lockNewPassword !== lockConfirmPassword) {
                      setLockError(t('lock.mismatch'));
                      return;
                    }
                    try {
                      await invoke('set_lock_password', { oldPassword: lockOldPassword, newPassword: lockNewPassword });
                      setLockSuccess(t('lock.setSuccess'));
                      setLockHasPassword(true);
                      setLockOldPassword('');
                      setLockNewPassword('');
                      setLockConfirmPassword('');
                    } catch (err) {
                      setLockError(String(err));
                    }
                  }
                }}
                disabled={!lockNewPassword || !lockConfirmPassword}
              >
                {lockHasPassword ? t('lock.changePassword') : t('lock.enableLock')}
              </button>
              {lockHasPassword && (
                <button
                  className="test-btn danger"
                  onClick={async () => {
                    setLockError('');
                    setLockSuccess('');
                    if (!lockOldPassword) {
                      setLockError(t('lock.needOldPassword'));
                      return;
                    }
                    try {
                      await invoke('set_lock_password', { oldPassword: lockOldPassword, newPassword: '' });
                      setLockSuccess(t('lock.removeSuccess'));
                      setLockHasPassword(false);
                      setLockOldPassword('');
                      setLockNewPassword('');
                      setLockConfirmPassword('');
                    } catch (err) {
                      setLockError(String(err));
                    }
                  }}
                >
                  {t('lock.removeLock')}
                </button>
              )}
            </div>
          </div>
        )}

        {activeTab === 'share' && (
          <div className="settings-content">
            <label className="setting-label">{t('settings.share.provider')}</label>
            <select
              className="setting-select"
              value={shareConfig.provider}
              onChange={(e) => {
                const key = e.target.value;
                const updated = { ...shareConfig, provider: key };
                if (key === 'S3' && !shareConfig.s3_config) {
                  updated.s3_config = {
                    endpoint: '', region: '', bucket: '',
                    access_key: '', secret_key: '', custom_domain: null,
                  };
                }
                setShareConfig(updated);
                invoke('update_share_config', { config: updated }).catch(console.error);
              }}
            >
              {[
                { key: 'ZeroX0', label: 'fileio' },
                { key: 'Tmpfiles', label: 'tmpfiles' },
                { key: 'Catbox', label: 'catbox' },
                { key: 'Litterbox', label: 'litterbox' },
                { key: 'S3', label: 's3' },
              ].map(({ key, label }) => (
                <option key={key} value={key}>{t(`settings.share.${label}`)}</option>
              ))}
            </select>
            <small className="setting-hint-block">
              {t(`settings.share.${
                { ZeroX0: 'fileioDesc', Tmpfiles: 'tmpfilesDesc', Catbox: 'catboxDesc', Litterbox: 'litterboxDesc', S3: 's3Desc' }[shareConfig.provider]
              }`)}
            </small>

            {shareConfig.provider === 'S3' && (
              <div className="setting-group" style={{ marginTop: '1rem' }}>
                <div className="setting-password-group">
                  <input
                    type="text"
                    value={shareConfig.s3_config?.endpoint || ''}
                    onChange={(e) => setShareConfig({
                      ...shareConfig,
                      s3_config: { ...shareConfig.s3_config, endpoint: e.target.value },
                    })}
                    placeholder={t('settings.share.endpoint')}
                    className="setting-input"
                  />
                  <input
                    type="text"
                    value={shareConfig.s3_config?.region || ''}
                    onChange={(e) => setShareConfig({
                      ...shareConfig,
                      s3_config: { ...shareConfig.s3_config, region: e.target.value },
                    })}
                    placeholder={t('settings.share.region')}
                    className="setting-input"
                  />
                  <input
                    type="text"
                    value={shareConfig.s3_config?.bucket || ''}
                    onChange={(e) => setShareConfig({
                      ...shareConfig,
                      s3_config: { ...shareConfig.s3_config, bucket: e.target.value },
                    })}
                    placeholder={t('settings.share.bucket')}
                    className="setting-input"
                  />
                  <input
                    type="text"
                    value={shareConfig.s3_config?.access_key || ''}
                    onChange={(e) => setShareConfig({
                      ...shareConfig,
                      s3_config: { ...shareConfig.s3_config, access_key: e.target.value },
                    })}
                    placeholder={t('settings.share.accessKey')}
                    className="setting-input"
                  />
                  <input
                    type="password"
                    value={shareConfig.s3_config?.secret_key || ''}
                    onChange={(e) => setShareConfig({
                      ...shareConfig,
                      s3_config: { ...shareConfig.s3_config, secret_key: e.target.value },
                    })}
                    placeholder={t('settings.share.secretKey')}
                    className="setting-input"
                  />
                  <input
                    type="text"
                    value={shareConfig.s3_config?.custom_domain || ''}
                    onChange={(e) => setShareConfig({
                      ...shareConfig,
                      s3_config: { ...shareConfig.s3_config, custom_domain: e.target.value || null },
                    })}
                    placeholder={t('settings.share.customDomain')}
                    className="setting-input"
                  />
                </div>
                <div className="setting-btn-row">
                  <button
                    className="test-btn"
                    onClick={async () => {
                      setShareTesting(true);
                      setShareTestResult(null);
                      try {
                        await invoke('test_share_s3_connection', { config: shareConfig.s3_config });
                        setShareTestResult({ success: true, message: t('settings.share.testSuccess') });
                      } catch (err) {
                        setShareTestResult({ success: false, message: `${t('settings.share.testFailed')}: ${err}` });
                      } finally {
                        setShareTesting(false);
                      }
                    }}
                    disabled={shareTesting}
                  >
                    {shareTesting ? t('settings.testing') : t('settings.share.testConnection')}
                  </button>
                </div>
                {shareTestResult && (
                  <small className={`setting-status ${shareTestResult.success ? 'success' : 'error'}`}>
                    {shareTestResult.message}
                  </small>
                )}
                <small className="setting-hint-block">{t('settings.share.networkHint')}</small>
              </div>
            )}
          </div>
        )}

        <div className="settings-footer">
          <button onClick={handleClose} className="cancel-btn">{t('settings.close')}</button>
          {(activeTab === 'ai' || activeTab === 'ocr' || activeTab === 'mcp' || activeTab === 'share') && (
            <button
              onClick={
                activeTab === 'ai' ? handleAiSave :
                activeTab === 'ocr' ? handleOcrSave :
                activeTab === 'mcp' ? handleMcpSave :
                activeTab === 'share' ? async () => {
                  try {
                    await invoke('update_share_config', { config: shareConfig });
                    handleClose();
                  } catch (err) {
                    console.error('save share config failed:', err);
                  }
                } :
                handleClose
              }
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
