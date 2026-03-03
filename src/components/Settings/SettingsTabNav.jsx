function SettingsTabNav({
  t,
  activeTab,
  onOpenGeneral,
  onOpenShortcuts,
  onOpenIntegrations,
  onOpenDataSecurity,
  onOpenAbout,
}) {
  return (
    <div className="settings-tabs">
      <button
        className={`tab-btn ${activeTab === 'general' ? 'active' : ''}`}
        onClick={onOpenGeneral}
      >
        {t('settings.tabs.general')}
      </button>
      <button
        className={`tab-btn ${activeTab === 'shortcuts' ? 'active' : ''}`}
        onClick={onOpenShortcuts}
      >
        {t('settings.tabs.shortcuts')}
      </button>
      <button
        className={`tab-btn ${activeTab === 'integrations' ? 'active' : ''}`}
        onClick={onOpenIntegrations}
      >
        {t('settings.general.featureModules')}
      </button>
      <button
        className={`tab-btn ${activeTab === 'dataSecurity' ? 'active' : ''}`}
        onClick={onOpenDataSecurity}
      >
        {`${t('settings.tabs.data')} / ${t('settings.tabs.security')}`}
      </button>
      <button
        className={`tab-btn ${activeTab === 'about' ? 'active' : ''}`}
        onClick={onOpenAbout}
      >
        {t('settings.tabs.about')}
      </button>
    </div>
  );
}

export default SettingsTabNav;
