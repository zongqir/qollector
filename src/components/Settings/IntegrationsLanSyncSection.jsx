import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  cancelLanPairCode,
  getLanDiscoveredDevices,
  getLanPairCodeSession,
  getLanPairedDevices,
  getLanSyncConfig,
  getLanSyncIdentity,
  getLanSyncRunning,
  pairLanDevice,
  pullLatestSlotFromLanDevice,
  pushLatestSlotToLanDevice,
  startLanPairCode,
  unpairLanDevice,
  updateLanSyncConfig,
} from '../../services/lanSyncService';
import LanSyncDeviceLists from './LanSyncDeviceLists';
import { humanizeLanReason } from './lanSyncReason';
const DEFAULT_CONFIG = {
  enabled: false,
  device_id: '',
  device_name: '',
  service_port: 39211,
  discovery_port: 39212,
  discovery_interval_ms: 3000,
  discovery_ttl_ms: 12000,
  pair_code_ttl_secs: 60,
  pair_max_failures: 5,
  pair_lockout_secs: 300,
  request_timeout_ms: 4000,
};
function IntegrationsLanSyncSection({ t, collapsed, onToggle }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [identity, setIdentity] = useState({ device_id: '', device_name: '' });
  const [running, setRunning] = useState(false);
  const [discovered, setDiscovered] = useState([]);
  const [paired, setPaired] = useState([]);
  const [pairSession, setPairSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [savingConfig, setSavingConfig] = useState(false);
  const [actioningDevice, setActioningDevice] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [manualHost, setManualHost] = useState('');
  const [manualPort, setManualPort] = useState('39211');
  const [manualCode, setManualCode] = useState('');
  const [pairCodeInputMap, setPairCodeInputMap] = useState({});
  const clearStatus = () => { setMessage(''); setError(''); };
  const refreshAll = useCallback(async () => {
    try {
      const [
        nextConfig,
        nextIdentity,
        nextRunning,
        nextDiscovered,
        nextPaired,
        nextPairSession,
      ] = await Promise.all([
        getLanSyncConfig(),
        getLanSyncIdentity(),
        getLanSyncRunning(),
        getLanDiscoveredDevices(),
        getLanPairedDevices(),
        getLanPairCodeSession(),
      ]);
      setConfig((prev) => ({ ...prev, ...nextConfig }));
      setIdentity(nextIdentity || { device_id: '', device_name: '' });
      setRunning(Boolean(nextRunning));
      setDiscovered(Array.isArray(nextDiscovered) ? nextDiscovered : []);
      setPaired(Array.isArray(nextPaired) ? nextPaired : []);
      setPairSession(nextPairSession || null);
    } catch (loadError) {
      console.error('load lan sync state failed:', loadError);
      setError(
        t('settings.lanSync.loadFailed', {
          error: humanizeLanReason(t, loadError),
        }),
      );
    }
  }, [t]);
  useEffect(() => {
    let disposed = false;
    const boot = async () => {
      setLoading(true);
      clearStatus();
      await refreshAll();
      if (!disposed) setLoading(false);
    };
    boot();
    return () => {
      disposed = true;
    };
  }, [refreshAll]);
  useEffect(() => {
    if (!config.enabled) return undefined;

    const timer = setInterval(() => {
      refreshAll();
    }, 3000);
    return () => clearInterval(timer);
  }, [config.enabled, refreshAll]);
  const pairSessionRemainingSeconds = useMemo(() => {
    if (!pairSession?.expires_at_ms) return 0;
    const remainMs = pairSession.expires_at_ms - Date.now();
    if (remainMs <= 0) return 0;
    return Math.ceil(remainMs / 1000);
  }, [pairSession]);
  const manualPairActionKey = useMemo(
    () => `pair:${manualHost.trim()}:${Number(manualPort) || 39211}`,
    [manualHost, manualPort],
  );
  useEffect(() => {
    if (!pairSession?.expires_at_ms) return undefined;
    const timer = setInterval(() => {
      setPairSession((prev) => {
        if (!prev?.expires_at_ms) return prev;
        if (prev.expires_at_ms <= Date.now()) return null;
        return { ...prev };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pairSession?.expires_at_ms]);
  const saveConfig = async (nextConfig, successMessage) => {
    setSavingConfig(true);
    clearStatus();
    try {
      const normalized = {
        ...config,
        ...nextConfig,
        service_port: Number(nextConfig.service_port ?? config.service_port) || 39211,
        discovery_port: Number(nextConfig.discovery_port ?? config.discovery_port) || 39212,
      };
      await updateLanSyncConfig(normalized);
      setConfig(normalized);
      await refreshAll();
      if (successMessage) setMessage(successMessage);
    } catch (saveError) {
      console.error('save lan sync config failed:', saveError);
      setError(
        t('settings.lanSync.saveFailed', {
          error: humanizeLanReason(t, saveError),
        }),
      );
    } finally {
      setSavingConfig(false);
    }
  };
  const ensureLocalSyncSlot = async () => {
    const slot = await invoke('get_sync_latest_slot');
    if (slot) return slot;

    const recentItems = await invoke('get_recent_items', { limit: 1 });
    if (!Array.isArray(recentItems) || recentItems.length === 0) {
      throw new Error(t('settings.lanSync.noLocalItem'));
    }

    const latest = recentItems[0];
    const sourceDeviceId = (identity.device_id || config.device_id || '').trim();
    if (!sourceDeviceId) {
      throw new Error(t('settings.lanSync.identityMissing'));
    }

    await invoke('publish_sync_slot_from_item', {
      itemId: latest.id,
      sourceDeviceId,
    });

    const nextSlot = await invoke('get_sync_latest_slot');
    if (!nextSlot) {
      throw new Error(t('settings.lanSync.localSlotEmpty'));
    }
    return nextSlot;
  };
  const handleStartPairCode = async () => {
    clearStatus();
    try {
      const session = await startLanPairCode();
      setPairSession(session);
      setMessage(t('settings.lanSync.pairCodeStarted'));
    } catch (startError) {
      console.error('start pair code failed:', startError);
      setError(
        t('settings.lanSync.actionFailed', {
          error: humanizeLanReason(t, startError),
        }),
      );
    }
  };
  const handleCancelPairCode = async () => {
    clearStatus();
    try {
      await cancelLanPairCode();
      setPairSession(null);
      setMessage(t('settings.lanSync.pairCodeCancelled'));
    } catch (cancelError) {
      console.error('cancel pair code failed:', cancelError);
      setError(
        t('settings.lanSync.actionFailed', {
          error: humanizeLanReason(t, cancelError),
        }),
      );
    }
  };

  const doPairWithTarget = async (host, port, code, clearInputKey = '') => {
    if (!host || !code) {
      setError(t('settings.lanSync.pairInputRequired'));
      return;
    }

    setActioningDevice(`pair:${host}:${port}`);
    clearStatus();
    try {
      await pairLanDevice(host, Number(port) || 39211, code);
      await refreshAll();
      setMessage(t('settings.lanSync.pairSuccess'));
      if (clearInputKey) {
        setPairCodeInputMap((prev) => ({ ...prev, [clearInputKey]: '' }));
      }
      setManualCode('');
    } catch (pairError) {
      console.error('pair device failed:', pairError);
      setError(
        t('settings.lanSync.pairFailed', {
          error: humanizeLanReason(t, pairError),
        }),
      );
    } finally {
      setActioningDevice('');
    }
  };

  const handlePairDiscovered = async (device) => doPairWithTarget(
    device.host,
    device.service_port,
    (pairCodeInputMap[device.device_id] || '').trim(),
    device.device_id,
  );

  const handleManualPair = async () => doPairWithTarget(
    manualHost.trim(),
    Number(manualPort) || 39211,
    manualCode.trim(),
  );

  const handlePush = async (deviceId) => {
    setActioningDevice(`push:${deviceId}`);
    clearStatus();
    try {
      await ensureLocalSyncSlot();
      const result = await pushLatestSlotToLanDevice(deviceId);
      if (result?.applied) {
        setMessage(t('settings.lanSync.pushApplied'));
      } else {
        setMessage(
          t('settings.lanSync.pushSkipped', {
            reason: humanizeLanReason(t, result?.reason || 'unknown'),
          }),
        );
      }
      await refreshAll();
    } catch (pushError) {
      console.error('push latest slot failed:', pushError);
      setError(
        t('settings.lanSync.pushFailed', {
          error: humanizeLanReason(t, pushError),
        }),
      );
    } finally {
      setActioningDevice('');
    }
  };

  const handlePull = async (deviceId) => {
    setActioningDevice(`pull:${deviceId}`);
    clearStatus();
    try {
      const result = await pullLatestSlotFromLanDevice(deviceId);
      if (result?.applied) {
        setMessage(t('settings.lanSync.pullApplied'));
      } else {
        setMessage(
          t('settings.lanSync.pullSkipped', {
            reason: humanizeLanReason(t, result?.reason || 'unknown'),
          }),
        );
      }
      await refreshAll();
    } catch (pullError) {
      console.error('pull latest slot failed:', pullError);
      setError(
        t('settings.lanSync.pullFailed', {
          error: humanizeLanReason(t, pullError),
        }),
      );
    } finally {
      setActioningDevice('');
    }
  };

  const handleUnpair = async (deviceId) => {
    setActioningDevice(`unpair:${deviceId}`);
    clearStatus();
    try {
      await unpairLanDevice(deviceId);
      await refreshAll();
      setMessage(t('settings.lanSync.unpairSuccess'));
    } catch (unpairError) {
      console.error('unpair device failed:', unpairError);
      setError(
        t('settings.lanSync.unpairFailed', {
          error: humanizeLanReason(t, unpairError),
        }),
      );
    } finally {
      setActioningDevice('');
    }
  };

  return (
    <div className="settings-content">
      <div className="setting-group-title section-title collapsible-title" onClick={onToggle}>
        {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        {t('settings.lanSync.title')}
      </div>
      {!collapsed && (
      <>
      <div className="setting-group">
        <label className="sg-row setting-toggle-row">
          <span className="toggle-label-group">
            <span className="toggle-label">{t('settings.lanSync.enabled')}</span>
            <span className="toggle-desc">{t('settings.lanSync.enabledHint')}</span>
          </span>
          <span className="toggle-switch">
            <input
              type="checkbox"
              checked={Boolean(config.enabled)}
              onChange={(event) => {
                saveConfig(
                  { enabled: event.target.checked },
                  event.target.checked
                    ? t('settings.lanSync.started')
                    : t('settings.lanSync.stopped'),
                );
              }}
            />
            <span className="toggle-slider" />
          </span>
        </label>
        <div className="sg-row">
          <span>{t('settings.lanSync.runningState')}</span>
          <span className={`setting-status-pill ${running ? 'on' : 'off'}`}>
            {running ? t('settings.lanSync.running') : t('settings.lanSync.stopped')}
          </span>
        </div>
      </div>

      <div className="setting-group-title section-title">{t('settings.lanSync.device')}</div>
      <div className="setting-group">
        <div className="sg-row sg-row-stack">
          <label>{t('settings.lanSync.deviceName')}</label>
          <input
            type="text"
            className="setting-input"
            value={config.device_name || ''}
            onChange={(event) => setConfig((prev) => ({ ...prev, device_name: event.target.value }))}
            onBlur={() => {
              if ((config.device_name || '').trim() === (identity.device_name || '').trim()) return;
              saveConfig({
                device_name: (config.device_name || '').trim() || t('settings.lanSync.defaultDeviceName'),
              });
            }}
            placeholder={t('settings.lanSync.deviceNamePlaceholder')}
          />
        </div>
        <div className="sg-row sg-row-stack">
          <label>{t('settings.lanSync.deviceId')}</label>
          <code className="setting-inline-code">{identity.device_id || '-'}</code>
        </div>
        <div className="sg-row sg-row-stack">
          <label>{t('settings.lanSync.servicePort')}</label>
          <input
            type="number"
            className="setting-input"
            min="1024"
            max="65535"
            value={config.service_port || 39211}
            onChange={(event) => setConfig((prev) => ({ ...prev, service_port: Number(event.target.value) || 39211 }))}
            onBlur={() => saveConfig({ service_port: Number(config.service_port) || 39211 })}
          />
        </div>
        <div className="sg-row sg-row-stack">
          <label>{t('settings.lanSync.discoveryPort')}</label>
          <input
            type="number"
            className="setting-input"
            min="1024"
            max="65535"
            value={config.discovery_port || 39212}
            onChange={(event) => setConfig((prev) => ({ ...prev, discovery_port: Number(event.target.value) || 39212 }))}
            onBlur={() => saveConfig({ discovery_port: Number(config.discovery_port) || 39212 })}
          />
        </div>
      </div>

      <div className="setting-group-title section-title">{t('settings.lanSync.pairCode')}</div>
      <div className="setting-group">
        <div className="sg-row sg-row-stack">
          <label>{t('settings.lanSync.currentPairCode')}</label>
          <div className="lan-sync-code-row">
            <code className="setting-inline-code pair-code">
              {pairSession?.code || t('settings.lanSync.notActive')}
            </code>
            <span className="setting-hint-inline">
              {pairSession
                ? t('settings.lanSync.codeTtl', { seconds: pairSessionRemainingSeconds })
                : t('settings.lanSync.codeHint')}
            </span>
          </div>
        </div>
        <div className="setting-btn-row">
          <button className="test-btn" onClick={handleStartPairCode} disabled={!config.enabled || loading}>
            {t('settings.lanSync.startPairCode')}
          </button>
          <button className="cancel-btn" onClick={handleCancelPairCode} disabled={!pairSession}>
            {t('settings.lanSync.cancelPairCode')}
          </button>
        </div>
      </div>

      <LanSyncDeviceLists
        t={t}
        discovered={discovered}
        paired={paired}
        pairCodeInputMap={pairCodeInputMap}
        setPairCodeInputMap={setPairCodeInputMap}
        actioningDevice={actioningDevice}
        configEnabled={Boolean(config.enabled)}
        onPairDiscovered={handlePairDiscovered}
        onPush={handlePush}
        onPull={handlePull}
        onUnpair={handleUnpair}
      />

      <div className="setting-group-title section-title">{t('settings.lanSync.manualPair')}</div>
      <div className="setting-group">
        <div className="sg-row sg-row-stack">
          <label>{t('settings.lanSync.targetHost')}</label>
          <input
            type="text"
            className="setting-input"
            value={manualHost}
            onChange={(event) => setManualHost(event.target.value)}
            placeholder={t('settings.lanSync.targetHostPlaceholder')}
          />
        </div>
        <div className="sg-row sg-row-stack">
          <label>{t('settings.lanSync.targetPort')}</label>
          <input
            type="number"
            min="1024"
            max="65535"
            className="setting-input"
            value={manualPort}
            onChange={(event) => setManualPort(event.target.value)}
          />
        </div>
        <div className="sg-row sg-row-stack">
          <label>{t('settings.lanSync.enterPairCode')}</label>
          <input
            type="text"
            className="setting-input"
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value)}
            placeholder={t('settings.lanSync.enterPairCode')}
          />
        </div>
        <div className="setting-btn-row">
          <button
            className="test-btn"
            onClick={handleManualPair}
            disabled={actioningDevice === manualPairActionKey || !config.enabled}
          >
            {actioningDevice === manualPairActionKey
              ? t('settings.testing')
              : t('settings.lanSync.pairNow')}
          </button>
        </div>
      </div>

      <div className="setting-btn-row">
        <button className="test-btn" onClick={refreshAll} disabled={loading || savingConfig}>
          {t('settings.lanSync.refresh')}
        </button>
      </div>

      {message && <small className="setting-status success">{message}</small>}
      {error && <small className="setting-status error">{error}</small>}
      {savingConfig && <small className="setting-hint-block">{t('settings.lanSync.saving')}</small>}
      </>
      )}
    </div>
  );
}

export default IntegrationsLanSyncSection;
