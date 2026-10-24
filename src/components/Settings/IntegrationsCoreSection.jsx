import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Eye, EyeOff, ChevronDown, ChevronRight, RefreshCw, ArrowRight } from 'lucide-react';
import { SUPPORTED_SOURCE_LANGUAGES, SUPPORTED_TRANSLATION_LANGUAGES } from '../../utils/translationHelpers';

const AI_PROVIDERS = ['SiliconFlow', 'Volcano', 'Alibaba', 'OpenAI', 'Gemini', 'Custom'];

const OCR_PROVIDERS = ['Native', 'SiliconFlow', 'DeepSeek', 'Aliyun', 'Tencent', 'Baidu'];

function supportsInputCapture() {
  if (typeof navigator === 'undefined') return false;
  const platform = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || '')
    .toLowerCase();
  return platform.includes('win');
}

function formatSyncTime(timestamp) {
  if (!timestamp) return null;
  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function IntegrationsCoreSection({
  t,
  generalConfig,
  setGeneralConfig,
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
  onToggleAutoTranslateEnabled,
  onChangeAutoTranslateSourceLang,
  onChangeAutoTranslateTargetLang,
  onToggleMcpEnabled,
  onToggleCollectorEnabled,
  handleCollectorTest,
  handleCollectorSync,
  emailRelayConfig,
  setEmailRelayConfig,
  emailRelayTesting,
  emailRelayTestResult,
  showEmailPassword,
  setShowEmailPassword,
  onToggleEmailRelayEnabled,
  handleEmailRelayTest,
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
  const [inputProbePending, setInputProbePending] = useState(false);
  const [inputProbeResult, setInputProbeResult] = useState(null);
  const inputCaptureSupported = supportsInputCapture();
  const lastSync = formatSyncTime(collectorStatus.last_sync_at);

  const runInputAccessProbe = async () => {
    setInputProbePending(true);
    setInputProbeResult(null);
    const appWindow = getCurrentWindow();
    const probe = invoke('probe_focused_text', { delayMs: 6000 });

    try {
      await appWindow.hide();
      const result = await probe;
      setInputProbeResult({ type: result.readable ? 'success' : 'neutral', result });
    } catch (error) {
      console.error('Focused text probe failed:', error);
      setInputProbeResult({ type: 'error', error: String(error) });
    } finally {
      await appWindow.show().catch(() => {});
      await appWindow.setFocus().catch(() => {});
      setInputProbePending(false);
    }
  };

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
          {inputCaptureSupported && (
            <>
              <label className="sg-row setting-toggle-row">
                <span className="toggle-label-group">
                  <span className="toggle-label">{t('settings.general.inputCapture')}</span>
                  <span className="toggle-desc">{t('settings.general.inputCaptureHint')}</span>
                </span>
                <span className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={generalConfig.input_capture_enabled || false}
                    onChange={async (event) => {
                      const updated = {
                        ...generalConfig,
                        input_capture_enabled: event.target.checked,
                      };
                      setGeneralConfig(updated);
                      try {
                        await invoke('update_general_config', { config: updated });
                      } catch (error) {
                        console.error('Failed to save input capture config:', error);
                        setGeneralConfig(generalConfig);
                      }
                    }}
                  />
                  <span className="toggle-slider" />
                </span>
              </label>
              <div className="input-capture-tools">
                <small className="setting-hint">{t('settings.general.inputAccessProbeHint')}</small>
                <div className="setting-action-row">
                  <button
                    type="button"
                    className="test-btn"
                    disabled={inputProbePending}
                    onClick={runInputAccessProbe}
                  >
                    {inputProbePending
                      ? t('settings.general.inputAccessProbeRunning')
                      : t('settings.general.inputAccessProbeAction')}
                  </button>
                </div>
                {inputProbeResult?.result && (
                  <div
                    className={`input-access-probe-result ${inputProbeResult.type}`}
                    role="status"
                  >
                    <strong>
                      {inputProbeResult.result.readable
                        ? t('settings.general.inputAccessProbeReadable')
                        : inputProbeResult.result.is_password
                          ? t('settings.general.inputAccessProbePassword')
                          : t('settings.general.inputAccessProbeUnreadable')}
                    </strong>
                    <span>
                      {t('settings.general.inputAccessProbeControl', {
                        control: inputProbeResult.result.control_type || '-',
                        framework: inputProbeResult.result.framework_id || '-',
                      })}
                    </span>
                    {inputProbeResult.result.readable && (
                      <pre>{inputProbeResult.result.text_preview || t('settings.general.inputAccessProbeEmpty')}</pre>
                    )}
                    {!inputProbeResult.result.readable && inputProbeResult.result.read_error && (
                      <span>{inputProbeResult.result.read_error}</span>
                    )}
                  </div>
                )}
                {inputProbeResult?.error && (
                  <small className="setting-status setting-status-emphasis error" role="alert">
                    {t('settings.general.inputAccessProbeFailed', { error: inputProbeResult.error })}
                  </small>
                )}
              </div>
            </>
          )}
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
                  <span className="collector-last-sync">
                    {t('settings.collector.lastSync')}: <strong>{lastSync || t('settings.collector.noSyncRecord')}</strong>
                  </span>
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
        <label className="sg-row setting-toggle-row">
          <span className="toggle-label-group">
            <span className="toggle-label">{t('settings.emailRelay.title')}</span>
            <span className="toggle-desc">{t('settings.emailRelay.desc')}</span>
          </span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={emailRelayConfig?.enabled || false}
              onChange={(e) => onToggleEmailRelayEnabled(e.target.checked)}
            />
            <span className="toggle-slider" />
          </span>
        </label>
        {emailRelayConfig?.enabled && (
          <div className="settings-content">
            <div className="setting-group-title section-title collapsible-title" onClick={() => toggleSection('emailRelay')}>
              {collapsedSections.emailRelay ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
              {t('settings.emailRelay.configTitle')}
            </div>
            {!collapsedSections.emailRelay && (
              <>
                <div className="setting-item">
                  <label>{t('settings.emailRelay.smtpHost')}</label>
                  <input
                    type="text"
                    value={emailRelayConfig.smtp_host}
                    onChange={(e) => setEmailRelayConfig({ ...emailRelayConfig, smtp_host: e.target.value })}
                    placeholder="mail.company.com / 10.x.x.x"
                    className="setting-input"
                  />
                </div>
                <div className="setting-item-row" style={{ display: 'flex', gap: '12px' }}>
                  <div className="setting-item" style={{ flex: 1 }}>
                    <label>{t('settings.emailRelay.smtpPort')}</label>
                    <input
                      type="number"
                      value={emailRelayConfig.smtp_port || ''}
                      placeholder={emailRelayConfig.encryption === 'tls' ? '465 (默认)' : emailRelayConfig.encryption === 'starttls' ? '587 (默认)' : '25 (默认)'}
                      onChange={(e) => setEmailRelayConfig({ ...emailRelayConfig, smtp_port: e.target.value === '' ? 0 : parseInt(e.target.value, 10) || 0 })}
                      className="setting-input"
                    />
                  </div>
                  <div className="setting-item" style={{ flex: 1 }}>
                    <label>{t('settings.emailRelay.encryption')}</label>
                    <select
                      value={emailRelayConfig.encryption}
                      onChange={(e) => {
                        const newEnc = e.target.value;
                        const defaultPort = newEnc === 'tls' ? 465 : newEnc === 'starttls' ? 587 : 25;
                        setEmailRelayConfig({
                          ...emailRelayConfig,
                          encryption: newEnc,
                          smtp_port: defaultPort,
                        });
                      }}
                      className="setting-select"
                    >
                      <option value="none">{t('settings.emailRelay.encNone')}</option>
                      <option value="starttls">STARTTLS</option>
                      <option value="tls">SSL/TLS</option>
                    </select>
                  </div>
                </div>
                <div className="setting-item">
                  <label>{t('settings.emailRelay.fromAddress')}</label>
                  <input
                    type="email"
                    value={emailRelayConfig.from_address}
                    onChange={(e) => setEmailRelayConfig({ ...emailRelayConfig, from_address: e.target.value })}
                    placeholder="myname@company.com"
                    className="setting-input"
                  />
                </div>
                <div className="setting-item-row" style={{ display: 'flex', gap: '12px' }}>
                  <div className="setting-item" style={{ flex: 1 }}>
                    <label>{t('settings.emailRelay.username')}</label>
                    <input
                      type="text"
                      value={emailRelayConfig.username}
                      onChange={(e) => setEmailRelayConfig({ ...emailRelayConfig, username: e.target.value })}
                      placeholder={t('settings.emailRelay.usernamePlaceholder')}
                      className="setting-input"
                    />
                  </div>
                  <div className="setting-item" style={{ flex: 1 }}>
                    <label>{t('settings.emailRelay.password')}</label>
                    <div className="password-input-wrapper">
                      <input
                        type={showEmailPassword ? 'text' : 'password'}
                        value={emailRelayConfig.password}
                        onChange={(e) => setEmailRelayConfig({ ...emailRelayConfig, password: e.target.value })}
                        placeholder={t('settings.emailRelay.passwordPlaceholder')}
                        className="setting-input"
                      />
                      <button type="button" onClick={() => setShowEmailPassword(!showEmailPassword)} className="password-toggle-btn">
                        {showEmailPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
                <label className="sg-row setting-toggle-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
                  <span className="toggle-label-group">
                    <span className="toggle-label">{t('settings.emailRelay.sendToSelfDefault')}</span>
                    <span className="toggle-desc">{t('settings.emailRelay.sendToSelfDesc')}</span>
                  </span>
                  <span className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={emailRelayConfig.send_to_self_by_default}
                      onChange={(e) => setEmailRelayConfig({ ...emailRelayConfig, send_to_self_by_default: e.target.checked })}
                    />
                    <span className="toggle-slider" />
                  </span>
                </label>
                <div className="setting-actions">
                  <button onClick={handleEmailRelayTest} disabled={emailRelayTesting} className="test-btn">
                    {emailRelayTesting ? t('settings.testing') : t('settings.emailRelay.testBtn')}
                  </button>
                  {emailRelayTestResult && (
                    <span className={`test-result ${emailRelayTestResult.success ? 'success' : 'error'}`}>
                      {emailRelayTestResult.message}
                    </span>
                  )}
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

                <div className="setting-subgroup-title" style={{ marginTop: '16px', marginBottom: '8px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  {t('settings.ai.autoTranslate.title')}
                </div>
                <div className="setting-group" style={{ marginBottom: '12px' }}>
                  <label className="sg-row setting-toggle-row">
                    <span className="toggle-label-group">
                      <span className="toggle-label">{t('settings.ai.autoTranslate.enabled')}</span>
                      <span className="toggle-description" style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                        {t('settings.ai.autoTranslate.description')}
                      </span>
                    </span>
                    <span className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={Boolean(aiConfig.auto_translate_enabled)}
                        onChange={(e) => onToggleAutoTranslateEnabled(e.target.checked)}
                      />
                      <span className="toggle-slider" />
                    </span>
                  </label>
                </div>

                {aiConfig.auto_translate_enabled && (
                  <div className="setting-item auto-translate-row" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label>{t('settings.ai.autoTranslate.direction')}</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <select
                        value={aiConfig.auto_translate_source_lang || 'en'}
                        onChange={(e) => onChangeAutoTranslateSourceLang(e.target.value)}
                        className="setting-select"
                        style={{ flex: 1, minWidth: '120px' }}
                      >
                        {SUPPORTED_SOURCE_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {t(lang.labelKey)}
                          </option>
                        ))}
                      </select>
                      <ArrowRight size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      <select
                        value={aiConfig.auto_translate_target_lang || 'zh-CN'}
                        onChange={(e) => onChangeAutoTranslateTargetLang(e.target.value)}
                        className="setting-select"
                        style={{ flex: 1, minWidth: '120px' }}
                      >
                        {SUPPORTED_TRANSLATION_LANGUAGES.map((lang) => (
                          <option key={lang.code} value={lang.code}>
                            {t(lang.labelKey)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <small className="setting-hint" style={{ color: 'var(--text-muted)', marginTop: '4px' }}>
                      {t('settings.ai.autoTranslate.hint')}
                    </small>
                  </div>
                )}

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

      <div className="settings-content">
        <div className="setting-group-title section-title collapsible-title" onClick={() => toggleSection('ocr')}>
          {collapsedSections.ocr ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          {t('settings.tabs.ocr')}
        </div>
        {!collapsedSections.ocr && (
          <>
            <div className="setting-group">
              <label className="sg-row setting-toggle-row">
                <span className="toggle-label-group">
                  <span className="toggle-label">{t('settings.ocr.autoOcr')}</span>
                </span>
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
