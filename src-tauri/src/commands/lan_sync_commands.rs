use crate::core::models::SyncApplyResult;
use crate::lan_sync::{
    DiscoveredSyncDevice, LanSyncConfig, LanSyncService, LocalSyncIdentity, PairCodeSession,
    PairWithDeviceResult, PairedSyncDevice,
};
use crate::repository::config_repo::ConfigRepository;
use std::sync::Arc;
use tauri::State;

pub struct LanSyncState {
    pub config_repo: Arc<ConfigRepository>,
    pub service: Arc<LanSyncService>,
}

#[tauri::command]
pub async fn get_lan_sync_config(state: State<'_, LanSyncState>) -> Result<LanSyncConfig, String> {
    Ok(state.service.get_config().await)
}

#[tauri::command]
pub async fn update_lan_sync_config(
    config: LanSyncConfig,
    state: State<'_, LanSyncState>,
) -> Result<String, String> {
    state.service.update_config(config).await?;
    let sanitized = state.service.get_config().await;

    state
        .config_repo
        .save_lan_sync_config(&sanitized)
        .await
        .map_err(|e| format!("Failed to save LAN sync config: {}", e))?;
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn get_lan_sync_identity(
    state: State<'_, LanSyncState>,
) -> Result<LocalSyncIdentity, String> {
    Ok(state.service.get_identity().await)
}

#[tauri::command]
pub async fn get_lan_sync_running(state: State<'_, LanSyncState>) -> Result<bool, String> {
    Ok(state.service.is_running().await)
}

#[tauri::command]
pub async fn get_lan_discovered_devices(
    state: State<'_, LanSyncState>,
) -> Result<Vec<DiscoveredSyncDevice>, String> {
    Ok(state.service.list_discovered_devices().await)
}

#[tauri::command]
pub async fn start_lan_pair_code(
    state: State<'_, LanSyncState>,
) -> Result<PairCodeSession, String> {
    Ok(state.service.start_pair_code().await)
}

#[tauri::command]
pub async fn get_lan_pair_code_session(
    state: State<'_, LanSyncState>,
) -> Result<Option<PairCodeSession>, String> {
    Ok(state.service.get_pair_code_session().await)
}

#[tauri::command]
pub async fn cancel_lan_pair_code(state: State<'_, LanSyncState>) -> Result<String, String> {
    state.service.cancel_pair_code().await;
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn pair_lan_device(
    state: State<'_, LanSyncState>,
    target_host: String,
    target_port: u16,
    code: String,
) -> Result<PairWithDeviceResult, String> {
    state
        .service
        .pair_with_device(&target_host, target_port, &code)
        .await
}

#[tauri::command]
pub async fn get_lan_paired_devices(
    state: State<'_, LanSyncState>,
) -> Result<Vec<PairedSyncDevice>, String> {
    state.service.list_paired_devices().await
}

#[tauri::command]
pub async fn unpair_lan_device(
    state: State<'_, LanSyncState>,
    device_id: String,
) -> Result<String, String> {
    state.service.unpair_device(&device_id).await?;
    Ok("ok".to_string())
}

#[tauri::command]
pub async fn push_latest_slot_to_lan_device(
    state: State<'_, LanSyncState>,
    device_id: String,
) -> Result<SyncApplyResult, String> {
    state.service.push_latest_slot_to_device(&device_id).await
}

#[tauri::command]
pub async fn pull_latest_slot_from_lan_device(
    state: State<'_, LanSyncState>,
    device_id: String,
) -> Result<SyncApplyResult, String> {
    state.service.pull_latest_slot_from_device(&device_id).await
}
