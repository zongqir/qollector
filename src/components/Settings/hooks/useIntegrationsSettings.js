import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

const normalizeOcrProvider = (provider) => (provider === 'Local' ? 'Native' : provider);

function useIntegrationsSettings({ t, onConfigChange }) {
  const [aiConfig, setAiConfig] = useState({
    current_provider: { SiliconFlow: null },
    credentials: {},
    enabled: false,
  });
  const [ocrConfig, setOcrConfig] = useState({
    enabled: true,
    current_provider: 'Native',
    credentials: {},
    language: 'chi_sim+eng',
    auto_ocr: true,
  });
  const [mcpConfig, setMcpConfig] = useState({
    enabled: false,
    port: 38470,
    mode: 'http',
  });
  const [collectorConfig, setCollectorConfig] = useState({
    enabled: false,
    endpoint: '',
    token: '',
  });
  const [collectorTesting, setCollectorTesting] = useState(false);
  const [collectorTestResult, setCollectorTestResult] = useState(null);
  const [collectorStatus, setCollectorStatus] = useState({
    today_uploaded: 0,
    pending: 0,
    last_sync_at: null,
  });
  const [collectorSyncing, setCollectorSyncing] = useState(false);
  const [collectorSyncResult, setCollectorSyncResult] = useState(null);
  const [showCollectorToken, setShowCollectorToken] = useState(false);
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
  const [currentOcrApiKey, setCurrentOcrApiKey] = useState('');
  const [currentOcrApiSecret, setCurrentOcrApiSecret] = useState('');
  const [showOcrApiKey, setShowOcrApiKey] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [refreshModelsResult, setRefreshModelsResult] = useState(null);
  const [modelInputMode, setModelInputMode] = useState('select');
  const [shareConfig, setShareConfig] = useState({
    provider: 'Litterbox',
    s3_config: null,
    force_upload_non_ascii_text: false,
  });
  const [shareTestResult, setShareTestResult] = useState(null);
  const [shareTesting, setShareTesting] = useState(false);
  const [collapsedSections, setCollapsedSections] = useState({
    ai: true, ocr: true, mcp: true, collector: true, lanSync: true, share: true,
  });

  const toggleSection = (key) => {
    setCollapsedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const getProviderKey = (provider) => {
    if (typeof provider === 'string') {
      if (provider === 'SiliconFlow') return 'siliconflow';
      if (provider === 'Volcano') return 'volcano';
      if (provider === 'Alibaba') return 'alibaba';
      if (provider === 'OpenAI') return 'openai';
      if (provider === 'Gemini') return 'gemini';
      return provider.toLowerCase();
    }
    if (provider?.SiliconFlow !== undefined) return 'siliconflow';
    if (provider?.Volcano !== undefined) return 'volcano';
    if (provider?.Alibaba !== undefined) return 'alibaba';
    if (provider?.OpenAI !== undefined) return 'openai';
    if (provider?.Gemini !== undefined) return 'gemini';
    if (provider?.Custom) return `custom_${provider.Custom.name}`;
    return 'siliconflow';
  };

  const getAiProviderValue = () => {
    if (!aiConfig.current_provider) return 'SiliconFlow';
    if (typeof aiConfig.current_provider === 'string') {
      return aiConfig.current_provider;
    }
    if (aiConfig.current_provider.SiliconFlow !== undefined) return 'SiliconFlow';
    if (aiConfig.current_provider.Volcano !== undefined) return 'Volcano';
    if (aiConfig.current_provider.Alibaba !== undefined) return 'Alibaba';
    if (aiConfig.current_provider.OpenAI !== undefined) return 'OpenAI';
    if (aiConfig.current_provider.Gemini !== undefined) return 'Gemini';
    if (aiConfig.current_provider.Custom) return 'Custom';
    return 'SiliconFlow';
  };

  useEffect(() => {
    if (!aiConfig.current_provider) return;

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
  }, [aiConfig.current_provider]);

  useEffect(() => {
    if (!ocrConfig.current_provider) return;
    const providerKey = normalizeOcrProvider(ocrConfig.current_provider).toLowerCase();
    const creds = ocrConfig.credentials[providerKey];
    setCurrentOcrApiKey(creds?.api_key || '');
    setCurrentOcrApiSecret(creds?.api_secret || '');
  }, [ocrConfig.current_provider, ocrConfig.credentials]);

  const loadIntegrationConfigs = async () => {
    const [ai, ocr, mcp, collector, collectorStatus, mcpPort, share] = await Promise.all([
      invoke('get_ai_config'),
      invoke('get_ocr_config'),
      invoke('get_mcp_config'),
      invoke('get_collector_config').catch(() => ({ enabled: false, endpoint: '', token: '' })),
      invoke('get_collector_upload_status').catch(() => ({
        today_uploaded: 0,
        pending: 0,
        last_sync_at: null,
      })),
      invoke('get_mcp_port').catch(() => 38470),
      invoke('get_share_config').catch(() => ({
        provider: 'Litterbox',
      })),
    ]);

    setAiConfig(ai);
    if (ai.current_provider?.Custom) {
      setCustomName(ai.current_provider.Custom.name || '');
      setCustomUrl(ai.current_provider.Custom.base_url || '');
    } else if (typeof ai.current_provider === 'object' && ai.current_provider.Custom) {
      setCustomName(ai.current_provider.Custom.name || '');
      setCustomUrl(ai.current_provider.Custom.base_url || '');
    }

    setOcrConfig({
      ...ocr,
      current_provider: normalizeOcrProvider(ocr.current_provider),
    });
    setMcpConfig(mcp);
    setCollectorConfig(collector);
    setCollectorStatus(collectorStatus);
    setActualMcpPort(mcpPort);

    const normalizedShareConfig = {
      provider: (share.provider === 'FileIo' || share.provider === 'ZeroX0') ? 'Litterbox' : share.provider,
      s3_config: share.s3_config || null,
      force_upload_non_ascii_text: Boolean(share.force_upload_non_ascii_text),
    };
    setShareConfig(normalizedShareConfig);
  };

  const handleCollectorEnabledChange = async (enabled) => {
    const updated = { ...collectorConfig, enabled };
    setCollectorConfig(updated);
    try {
      await invoke('update_collector_config', { config: updated });
      const status = await invoke('get_collector_upload_status');
      setCollectorStatus(status);
    } catch (error) {
      console.error('save collector config failed:', error);
    }
  };

  const handleCollectorTest = async () => {
    setCollectorTesting(true);
    setCollectorTestResult(null);
    try {
      await invoke('test_collector_connection', { config: collectorConfig });
      setCollectorTestResult({ success: true, message: t('settings.collector.testSuccess') });
    } catch (error) {
      setCollectorTestResult({ success: false, message: t('settings.collector.testFailed', { error }) });
    } finally {
      setCollectorTesting(false);
    }
  };

  const handleCollectorSync = async () => {
    setCollectorSyncing(true);
    setCollectorSyncResult(null);
    try {
      await invoke('update_collector_config', { config: collectorConfig });
      const result = await invoke('sync_collector_items');
      setCollectorStatus({
        today_uploaded: result.today_uploaded,
        pending: result.pending,
        last_sync_at: result.last_sync_at,
      });
      setCollectorConfig((current) => ({
        ...current,
        last_sync_at: result.last_sync_at,
      }));
      const failureReason = (result.failure_reasons || [])
        .slice(0, 3)
        .map(({ message, count }) => t('settings.collector.syncFailureReason', { message, count }))
        .join('；');
      setCollectorSyncResult({
        success: result.failed === 0,
        message: `${t('settings.collector.syncSuccess', {
          uploaded: result.uploaded,
          failed: result.failed,
          pending: result.pending,
        })}${failureReason ? ` ${failureReason}` : ''}`,
      });
    } catch (error) {
      setCollectorSyncResult({
        success: false,
        message: t('settings.collector.syncFailed', { error }),
      });
    } finally {
      setCollectorSyncing(false);
    }
  };

  const handleAiEnabledChange = async (enabled) => {
    const updated = { ...aiConfig, enabled };
    setAiConfig(updated);
    try {
      await invoke('update_ai_config', { config: updated });
      if (onConfigChange) onConfigChange();
    } catch (error) {
      console.error('save ai config failed:', error);
    }
  };

  const handleOcrEnabledChange = async (enabled) => {
    const updated = { ...ocrConfig, enabled };
    setOcrConfig(updated);
    try {
      await invoke('update_ocr_config', { config: updated });
    } catch (error) {
      console.error('save ocr config failed:', error);
    }
  };

  const handleMcpEnabledChange = async (enabled) => {
    const updated = { ...mcpConfig, enabled };
    setMcpConfig(updated);
    try {
      await invoke('update_mcp_config', { config: updated });
    } catch (error) {
      console.error('save mcp config failed:', error);
    }
  };

  const saveIntegrations = async () => {
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
        invoke('update_collector_config', { config: collectorConfig }),
        invoke('update_share_config', { config: shareConfig }),
      ]);

      setAiConfig(aiConfigToSave);
    setOcrConfig(ocrConfigToSave);
      setCollectorConfig(collectorConfig);
      return { success: true };
    } catch (error) {
      console.error('save integrations config failed:', error);
      return { success: false, error };
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
      if (ocrConfig.current_provider !== 'Native' && !currentOcrApiKey) {
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
      setModelInputMode('select');
    } catch (error) {
      console.error('Settings operation failed:', error);
      alert(t('error.updateFailed', { error: String(error) }));
    }
  };

  const getProviderBaseUrl = () => {
    const provider = getAiProviderValue();
    const urls = {
      SiliconFlow: 'https://api.siliconflow.cn/v1',
      Volcano: 'https://ark.cn-beijing.volces.com/api/v3',
      Alibaba: 'https://dashscope.aliyuncs.com/api/v1',
      OpenAI: 'https://api.openai.com/v1',
      Gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
    };
    if (provider === 'Custom') return customUrl || '';
    return urls[provider] || '';
  };

  const handleRefreshModels = async () => {
    const baseUrl = getProviderBaseUrl();
    if (!baseUrl || !currentAiApiKey) {
      setRefreshModelsResult({ success: false, message: t('settings.ai.refreshFailed') });
      setTimeout(() => setRefreshModelsResult(null), 3000);
      return;
    }
    setRefreshingModels(true);
    setRefreshModelsResult(null);
    try {
      const models = await invoke('fetch_remote_models', { baseUrl, apiKey: currentAiApiKey });
      if (models && models.length > 0) {
        setAvailableModels(models);
        setRefreshModelsResult({ success: true, message: t('settings.ai.refreshSuccess') });
      } else {
        setRefreshModelsResult({ success: false, message: t('settings.ai.refreshFailed') });
      }
    } catch (error) {
      console.error('Fetch remote models failed:', error);
      setRefreshModelsResult({ success: false, message: t('settings.ai.refreshFailed') });
    } finally {
      setRefreshingModels(false);
      setTimeout(() => setRefreshModelsResult(null), 3000);
    }
  };

  return {
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
    handleOcrEnabledChange,
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
  };
}

export default useIntegrationsSettings;
