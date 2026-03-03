import { invoke } from '@tauri-apps/api/core';

function AboutSection({
  t,
  appVersion,
  aboutUpdateVersion,
  aboutUpdateRef,
  aboutUpdateStatus,
  aboutDownloadPercent,
  aboutUpdateError,
  onCheckUpdate,
  onDownloadAndRestart,
}) {
  return (
    <div className="settings-section">
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '32px 0' }}>
        <div style={{ fontSize: 40 }}>📋</div>
        <div style={{ fontSize: 18, fontWeight: 600 }}>Qollect</div>
        <div style={{ fontSize: 12, opacity: 0.5, fontStyle: 'italic' }}>{t('app.slogan')}</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>v{appVersion}</div>
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); invoke('open_url', { url: 'https://qollect.zongqir.com/' }); }}
          style={{
            fontSize: 12,
            color: 'var(--accent-blue, #3b82f6)',
            textDecoration: 'none',
            opacity: 0.8,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => e.target.style.opacity = '1'}
          onMouseLeave={(e) => e.target.style.opacity = '0.8'}
        >
          {t('settings.about.website')}: qollect.zongqir.com
        </a>
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); invoke('open_url', { url: 'mailto:hi@zongqir.com' }); }}
          style={{
            fontSize: 12,
            color: 'var(--accent-blue, #3b82f6)',
            textDecoration: 'none',
            opacity: 0.8,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => e.target.style.opacity = '1'}
          onMouseLeave={(e) => e.target.style.opacity = '0.8'}
        >
          Contact: hi@zongqir.com
        </a>
        <div style={{
          display: 'inline-block',
          padding: '2px 10px',
          borderRadius: 12,
          background: 'rgba(255, 149, 0, 0.12)',
          color: '#ff9500',
          fontSize: 12,
          fontWeight: 600,
          letterSpacing: '0.02em',
        }}>Beta</div>
        <div style={{
          marginTop: 4,
          padding: '10px 16px',
          borderRadius: 8,
          background: 'var(--bg-input)',
          fontSize: 12,
          lineHeight: 1.7,
          color: 'var(--text-secondary)',
          maxWidth: 320,
          textAlign: 'center',
        }}>
          {t('settings.about.betaNotice')}
        </div>

        {aboutUpdateVersion && aboutUpdateRef && !aboutUpdateStatus && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, color: '#3b82f6' }}>
              {t('update.available', { version: aboutUpdateVersion })}
            </span>
            <span style={{ fontSize: 12, opacity: 0.65 }}>
              {t('update.manualDownloadHint')}
            </span>
            <button
              onClick={onDownloadAndRestart}
              className="save-btn"
              style={{ fontSize: 13 }}
            >
              {t('update.downloadNow')}
            </button>
          </div>
        )}

        {!aboutUpdateVersion && !aboutUpdateStatus && (
          <button onClick={onCheckUpdate} className="save-btn" style={{ fontSize: 13 }}>
            {t('update.checkNow')}
          </button>
        )}

        {aboutUpdateStatus === 'checking' && (
          <span style={{ fontSize: 13, opacity: 0.6 }}>{t('update.checking')}</span>
        )}
        {aboutUpdateStatus === 'downloading' && (
          <span style={{ fontSize: 13, opacity: 0.6 }}>
            {t('update.progress', { percent: Math.round(aboutDownloadPercent) })}
          </span>
        )}
        {aboutUpdateStatus === 'ready' && (
          <span style={{ fontSize: 13, color: '#22c55e' }}>{t('update.ready')}</span>
        )}
        {aboutUpdateStatus === 'upToDate' && (
          <span style={{ fontSize: 13, color: '#22c55e' }}>{t('update.upToDate')}</span>
        )}
        {aboutUpdateStatus === 'error' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 12, color: '#f87171' }}>{t('update.failed', { error: aboutUpdateError })}</span>
            <button onClick={onCheckUpdate} className="save-btn" style={{ fontSize: 12 }}>
              {t('update.checkNow')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AboutSection;
