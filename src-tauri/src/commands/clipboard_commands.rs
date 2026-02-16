use crate::core::clipboard_manager::ClipboardManager;
use crate::core::models::ClipboardItem;
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_recent_items(
    manager: State<'_, Arc<ClipboardManager>>,
    limit: i32,
) -> Result<Vec<ClipboardItem>, String> {
    manager.get_recent(limit).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_recent_items_light(
    manager: State<'_, Arc<ClipboardManager>>,
    limit: i32,
) -> Result<Vec<ClipboardItem>, String> {
    manager
        .get_recent_light(limit)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_more_items(
    manager: State<'_, Arc<ClipboardManager>>,
    limit: i32,
    offset: i32,
) -> Result<Vec<ClipboardItem>, String> {
    manager
        .get_recent_paged(limit, offset)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn copy_item(
    manager: State<'_, Arc<ClipboardManager>>,
    item: ClipboardItem,
) -> Result<(), String> {
    manager
        .copy_to_clipboard(&item)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_item(
    manager: State<'_, Arc<ClipboardManager>>,
    item: ClipboardItem,
) -> Result<(), String> {
    manager.update_item(&item).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_item(
    manager: State<'_, Arc<ClipboardManager>>,
    id: String,
) -> Result<(), String> {
    manager.delete_item(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_pin_item(
    manager: State<'_, Arc<ClipboardManager>>,
    id: String,
    max_pinned: Option<usize>,
) -> Result<bool, String> {
    manager
        .toggle_pin(&id, max_pinned.unwrap_or(5))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pin_item(
    manager: State<'_, Arc<ClipboardManager>>,
    id: String,
    max_pinned: Option<usize>,
) -> Result<bool, String> {
    manager
        .pin_item(&id, max_pinned.unwrap_or(5))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_favorite_item(
    manager: State<'_, Arc<ClipboardManager>>,
    id: String,
) -> Result<bool, String> {
    manager
        .toggle_favorite(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_items(
    manager: State<'_, Arc<ClipboardManager>>,
    query: String,
    limit: Option<i32>,
) -> Result<Vec<ClipboardItem>, String> {
    manager
        .search_items(&query, limit.unwrap_or(200) as usize)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_item(
    manager: State<'_, Arc<ClipboardManager>>,
    id: String,
) -> Result<(), String> {
    let item = manager
        .get_item_by_id(&id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Item not found".to_string())?;

    let target = match item.type_.as_str() {
        "link" => parse_openable_link(
            item.content
                .as_deref()
                .ok_or_else(|| "Link content is empty".to_string())?,
        )?,
        "file" => first_file_target(
            item.content
                .as_deref()
                .ok_or_else(|| "File path is empty".to_string())?,
        )?,
        _ => return Err("Only link and file types can be opened".to_string()),
    };

    open_with_system(&target)?;

    Ok(())
}

#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    let target = parse_openable_link(&url)?;
    open_with_system(&target)?;
    Ok(())
}

fn first_file_target(content: &str) -> Result<String, String> {
    content
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "File path is empty".to_string())
}

fn parse_openable_link(content: &str) -> Result<String, String> {
    let trimmed = content.trim();
    let parsed = url::Url::parse(trimmed).map_err(|_| "Invalid link URL".to_string())?;
    let scheme = parsed.scheme();
    let supported = matches!(scheme, "http" | "https" | "ftp" | "ftps" | "ws" | "wss");
    if !supported {
        return Err("Unsupported link scheme".to_string());
    }
    Ok(trimmed.to_string())
}

fn open_with_system(target: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Failed to open: {}", e))?;
    }

    Ok(())
}
