use crate::core::models::ClipboardItem;
use crate::core::clipboard_manager::ClipboardManager;
use tauri::State;
use std::sync::Arc;

#[tauri::command]
pub async fn get_recent_items(
    manager: State<'_, Arc<ClipboardManager>>,
    limit: i32,
) -> Result<Vec<ClipboardItem>, String> {
    manager.get_recent(limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn copy_item(
    manager: State<'_, Arc<ClipboardManager>>,
    item: ClipboardItem,
) -> Result<(), String> {
    manager.copy_to_clipboard(&item)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_item(
    manager: State<'_, Arc<ClipboardManager>>,
    item: ClipboardItem,
) -> Result<(), String> {
    manager.update_item(&item)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_item(
    manager: State<'_, Arc<ClipboardManager>>,
    id: String,
) -> Result<(), String> {
    manager.delete_item(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_pin_item(
    manager: State<'_, Arc<ClipboardManager>>,
    id: String,
) -> Result<bool, String> {
    manager.toggle_pin(&id)
        .await
        .map_err(|e| e.to_string())
}
