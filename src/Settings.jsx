import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import './Settings.css';

const AI_PROVIDERS = [
  { value: 'SiliconFlow', label: '硅基流动' },
  { value: 'Volcano', label: '火山引擎' },
  { value: 'Alibaba', label: '阿里云' },
  { value: 'Custom', label: '自定义' },
];

function Settings({ onClose }) {
  const [config, setConfig] = useState({
    provider: { SiliconFlow: null },
    api_key: '',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    enabled: false,
  });
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      const result = await invoke('get_ai_config');
      setConfig(result);
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  };

  const handleSave = async () => {
    try {
      await invoke('update_ai_config', { config });
      alert('配置已保存');
      onClose();
    } catch (error) {
      console.error('保存配置失败:', error);
      alert('保存失败: ' + error);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await invoke('test_ai_connection', { config });
      setTestResult({ success: true, message: '连接成功！' });
    } catch (error) {
      setTestResult({ success: false, message: '连接失败: ' + error });
    } finally {
      setTesting(false);
    }
  };

  const getProviderValue = () => {
    if (config.provider.SiliconFlow !== undefined) return 'SiliconFlow';
    if (config.provider.Volcano !== undefined) return 'Volcano';
    if (config.provider.Alibaba !== undefined) return 'Alibaba';
    if (config.provider.Custom) return 'Custom';
    return 'SiliconFlow';
  };

  const handleProviderChange = (value) => {
    if (value === 'Custom') {
      setConfig({
        ...config,
        provider: { Custom: { name: customName || '自定义', base_url: customUrl || '' } },
      });
    } else {
      setConfig({
        ...config,
        provider: { [value]: null },
      });
    }
  };

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>AI 设置</h2>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>

        <div className="settings-content">
          <div className="setting-item">
            <label className="setting-label">
              <input
                type="checkbox"
                checked={config.enabled}
                onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
              />
              启用 AI 自动标签
            </label>
          </div>

          <div className="setting-item">
            <label>AI 提供商</label>
            <select
              value={getProviderValue()}
              onChange={(e) => handleProviderChange(e.target.value)}
              className="setting-select"
            >
              {AI_PROVIDERS.map((provider) => (
                <option key={provider.value} value={provider.value}>
                  {provider.label}
                </option>
              ))}
            </select>
          </div>

          {getProviderValue() === 'Custom' && (
            <>
              <div className="setting-item">
                <label>服务名称</label>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => {
                    setCustomName(e.target.value);
                    if (config.provider.Custom) {
                      setConfig({
                        ...config,
                        provider: {
                          Custom: { ...config.provider.Custom, name: e.target.value },
                        },
                      });
                    }
                  }}
                  placeholder="例如: OpenAI"
                  className="setting-input"
                />
              </div>
              <div className="setting-item">
                <label>API 地址</label>
                <input
                  type="text"
                  value={customUrl}
                  onChange={(e) => {
                    setCustomUrl(e.target.value);
                    if (config.provider.Custom) {
                      setConfig({
                        ...config,
                        provider: {
                          Custom: { ...config.provider.Custom, base_url: e.target.value },
                        },
                      });
                    }
                  }}
                  placeholder="https://api.example.com/v1"
                  className="setting-input"
                />
              </div>
            </>
          )}

          <div className="setting-item">
            <label>API Key</label>
            <input
              type="password"
              value={config.api_key}
              onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
              placeholder="输入 API Key"
              className="setting-input"
            />
          </div>

          <div className="setting-item">
            <label>模型</label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => setConfig({ ...config, model: e.target.value })}
              placeholder="例如: Qwen/Qwen2.5-7B-Instruct"
              className="setting-input"
            />
          </div>

          <div className="setting-actions">
            <button onClick={handleTest} disabled={testing} className="test-btn">
              {testing ? '测试中...' : '测试连接'}
            </button>
            {testResult && (
              <span className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                {testResult.message}
              </span>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button onClick={handleSave} className="save-btn">保存</button>
        </div>
      </div>
    </div>
  );
}

export default Settings;
