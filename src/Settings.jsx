import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
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

function Settings({ onClose }) {
  const [activeTab, setActiveTab] = useState('ai');
  const [aiConfig, setAiConfig] = useState({
    provider: { SiliconFlow: null },
    api_key: '',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    enabled: false,
  });
  const [ocrConfig, setOcrConfig] = useState({
    enabled: true,
    provider: 'SiliconFlow',
    api_key: 'sk-huvjsuypfcuzqzolhjmccmjfcwzotwxqojwcvdwpxlyohqrp',
    api_secret: null,
    language: 'chi_sim+eng',
    auto_ocr: true,
  });
  const [customName, setCustomName] = useState('');
  const [customUrl, setCustomUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    try {
      const [ai, ocr] = await Promise.all([
        invoke('get_ai_config'),
        invoke('get_ocr_config')
      ]);
      setAiConfig(ai);
      setOcrConfig(ocr);
    } catch (error) {
      console.error('加载配置失败:', error);
    }
  };

  const handleAiSave = async () => {
    try {
      await invoke('update_ai_config', { config: aiConfig });
      alert('AI 配置已保存');
    } catch (error) {
      console.error('保存 AI 配置失败:', error);
      alert('保存失败: ' + error);
    }
  };

  const handleOcrSave = async () => {
    try {
      await invoke('update_ocr_config', { config: ocrConfig });
      alert('OCR 配置已保存');
    } catch (error) {
      console.error('保存 OCR 配置失败:', error);
      alert('保存失败: ' + error);
    }
  };

  const handleAiTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      await invoke('test_ai_connection', { config: aiConfig });
      setTestResult({ success: true, message: 'AI 连接成功！' });
    } catch (error) {
      setTestResult({ success: false, message: 'AI 连接失败: ' + error });
    } finally {
      setTesting(false);
    }
  };

  const handleOcrTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      // 先保存配置
      await invoke('update_ocr_config', { config: ocrConfig });

      // 然后测试可用性
      const available = await invoke('check_ocr_available');
      if (available) {
        setTestResult({ success: true, message: 'OCR 服务可用！' });
      } else {
        setTestResult({ success: false, message: 'OCR 服务不可用，请检查 API Key 是否正确' });
      }
    } catch (error) {
      setTestResult({ success: false, message: 'OCR 测试失败: ' + error });
    } finally {
      setTesting(false);
    }
  };

  const getAiProviderValue = () => {
    if (aiConfig.provider.SiliconFlow !== undefined) return 'SiliconFlow';
    if (aiConfig.provider.Volcano !== undefined) return 'Volcano';
    if (aiConfig.provider.Alibaba !== undefined) return 'Alibaba';
    if (aiConfig.provider.Custom) return 'Custom';
    return 'SiliconFlow';
  };

  const handleAiProviderChange = (value) => {
    if (value === 'Custom') {
      setAiConfig({
        ...aiConfig,
        provider: { Custom: { name: customName || '自定义', base_url: customUrl || '' } },
      });
    } else {
      setAiConfig({
        ...aiConfig,
        provider: { [value]: null },
      });
    }
  };

  return (
    <div className="settings-overlay">
      <div className="settings-modal">
        <div className="settings-header">
          <h2>设置</h2>
          <button onClick={onClose} className="close-btn">✕</button>
        </div>

        <div className="settings-tabs">
          <button
            className={`tab-btn ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            AI 标签
          </button>
          <button
            className={`tab-btn ${activeTab === 'ocr' ? 'active' : ''}`}
            onClick={() => setActiveTab('ocr')}
          >
            OCR 识别
          </button>
        </div>

        {activeTab === 'ai' && (
          <div className="settings-content">
            <div className="setting-item">
              <label className="setting-label">
                <input
                  type="checkbox"
                  checked={aiConfig.enabled}
                  onChange={(e) => setAiConfig({ ...aiConfig, enabled: e.target.checked })}
                />
                启用 AI 自动标签
              </label>
            </div>

            <div className="setting-item">
              <label>AI 提供商</label>
              <select
                value={getAiProviderValue()}
                onChange={(e) => handleAiProviderChange(e.target.value)}
                className="setting-select"
              >
                {AI_PROVIDERS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>

            {getAiProviderValue() === 'Custom' && (
              <>
                <div className="setting-item">
                  <label>服务名称</label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => {
                      setCustomName(e.target.value);
                      if (aiConfig.provider.Custom) {
                        setAiConfig({
                          ...aiConfig,
                          provider: {
                            Custom: { ...aiConfig.provider.Custom, name: e.target.value },
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
                      if (aiConfig.provider.Custom) {
                        setAiConfig({
                          ...aiConfig,
                          provider: {
                            Custom: { ...aiConfig.provider.Custom, base_url: e.target.value },
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
                value={aiConfig.api_key}
                onChange={(e) => setAiConfig({ ...aiConfig, api_key: e.target.value })}
                placeholder="输入 API Key"
                className="setting-input"
              />
            </div>

            <div className="setting-item">
              <label>模型</label>
              <input
                type="text"
                value={aiConfig.model}
                onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                placeholder="例如: Qwen/Qwen2.5-7B-Instruct"
                className="setting-input"
              />
            </div>

            <div className="setting-actions">
              <button onClick={handleAiTest} disabled={testing} className="test-btn">
                {testing ? '测试中...' : '测试连接'}
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
                  checked={ocrConfig.enabled}
                  onChange={(e) => setOcrConfig({ ...ocrConfig, enabled: e.target.checked })}
                />
                启用 OCR 识别
              </label>
            </div>

            <div className="setting-item">
              <label className="setting-label">
                <input
                  type="checkbox"
                  checked={ocrConfig.auto_ocr}
                  onChange={(e) => setOcrConfig({ ...ocrConfig, auto_ocr: e.target.checked })}
                />
                自动识别新图片
              </label>
            </div>

            <div className="setting-item">
              <label>OCR 提供商</label>
              <select
                value={ocrConfig.provider}
                onChange={(e) => setOcrConfig({ ...ocrConfig, provider: e.target.value })}
                className="setting-select"
              >
                {OCR_PROVIDERS.map((provider) => (
                  <option key={provider.value} value={provider.value}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </div>

            {ocrConfig.provider === 'Local' && (
              <div className="setting-item">
                <label>识别语言</label>
                <input
                  type="text"
                  value={ocrConfig.language}
                  onChange={(e) => setOcrConfig({ ...ocrConfig, language: e.target.value })}
                  placeholder="chi_sim+eng"
                  className="setting-input"
                />
                <small className="setting-hint">
                  常用: chi_sim (简体中文), chi_tra (繁体中文), eng (英文)
                </small>
              </div>
            )}

            {ocrConfig.provider !== 'Local' && (
              <div className="setting-item">
                <label>API Key</label>
                <input
                  type="password"
                  value={ocrConfig.api_key || ''}
                  onChange={(e) => setOcrConfig({ ...ocrConfig, api_key: e.target.value })}
                  placeholder="输入 API Key"
                  className="setting-input"
                />
              </div>
            )}

            {ocrConfig.provider === 'Local' && (
              <div className="setting-item">
                <div className="info-box">
                  <strong>本地 OCR 需要安装 Tesseract：</strong>
                  <ul>
                    <li>Windows: <code>choco install tesseract</code></li>
                    <li>macOS: <code>brew install tesseract</code></li>
                    <li>Linux: <code>sudo apt install tesseract-ocr tesseract-ocr-chi-sim</code></li>
                  </ul>
                </div>
              </div>
            )}

            <div className="setting-actions">
              <button onClick={handleOcrTest} disabled={testing} className="test-btn">
                {testing ? '测试中...' : '测试服务'}
              </button>
              {testResult && (
                <span className={`test-result ${testResult.success ? 'success' : 'error'}`}>
                  {testResult.message}
                </span>
              )}
            </div>
          </div>
        )}

        <div className="settings-footer">
          <button onClick={onClose} className="cancel-btn">取消</button>
          <button
            onClick={activeTab === 'ai' ? handleAiSave : handleOcrSave}
            className="save-btn"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

export default Settings;
