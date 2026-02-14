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
    max_pinned: Option<usize>,
) -> Result<bool, String> {
    manager.toggle_pin(&id, max_pinned.unwrap_or(5))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn toggle_favorite_item(
    manager: State<'_, Arc<ClipboardManager>>,
    id: String,
) -> Result<bool, String> {
    manager.toggle_favorite(&id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn open_item(
    manager: State<'_, Arc<ClipboardManager>>,
    id: String,
) -> Result<(), String> {
    // 获取条目
    let items = manager.get_recent(1000).await.map_err(|e| e.to_string())?;
    let item = items.iter().find(|i| i.id == id)
        .ok_or_else(|| "Item not found".to_string())?;

    // 根据类型决定打开什么
    let target = match item.type_.as_str() {
        "link" => {
            // 链接类型,直接打开 content
            item.content.as_ref()
                .ok_or_else(|| "Link content is empty".to_string())?
                .clone()
        },
        "file" => {
            // 文件类型,打开 content 中的文件路径
            item.content.as_ref()
                .ok_or_else(|| "File path is empty".to_string())?
                .clone()
        },
        _ => {
            return Err("Only link and file types can be opened".to_string());
        }
    };

    // 使用系统默认程序打开
    open_with_system(&target)?;

    Ok(())
}

// 使用系统默认程序打开链接或文件
fn open_with_system(target: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", target])
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
