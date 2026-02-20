import { invoke } from '@tauri-apps/api/core';

function DataSecurityDataSection({
  t,
  generalConfig,
  setGeneralConfig,
  getWheelNextNumber,
  exportIncludeImages,
  setExportIncludeImages,
  exportEncrypt,
  setExportEncrypt,
  exportPassword,
  setExportPassword,
  exportConfirmPassword,
  setExportConfirmPassword,
  exporting,
  importing,
  handleExport,
  setImportNeedPassword,
  setImportPassword,
  setImportFilePath,
  setImportResult,
  handleImport,
  importNeedPassword,
  importPassword,
  importFilePath,
  exportResult,
  importResult,
  clearDataConfirm,
  handleClearAllData,
  clearing,
  setClearDataConfirm,
  setClearDataResult,
  clearDataResult,
}) {
  return (
    <div className="settings-content domain-section">
      <div className="domain-section-header">{t('settings.tabs.data')}</div>
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
                onWheel={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const currentValue = generalConfig.cleanup_max_items ?? 50000;
                  const value = getWheelNextNumber({
                    rawValue: e.currentTarget.value,
                    fallback: currentValue,
                    min: 100,
                    max: 999999,
                    step: 100,
                    deltaY: e.deltaY,
                  });
                  if (value === currentValue) return;
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
                onWheel={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const currentValue = generalConfig.cleanup_max_age_days ?? 90;
                  const value = getWheelNextNumber({
                    rawValue: e.currentTarget.value,
                    fallback: currentValue,
                    min: 1,
                    max: 3650,
                    deltaY: e.deltaY,
                  });
                  if (value === currentValue) return;
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
              onChange={(e) => {
                setExportEncrypt(e.target.checked);
                setExportPassword('');
                setExportConfirmPassword('');
              }}
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
          onClick={() => {
            setImportNeedPassword(false);
            setImportPassword('');
            setImportFilePath(null);
            setImportResult(null);
            handleImport(null, null);
          }}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && importPassword) handleImport(importPassword, importFilePath);
            }}
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

      <div className="clear-data-zone">
        <label className="setting-label clear-data-title">{t('export.clearData')}</label>
        <small className="setting-hint-block clear-data-warning">
          {t('export.clearDataWarning')}
        </small>
        <div className="setting-btn-row clear-data-actions">
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
              onClick={() => {
                setClearDataConfirm(false);
                setClearDataResult(null);
              }}
              disabled={clearing}
            >
              {t('common.cancel')}
            </button>
          )}
        </div>
        {clearDataResult && (
          <small className={`setting-status clear-data-status ${clearDataResult.success ? 'success' : 'error'}`}>
            {clearDataResult.message}
          </small>
        )}
      </div>
    </div>
  );
}

export default DataSecurityDataSection;
