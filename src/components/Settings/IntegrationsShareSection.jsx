import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, ChevronRight, ShieldCheck, ExternalLink, Globe } from 'lucide-react';
import { DEFAULT_RELAY_URL } from '../../share/providers';

function IntegrationsShareSection({
  t,
  shareConfig,
  setShareConfig,
  shareTesting,
  setShareTesting,
  shareTestResult,
  setShareTestResult,
  collapsed,
  onToggle,
}) {
  const [copiedDoc, setCopiedDoc] = useState(false);

  const handleRelayUrlChange = (value) => {
    const updated = {
      ...shareConfig,
      relay_url: value.trim(),
    };
    setShareConfig(updated);
    invoke('update_share_config', { config: updated }).catch(console.error);
  };

  const handleTestRelay = async () => {
    setShareTesting(true);
    setShareTestResult(null);
    const targetUrl = (shareConfig.relay_url || DEFAULT_RELAY_URL).replace(/\/+$/, '');
    try {
      const resp = await fetch(`${targetUrl}/healthz`, { method: 'GET', mode: 'cors' });
      if (resp.ok) {
        setShareTestResult({
          success: true,
          message: t('settings.share.testSuccess'),
        });
      } else {
        setShareTestResult({
          success: false,
          message: `${t('settings.share.testFailed')}: HTTP ${resp.status}`,
        });
      }
    } catch (err) {
      setShareTestResult({
        success: false,
        message: `${t('settings.share.testFailed')}: ${err.message || 'Network error'}`,
      });
    } finally {
      setShareTesting(false);
    }
  };

  return (
    <div className="settings-content">
      <div className="setting-group-title section-title collapsible-title" onClick={onToggle}>
        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        {t('settings.tabs.share')}
      </div>
      {!collapsed && (
        <>
          <div className="share-info-card" style={{
            background: 'var(--panel-item-bg, rgba(255, 255, 255, 0.03))',
            border: '1px solid var(--border-light)',
            borderRadius: '10px',
            padding: '12px 14px',
            marginBottom: '14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)', fontWeight: 500, fontSize: '13px' }}>
              <ShieldCheck size={16} style={{ color: 'var(--state-success-fg)' }} />
              <span>{t('settings.share.e2eeTitle')}</span>
            </div>
            <p style={{ margin: 0, fontSize: '12px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {t('settings.share.e2eeDesc')}
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
            <label className="setting-label share-field-label" style={{ margin: 0 }}>
              {t('settings.share.relayUrlLabel')}
            </label>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                invoke('open_url', { url: 'https://qollect-share.zongqir.com/docs' }).catch(console.error);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12px',
                color: 'var(--accent-color)',
                textDecoration: 'none',
                cursor: 'pointer',
              }}
              title={t('settings.share.viewDocTooltip')}
            >
              <ExternalLink size={12} />
              <span>{t('settings.share.viewDoc')}</span>
            </a>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              type="text"
              value={shareConfig.relay_url || ''}
              onChange={(e) => handleRelayUrlChange(e.target.value)}
              placeholder={DEFAULT_RELAY_URL}
              className="setting-input"
              style={{ flex: 1 }}
            />
            <button
              className="test-btn"
              onClick={handleTestRelay}
              disabled={shareTesting}
              style={{ whiteSpace: 'nowrap' }}
            >
              {shareTesting ? t('settings.testing') : t('settings.share.testConnection')}
            </button>
          </div>
          <small className="setting-hint-block">
            {t('settings.share.relayUrlHint')}
          </small>

          {shareTestResult && (
            <small className={`setting-status ${shareTestResult.success ? 'success' : 'error'}`} style={{ display: 'block', marginTop: '6px' }}>
              {shareTestResult.message}
            </small>
          )}
        </>
      )}
    </div>
  );
}

export default IntegrationsShareSection;
