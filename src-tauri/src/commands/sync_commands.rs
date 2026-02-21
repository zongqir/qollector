use crate::core::clipboard_manager::ClipboardManager;
use crate::core::models::{SyncApplyResult, SyncIncomingSlot, SyncLatestSlot};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_sync_latest_slot(
    manager: State<'_, Arc<ClipboardManager>>,
) -> Result<Option<SyncLatestSlot>, String> {
    manager
        .get_sync_latest_slot()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_next_sync_source_seq_hint(
    manager: State<'_, Arc<ClipboardManager>>,
    source_device_id: String,
) -> Result<i64, String> {
    manager
        .get_next_sync_source_seq_hint(&source_device_id)
        .await
}

#[tauri::command]
pub async fn publish_sync_slot_from_item(
    manager: State<'_, Arc<ClipboardManager>>,
    item_id: String,
    source_device_id: String,
) -> Result<SyncLatestSlot, String> {
    manager
        .publish_sync_slot_from_item(&item_id, &source_device_id)
        .await
}

#[tauri::command]
pub async fn publish_sync_slot_payload(
    manager: State<'_, Arc<ClipboardManager>>,
    payload_json: String,
    payload_type: String,
    source_device_id: String,
    content_hash: String,
    logical_ts_ms: Option<i64>,
) -> Result<SyncLatestSlot, String> {
    manager
        .publish_sync_slot_payload(
            &payload_json,
            &payload_type,
            &source_device_id,
            &content_hash,
            logical_ts_ms,
        )
        .await
}

#[tauri::command]
pub async fn apply_remote_sync_slot(
    manager: State<'_, Arc<ClipboardManager>>,
    incoming: SyncIncomingSlot,
) -> Result<SyncApplyResult, String> {
    manager.apply_remote_sync_slot(incoming).await
}
