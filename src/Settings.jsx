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
  const [activeTab, setActiveTab] = useState('ai');

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

  // 当前 OCR 供应商的凭证（用于 UI 显示和编辑）
  const [currentOcrApiKey, setCurrentOcrApiKey] = useState('');
  const [currentOcrApiSecret, setCurrentOcrApiSecret] = useState('');
  const [showOcrApiKey, setShowOcrApiKey] = useState(false);

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
            className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            {t('settings.tabs.ai')}
          </button>
          <button
            className={`tab-btn ${activeTab === 'ocr' ? 'active' : ''}`}
            onClick={() => setActiveTab('ocr')}
          >
            {t('settings.tabs.ocr')}
          </button>
          <button
            className={`tab-btn ${activeTab === 'mcp' ? 'active' : ''}`}
            onClick={() => setActiveTab('mcp')}
          >
            {t('settings.tabs.mcp')}
          </button>
        </div>

        {activeTab === 'general' && (
          <div className="settings-content">
            <div className="setting-item">
              <label>{t('settings.general.language')}</label>
              <select
                value={i18n.language}
                onChange={(e) => changeLanguage(e.target.value)}
                className="setting-select"
              >
                <option value="zh-CN">简体中文</option>
                <option value="en-US">English</option>
              </select>
              <small className="setting-hint">{t('settings.general.languageHint')}</small>
            </div>

            <div className="setting-item">
              <label>{t('settings.general.theme')}</label>
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
              <small className="setting-hint">{t('settings.general.themeHint')}</small>
            </div>

            <div className="setting-item">
              <label>{t('settings.general.maxPinnedItems')}</label>
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
                className="setting-input"
              />
              <small className="setting-hint">
                {t('settings.general.maxPinnedItemsHint')}
                {generalConfig.max_pinned_items > 5 && (
                  <span style={{ color: '#ff9800', display: 'block', marginTop: '4px' }}>
                    {t('settings.general.maxPinnedItemsWarning')}
                  </span>
                )}
              </small>
            </div>

            <div className="setting-item">
              <label>{t('settings.general.featureModules')}</label>
              <div className="feature-toggles">
                <label className="setting-label">
                  <input
                    type="checkbox"
                    checked={aiConfig.enabled}
                    onChange={async (e) => {
                      const updated = { ...aiConfig, enabled: e.target.checked };
                      setAiConfig(updated);
                      try {
                        await invoke('update_ai_config', { config: updated });
                      } catch (error) {
                        console.error('保存 AI 配置失败:', error);
                      }
                    }}
                  />
                  {t('settings.general.enableAI')}
                </label>
                <label className="setting-label">
                  <input
                    type="checkbox"
                    checked={ocrConfig.enabled}
                    onChange={async (e) => {
                      const updated = { ...ocrConfig, enabled: e.target.checked };
                      setOcrConfig(updated);
                      try {
                        await invoke('update_ocr_config', { config: updated });
                      } catch (error) {
                        console.error('保存 OCR 配置失败:', error);
                      }
                    }}
                  />
                  {t('settings.general.enableOCR')}
                </label>
                <label className="setting-label">
                  <input
                    type="checkbox"
                    checked={mcpConfig.enabled}
                    onChange={async (e) => {
                      const updated = { ...mcpConfig, enabled: e.target.checked };
                      setMcpConfig(updated);
                      try {
                        await invoke('update_mcp_config', { config: updated });
                      } catch (error) {
                        console.error('保存 MCP 配置失败:', error);
                      }
                    }}
                  />
                  {t('settings.general.enableMCP')}
                </label>
              </div>
            </div>
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
                      // 更新 aiConfig 中的 Custom 对象
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
                      // 更新 aiConfig 中的 Custom 对象
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
              <div style={{ position: 'relative' }}>
                <input
                  type={showAiApiKey ? "text" : "password"}
                  value={currentAiApiKey}
                  onChange={(e) => setCurrentAiApiKey(e.target.value)}
                  placeholder={t('settings.ai.apiKeyPlaceholder')}
                  className="setting-input"
                  style={{ paddingRight: '40px' }}
                />
                {currentAiApiKey && (
                  <button
                    type="button"
                    onClick={() => setShowAiApiKey(!showAiApiKey)}
                    style={{
                      position: 'absolute',
                      right: '8px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                      alignItems: 'center',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {showAiApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
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
                <>
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
                  <small className="setting-hint">{t('settings.ai.modelHint')}</small>
                </>
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
            <div className="setting-item">
              <label className="setting-label">
                <input
                  type="checkbox"
                  checked={ocrConfig.auto_ocr}
                  onChange={(e) => setOcrConfig({ ...ocrConfig, auto_ocr: e.target.checked })}
                />
                {t('settings.ocr.autoOcr')}
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
                <div style={{ position: 'relative' }}>
                  <input
                    type={showOcrApiKey ? "text" : "password"}
                    value={currentOcrApiKey}
                    onChange={(e) => setCurrentOcrApiKey(e.target.value)}
                    placeholder={t('settings.ocr.apiKeyPlaceholder')}
                    className="setting-input"
                    style={{ paddingRight: '40px' }}
                  />
                  {currentOcrApiKey && (
                    <button
                      type="button"
                      onClick={() => setShowOcrApiKey(!showOcrApiKey)}
                      style={{
                        position: 'absolute',
                        right: '8px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        padding: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        color: 'var(--text-secondary)',
                      }}
                    >
                      {showOcrApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
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
                  <span style={{ color: '#ff9800', marginLeft: '8px' }}>
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
                    alert(t('settings.mcp.configCopied'));
                  }}
                  className="test-btn"
                  style={{ marginTop: '8px' }}
                >
                  {t('settings.mcp.copyConfig')}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="settings-footer">
          <button onClick={handleClose} className="cancel-btn">{t('settings.close')}</button>
          {activeTab !== 'general' && (
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
