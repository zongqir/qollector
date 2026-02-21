function LanSyncDeviceLists({
  t,
  discovered,
  paired,
  pairCodeInputMap,
  setPairCodeInputMap,
  actioningDevice,
  configEnabled,
  onPairDiscovered,
  onPush,
  onPull,
  onUnpair,
}) {
  return (
    <>
      <div className="setting-group-title section-title">{t('settings.lanSync.discovered')}</div>
      <div className="setting-group lan-sync-list-group">
        {discovered.length === 0 && (
          <div className="sg-row">
            <span className="setting-hint-inline">{t('settings.lanSync.noDiscovered')}</span>
          </div>
        )}
        {discovered.map((device) => {
          const rowBusy = actioningDevice === `pair:${device.host}:${device.service_port}`;
          return (
            <div className="sg-row sg-row-stack" key={device.device_id}>
              <div className="lan-sync-device-head">
                <strong>{device.device_name}</strong>
                <span className="setting-hint-inline">
                  {device.host}:{device.service_port}
                </span>
              </div>
              <div className="lan-sync-action-row">
                <input
                  type="text"
                  className="setting-input"
                  value={pairCodeInputMap[device.device_id] || ''}
                  onChange={(event) =>
                    setPairCodeInputMap((prev) => ({
                      ...prev,
                      [device.device_id]: event.target.value,
                    }))
                  }
                  placeholder={t('settings.lanSync.enterPairCode')}
                />
                <button
                  className="test-btn"
                  onClick={() => onPairDiscovered(device)}
                  disabled={rowBusy || !configEnabled}
                >
                  {rowBusy ? t('settings.testing') : t('settings.lanSync.pairNow')}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="setting-group-title section-title">{t('settings.lanSync.paired')}</div>
      <div className="setting-group lan-sync-list-group">
        {paired.length === 0 && (
          <div className="sg-row">
            <span className="setting-hint-inline">{t('settings.lanSync.noPaired')}</span>
          </div>
        )}
        {paired.map((device) => (
          <div className="sg-row sg-row-stack" key={device.device_id}>
            <div className="lan-sync-device-head">
              <strong>{device.device_name}</strong>
              <span className="setting-hint-inline">
                {device.last_host || '-'}:{device.last_port || '-'}
              </span>
            </div>
            <div className="lan-sync-action-row">
              <button
                className="test-btn"
                onClick={() => onPush(device.device_id)}
                disabled={actioningDevice === `push:${device.device_id}` || !configEnabled}
              >
                {actioningDevice === `push:${device.device_id}`
                  ? t('settings.testing')
                  : t('settings.lanSync.pushLatest')}
              </button>
              <button
                className="test-btn"
                onClick={() => onPull(device.device_id)}
                disabled={actioningDevice === `pull:${device.device_id}` || !configEnabled}
              >
                {actioningDevice === `pull:${device.device_id}`
                  ? t('settings.testing')
                  : t('settings.lanSync.pullLatest')}
              </button>
              <button
                className="cancel-btn"
                onClick={() => onUnpair(device.device_id)}
                disabled={actioningDevice === `unpair:${device.device_id}` || !configEnabled}
              >
                {actioningDevice === `unpair:${device.device_id}`
                  ? t('settings.testing')
                  : t('settings.lanSync.unpair')}
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export default LanSyncDeviceLists;
