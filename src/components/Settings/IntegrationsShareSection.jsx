import { invoke } from '@tauri-apps/api/core';

function IntegrationsShareSection({
  t,
  shareConfig,
  setShareConfig,
  shareTesting,
  setShareTesting,
  shareTestResult,
  setShareTestResult,
}) {
  return (
    <div className="settings-content">
      <div className="setting-group-title section-title">{t('settings.tabs.share')}</div>
      <label className="setting-label share-field-label">{t('settings.share.provider')}</label>
      <select
        className="setting-select"
        value={shareConfig.provider}
        onChange={(e) => {
          const key = e.target.value;
          const updated = { ...shareConfig, provider: key };
          if (key === 'S3' && !shareConfig.s3_config) {
            updated.s3_config = {
              endpoint: '',
              region: '',
              bucket: '',
              access_key: '',
              secret_key: '',
              custom_domain: null,
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
      <label className="setting-label share-option-label">
        <input
          type="checkbox"
          checked={Boolean(shareConfig.force_upload_non_ascii_text)}
          onChange={(e) => {
            const updated = {
              ...shareConfig,
              force_upload_non_ascii_text: e.target.checked,
            };
            setShareConfig(updated);
            invoke('update_share_config', { config: updated }).catch(console.error);
          }}
        />
        <span className="share-option-text">{t('settings.share.forceUploadNonAscii')}</span>
      </label>
      <small className="setting-hint-block">
        {t('settings.share.forceUploadNonAsciiHint')}
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
  );
}

export default IntegrationsShareSection;
