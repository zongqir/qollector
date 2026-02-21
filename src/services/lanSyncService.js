import { invoke } from '@tauri-apps/api/core';

export function getLanSyncConfig() {
  return invoke('get_lan_sync_config');
}

export function updateLanSyncConfig(config) {
  return invoke('update_lan_sync_config', { config });
}

export function getLanSyncIdentity() {
  return invoke('get_lan_sync_identity');
}

export function getLanSyncRunning() {
  return invoke('get_lan_sync_running');
}

export function getLanDiscoveredDevices() {
  return invoke('get_lan_discovered_devices');
}

export function startLanPairCode() {
  return invoke('start_lan_pair_code');
}

export function getLanPairCodeSession() {
  return invoke('get_lan_pair_code_session');
}

export function cancelLanPairCode() {
  return invoke('cancel_lan_pair_code');
}

export function pairLanDevice(targetHost, targetPort, code) {
  return invoke('pair_lan_device', { targetHost, targetPort, code });
}

export function getLanPairedDevices() {
  return invoke('get_lan_paired_devices');
}

export function unpairLanDevice(deviceId) {
  return invoke('unpair_lan_device', { deviceId });
}

export function pushLatestSlotToLanDevice(deviceId) {
  return invoke('push_latest_slot_to_lan_device', { deviceId });
}

export function pullLatestSlotFromLanDevice(deviceId) {
  return invoke('pull_latest_slot_from_lan_device', { deviceId });
}
