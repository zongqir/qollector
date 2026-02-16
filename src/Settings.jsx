import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import { X, Eye, EyeOff } from 'lucide-react';
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

  useEffect(() => {
    loadConfigs();
  }, []);

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
      const [ai, ocr, mcp, mcpPort, general] = await Promise.all([
        invoke('get_ai_config'),
        invoke('get_ocr_config'),
        invoke('get_mcp_config'),
        invoke('get_mcp_port').catch(() => 38470),
        invoke('get_general_config')
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
                <span>{t('settings.general.enableAI')}</span>
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
                <span>{t('settings.general.enableOCR')}</span>
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
                <span>{t('settings.general.enableMCP')}</span>
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
                <span>{t('settings.shortcuts.ctrlShiftC')}</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(generalConfig.ctrl_shift_c_shortcut_enabled)}
                    onChange={async (e) => {
                      const updated = {
                        ...generalConfig,
                        ctrl_shift_c_shortcut_enabled: e.target.checked,
                      };
                      setGeneralConfig(updated);
                      try {
                        await invoke('update_general_config', { config: updated });
                      } catch (error) {
                        console.error('Failed to save Ctrl+Shift+C shortcut setting:', error);
                      }
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
            </div>
            <small className="setting-hint">{t('settings.shortcuts.ctrlShiftCHint')}</small>

            <div className="setting-group-title">{t('settings.shortcuts.emphasisCopy')}</div>
            <div className="setting-group">
              <label className="sg-row setting-toggle-row">
                <span>{t('settings.general.doubleCopyEmphasis')}</span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={Boolean(generalConfig.double_copy_emphasis_enabled)}
                    onChange={async (e) => {
                      const updated = {
                        ...generalConfig,
                        double_copy_emphasis_enabled: e.target.checked,
                      };
                      setGeneralConfig(updated);
                      try {
                        await invoke('update_general_config', { config: updated });
                      } catch (error) {
                        console.error('Failed to save double copy emphasis config:', error);
                      }
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              <div className="sg-row">
                <span>{t('settings.general.doubleCopyWindowMs')}</span>
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
                    setGeneralConfig(updated);
                    try {
                      await invoke('update_general_config', { config: updated });
                    } catch (error) {
                      console.error('Failed to save double copy window config:', error);
                    }
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

        <div className="settings-footer">
          <button onClick={handleClose} className="cancel-btn">{t('settings.close')}</button>
          {(activeTab === 'ai' || activeTab === 'ocr' || activeTab === 'mcp') && (
            <button
              onClick={
                activeTab === 'ai' ? handleAiSave :
                activeTab === 'ocr' ? handleOcrSave :
                activeTab === 'mcp' ? handleMcpSave :
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
