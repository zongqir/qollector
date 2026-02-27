import { ChevronDown, ChevronRight } from 'lucide-react';

function IntegrationsLanSyncSection({ t, collapsed, onToggle }) {
  return (
    <div className="settings-content">
      <div className="setting-group-title section-title collapsible-title" onClick={onToggle}>
        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        {t('settings.lanSync.title')}
        <span className="beta-badge">{t('settings.lanSync.betaBadge')}</span>
      </div>

      {!collapsed && (
        <>
          <div className="setting-group">
            <label className="sg-row setting-toggle-row">
              <span className="toggle-label-group">
                <span className="toggle-label">{t('settings.lanSync.enabled')}</span>
                <span className="toggle-desc">{t('settings.lanSync.betaDisabledHint')}</span>
              </span>
              <span className="toggle-switch">
                <input type="checkbox" checked={false} disabled readOnly />
                <span className="toggle-slider" />
              </span>
            </label>
          </div>

          <small className="setting-hint-block">{t('settings.lanSync.betaDisabledHint')}</small>
        </>
      )}
    </div>
  );
}

export default IntegrationsLanSyncSection;
