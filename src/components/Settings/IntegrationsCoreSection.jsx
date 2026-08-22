import { Eye, EyeOff, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';

const AI_PROVIDERS = ['SiliconFlow', 'Volcano', 'Alibaba', 'OpenAI', 'Gemini', 'Custom'];

const OCR_PROVIDERS = ['Native', 'SiliconFlow', 'DeepSeek', 'Aliyun', 'Tencent', 'Baidu'];

function IntegrationsCoreSection({
  t,
  aiConfig,
  ocrConfig,
  mcpConfig,
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
  collapsedSections,
  toggleSection,
  onToggleAiEnabled,
  onToggleOcrEnabled,
  onToggleMcpEnabled,
  onToggleCollectorEnabled,
  handleCollectorTest,
  handleCollectorSync,
  getAiProviderValue,
  handleAiProviderChange,
  customName,
  setCustomName,
  customUrl,
  setCustomUrl,
  setAiConfig,
  currentAiApiKey,
  setCurrentAiApiKey,
  currentAiModel,
  setCurrentAiModel,
  showAiApiKey,
  setShowAiApiKey,
  availableModels,
  modelInputMode,
  setModelInputMode,
  handleRefreshModels,
  refreshingModels,
  refreshModelsResult,
  handleAiTest,
  aiTesting,
  aiTestResult,
  currentOcrApiKey,
  setCurrentOcrApiKey,
  currentOcrApiSecret,
  setCurrentOcrApiSecret,
  showOcrApiKey,
  setShowOcrApiKey,
  setOcrConfig,
  handleOcrTest,
  ocrTesting,
  ocrTestResult,
  setMcpConfig,
  getWheelNextNumber,
  copySuccess,
  setCopySuccess,
}) {
  return (
    <>
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
                onChange={(e) => onToggleAiEnabled(e.target.checked)}
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
                onChange={(e) => onToggleOcrEnabled(e.target.checked)}
              />
              <span className="toggle-slider" />
            </span>
          </label>
          <label className="sg-row setting-toggle-row">
            <span className="toggle-label-group">
              <span className="toggle-title-inline">
                <span className="toggle-label">{t('settings.general.enableMCP')}</span>
                <span className="beta-badge">{t('settings.general.betaBadge')}</span>
              </span>
              <span className="toggle-desc">{t('settings.general.enableMCPHint')}</span>
            </span>
            <span className="toggle-switch">
              <input
                type="checkbox"
                checked={mcpConfig.enabled}
                onChange={(e) => onToggleMcpEnabled(e.target.checked)}
              />
              <span className="toggle-slider" />
            </span>
          </label>
        </div>
        <label className="sg-row setting-toggle-row">
          <span className="toggle-label-group">
            <span className="toggle-label">{t('settings.collector.title')}</span>
            <span className="toggle-desc">{t('settings.collector.privacyHint')}</span>
          </span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={collectorConfig.enabled}
              onChange={(e) => onToggleCollectorEnabled(e.target.checked)}
            />
            <span className="toggle-slider" />
          </span>
        </label>
        {collectorConfig.enabled && (
          <div className="settings-content">
            <div className="setting-group-title section-title collapsible-title" onClick={() => toggleSection('collector')}>
              {collapsedSections.collector ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              {t('settings.collector.title')}
            </div>
            {!collapsedSections.collector && (
              <>
                <div className="setting-item">
                  <label>{t('settings.collector.endpoint')}</label>
                  <input
                    type="url"
                    value={collectorConfig.endpoint}
                    onChange={(e) => setCollectorConfig({ ...collectorConfig, endpoint: e.target.value })}
                    placeholder={t('settings.collector.endpointPlaceholder')}
                    className="setting-input"
                  />
                </div>
                <div className="setting-item">
                  <label>{t('settings.collector.token')}</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showCollectorToken ? 'text' : 'password'}
                      value={collectorConfig.token}
                      onChange={(e) => setCollectorConfig({ ...collectorConfig, token: e.target.value })}
                      placeholder={t('settings.collector.tokenPlaceholder')}
                      className="setting-input"
                    />
                    <button type="button" onClick={() => setShowCollectorToken(!showCollectorToken)} className="password-toggle-btn">
                      {showCollectorToken ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="setting-item"><div className="info-box">{t('settings.collector.privacyWarning')}</div></div>
                <div className="collector-upload-status" aria-live="polite">
                  <span>{t('settings.collector.todayUploaded')}: <strong>{collectorStatus.today_uploaded}</strong></span>
                  <span>{t('settings.collector.pending')}: <strong>{collectorStatus.pending}</strong></span>
                </div>
                <div className="setting-actions collector-actions">
                  <button onClick={handleCollectorTest} disabled={collectorTesting} className="test-btn">
                    {collectorTesting ? t('settings.testing') : t('settings.collector.test')}
                  </button>
                  <button onClick={handleCollectorSync} disabled={collectorSyncing} className="test-btn">
                    {collectorSyncing ? t('settings.collector.syncing') : t('settings.collector.syncNow')}
                  </button>
                  {collectorTestResult && <span className={`test-result ${collectorTestResult.success ? 'success' : 'error'}`}>{collectorTestResult.message}</span>}
                  {collectorSyncResult && <span className={`test-result ${collectorSyncResult.success ? 'success' : 'error'}`}>{collectorSyncResult.message}</span>}
                </div>
              </>
            )}
          </div>
        )}
        {aiConfig.enabled && (
          <>
            <div className="setting-group-title section-title collapsible-title" onClick={() => toggleSection('ai')}>
              {collapsedSections.ai ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              {t('settings.tabs.ai')}
            </div>
            {!collapsedSections.ai && (
              <>
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
                      type={showAiApiKey ? 'text' : 'password'}
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
                    <>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {modelInputMode === 'select' ? (
                          <select
                            value={availableModels.includes(currentAiModel) ? currentAiModel : ''}
                            onChange={(e) => setCurrentAiModel(e.target.value)}
                            className="setting-select"
                            style={{ flex: 1 }}
                          >
                            {!availableModels.includes(currentAiModel) && currentAiModel && (
                              <option value="" disabled>{currentAiModel}</option>
                            )}
                            {availableModels.map((model) => (
                              <option key={model} value={model}>{model}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={currentAiModel}
                            onChange={(e) => setCurrentAiModel(e.target.value)}
                            placeholder={t('settings.ai.modelPlaceholder')}
                            className="setting-input"
                            style={{ flex: 1 }}
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => setModelInputMode(modelInputMode === 'select' ? 'input' : 'select')}
                          className="test-btn"
                          title={modelInputMode === 'select' ? t('settings.ai.manualInput') : t('settings.ai.selectFromList')}
                          style={{ padding: '6px 8px', minWidth: 'auto', flexShrink: 0, fontSize: '12px' }}
                        >
                          {modelInputMode === 'select' ? '✏️' : '📋'}
                        </button>
                        <button
                          type="button"
                          onClick={handleRefreshModels}
                          disabled={refreshingModels}
                          className="test-btn"
                          title={t('settings.ai.refreshModels')}
                          style={{ padding: '6px 8px', minWidth: 'auto', flexShrink: 0 }}
                        >
                          <RefreshCw size={14} className={refreshingModels ? 'spin-animation' : ''} />
                        </button>
                      </div>
                      {refreshModelsResult && (
                        <small className={`setting-hint ${refreshModelsResult.success ? 'success' : 'error'}`}>
                          {refreshModelsResult.message}
                        </small>
                      )}
                      {refreshingModels && (
                        <small className="setting-hint">{t('settings.ai.refreshing')}</small>
                      )}
                    </>
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
          </>
        )}
      </div>

      {ocrConfig.enabled && (
        <div className="settings-content">
          <div className="setting-group-title section-title collapsible-title" onClick={() => toggleSection('ocr')}>
            {collapsedSections.ocr ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            {t('settings.tabs.ocr')}
          </div>
          {!collapsedSections.ocr && (
            <>
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

              {ocrConfig.current_provider !== 'Native' && (
                <div className="setting-item">
                  <label>{t('settings.ocr.apiKey')}</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showOcrApiKey ? 'text' : 'password'}
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

              {ocrConfig.current_provider === 'Native' && (
                <div className="setting-item">
                  <div className="info-box">
                    <span>{t('settings.ocr.nativeInfo')}</span>
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
            </>
          )}
        </div>
      )}

      {mcpConfig.enabled && (
        <div className="settings-content">
          <div className="setting-group-title section-title collapsible-title" onClick={() => toggleSection('mcp')}>
            {collapsedSections.mcp ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
            {t('settings.tabs.mcp')}
          </div>
          {!collapsedSections.mcp && (
            <>
              <div className="setting-item">
                <label>{t('settings.mcp.port')}</label>
                <input
                  type="number"
                  value={mcpConfig.port || 38470}
                  onChange={(e) => setMcpConfig({ ...mcpConfig, port: parseInt(e.target.value, 10) || 38470 })}
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
    "qollect": {
      "url": "http://localhost:${actualMcpPort}/mcp"
    }
  }
}`}
                  </pre>
                  <button
                    onClick={() => {
                      const config = `{
  "mcpServers": {
    "qollect": {
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
                    {copySuccess ? `[OK] ${t('settings.mcp.configCopied')}` : t('settings.mcp.copyConfig')}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

export default IntegrationsCoreSection;
