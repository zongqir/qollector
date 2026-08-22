use crate::collector;
use crate::commands::ai_commands::AIState;
use crate::core::clipboard_manager::ClipboardManager;
use crate::config::CollectorConfig;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_collector_config(state: State<'_, AIState>) -> Result<CollectorConfig, String> {
    Ok(state
        .config_repo
        .load_collector_config()
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default())
}

#[tauri::command]
pub async fn update_collector_config(
    state: State<'_, AIState>,
    mut config: CollectorConfig,
) -> Result<(), String> {
    config.validate();
    state
        .config_repo
        .save_collector_config(&config)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_collector_connection(mut config: CollectorConfig) -> Result<(), String> {
    config.validate();
    if config.endpoint.is_empty() {
        return Err("服务器地址不能为空".to_string());
    }
    collector::test_connection(&config).await
}

#[tauri::command]
pub async fn get_collector_upload_status(
    manager: State<'_, Arc<ClipboardManager>>,
) -> Result<collector::CollectorUploadStatus, String> {
    manager.get_collector_upload_status().await
}

#[tauri::command]
pub async fn sync_collector_items(
    manager: State<'_, Arc<ClipboardManager>>,
) -> Result<collector::CollectorSyncResult, String> {
    manager.sync_collector_items().await
}
