use crate::core::clipboard_manager::ClipboardManager;
use crate::core::models::ClipboardItem;
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;
use tauri::{Manager, State};

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
pub async fn copy_plain_text(
    manager: State<'_, Arc<ClipboardManager>>,
    text: String,
) -> Result<(), String> {
    manager
        .copy_plain_text(&text)
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

#[tauri::command]
pub async fn try_paste_foreground(app: tauri::AppHandle) -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }

        tokio::time::sleep(std::time::Duration::from_millis(80)).await;
        send_ctrl_v_input().map_err(|e| format!("Failed to simulate paste: {}", e))?;
        return Ok(true);
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Keep behavior extensible: other platforms currently fallback to copy-only.
        Ok(false)
    }
}

#[tauri::command]
pub async fn save_image_as(
    manager: State<'_, Arc<ClipboardManager>>,
    id: String,
) -> Result<String, String> {
    let item = manager
        .get_item_by_id(&id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Item not found".to_string())?;

    if item.type_ != "image" {
        return Err("Only image types can be saved".to_string());
    }

    let source_path = image_source_path(&item)?;
    let source = Path::new(&source_path);
    if !source.exists() {
        return Err("Image file not found".to_string());
    }

    let suggested_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .map(ToString::to_string)
        .unwrap_or_else(|| "image.png".to_string());

    let extension = source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or("png");

    let save_path = rfd::FileDialog::new()
        .set_file_name(&suggested_name)
        .add_filter("Image", &[extension])
        .save_file()
        .ok_or_else(|| "CANCELLED".to_string())?;

    std::fs::copy(source, &save_path).map_err(|e| format!("Failed to save image: {}", e))?;

    Ok(save_path.to_string_lossy().to_string())
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

fn image_source_path(item: &ClipboardItem) -> Result<String, String> {
    let image_paths = item
        .image_paths
        .as_deref()
        .ok_or_else(|| "Image path is empty".to_string())?;

    if let Ok(value) = serde_json::from_str::<serde_json::Value>(image_paths) {
        if let Some(path) = value.get("original").and_then(|v| v.as_str()) {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }

        if let Some(path) = value.get("raw").and_then(|v| v.as_str()) {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                return Ok(trimmed.to_string());
            }
        }
    }

    let trimmed = image_paths.trim();
    if trimmed.is_empty() {
        return Err("Image path is empty".to_string());
    }

    Ok(trimmed.to_string())
}

#[cfg(target_os = "windows")]
fn send_ctrl_v_input() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        VK_CONTROL,
    };

    const VK_V_KEY: u16 = 0x56;

    fn key_input(vk: u16, key_up: bool) -> INPUT {
        let flags = if key_up {
            KEYEVENTF_KEYUP
        } else {
            Default::default()
        };

        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: VIRTUAL_KEY(vk),
                    wScan: 0,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    let inputs = [
        key_input(VK_CONTROL.0, false),
        key_input(VK_V_KEY, false),
        key_input(VK_V_KEY, true),
        key_input(VK_CONTROL.0, true),
    ];

    let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
    if sent != inputs.len() as u32 {
        return Err(format!("SendInput sent {} events, expected {}", sent, inputs.len()).into());
    }

    Ok(())
}

#[tauri::command]
pub async fn reveal_in_folder(
    manager: State<'_, Arc<ClipboardManager>>,
    id: String,
) -> Result<(), String> {
    let item = manager
        .get_item_by_id(&id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Item not found".to_string())?;

    if item.type_ != "file" {
        return Err("Only file types can be revealed".to_string());
    }

    let file_path = first_file_target(
        item.content
            .as_deref()
            .ok_or_else(|| "File path is empty".to_string())?,
    )?;

    let path = Path::new(&file_path);
    if !path.exists() {
        return Err("File does not exist".to_string());
    }

    reveal_path_in_explorer(path)?;
    Ok(())
}

fn reveal_path_in_explorer(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to reveal in folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn()
            .map_err(|e| format!("Failed to reveal in folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = path.parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Failed to reveal in folder: {}", e))?;
        } else {
            return Err("Cannot determine parent folder".to_string());
        }
    }

    Ok(())
}

#[derive(Serialize)]
pub struct DirectoryItem {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: u64,
    pub extension: String,
}

#[derive(Serialize)]
pub struct FilePreviewData {
    pub preview_type: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub text_content: Option<String>,
    pub text_truncated: bool,
    pub is_directory: bool,
    pub directory_items: Option<Vec<DirectoryItem>>,
}

const IMAGE_EXTS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico",
];
const TEXT_EXTS: &[&str] = &[
    "txt", "md", "json", "csv", "log", "xml", "yaml", "yml", "toml", "ini", "conf",
    "js", "ts", "jsx", "tsx", "py", "rs", "go", "java", "c", "cpp", "h", "hpp",
    "sh", "bat", "ps1", "html", "css", "sql",
];
const AUDIO_EXTS: &[&str] = &["mp3", "wav", "ogg", "flac", "aac", "m4a", "wma"];
const VIDEO_EXTS: &[&str] = &["mp4", "webm", "mkv", "avi", "mov"];
const PDF_EXTS: &[&str] = &["pdf"];

fn classify_extension(ext: &str) -> &'static str {
    let lower = ext.to_ascii_lowercase();
    let lower = lower.as_str();
    if IMAGE_EXTS.contains(&lower) {
        "image"
    } else if TEXT_EXTS.contains(&lower) {
        "text"
    } else if AUDIO_EXTS.contains(&lower) {
        "audio"
    } else if VIDEO_EXTS.contains(&lower) {
        "video"
    } else if PDF_EXTS.contains(&lower) {
        "pdf"
    } else {
        "binary"
    }
}

const MAX_TEXT_READ: u64 = 5 * 1024 * 1024; // 5MB
const TEXT_PREVIEW_BYTES: usize = 10240; // 10KB

#[tauri::command]
pub async fn preview_file(file_path: String) -> Result<FilePreviewData, String> {
    let path = Path::new(&file_path);

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_string();

    let metadata = std::fs::metadata(path).map_err(|e| format!("Cannot read file: {}", e))?;
    let file_size = metadata.len();
    let is_directory = metadata.is_dir();

    let (preview_type, text_content, text_truncated, directory_items) = if is_directory {
        let mut items = Vec::new();
        if let Ok(entries) = std::fs::read_dir(path) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let path_str = entry.path().to_string_lossy().to_string();
                    let is_dir = meta.is_dir();
                    let size = meta.len();
                    let extension = entry
                        .path()
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("")
                        .to_string();

                    items.push(DirectoryItem {
                        name,
                        path: path_str,
                        is_directory: is_dir,
                        size,
                        extension,
                    });
                }
            }
            items.sort_by(|a, b| {
                match (a.is_directory, b.is_directory) {
                    (true, false) => std::cmp::Ordering::Less,
                    (false, true) => std::cmp::Ordering::Greater,
                    _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
                }
            });
        }
        ("directory".to_string(), None, false, Some(items))
    } else {
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        let preview_type = classify_extension(ext).to_string();

        let (text_content, text_truncated) = if preview_type == "text" && file_size <= MAX_TEXT_READ {
            match std::fs::read(path) {
                Ok(bytes) => {
                    let truncated = bytes.len() > TEXT_PREVIEW_BYTES;
                    let slice = if truncated {
                        &bytes[..TEXT_PREVIEW_BYTES]
                    } else {
                        &bytes[..]
                    };
                    let text = String::from_utf8_lossy(slice).to_string();
                    (Some(text), truncated)
                }
                Err(_) => (None, false),
            }
        } else {
            (None, false)
        };
        (preview_type, text_content, text_truncated, None)
    };

    Ok(FilePreviewData {
        preview_type,
        file_path: file_path.clone(),
        file_name,
        file_size,
        text_content,
        text_truncated,
        is_directory,
        directory_items,
    })
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

#[tauri::command]
pub async fn open_file_path(path: String) -> Result<(), String> {
    open_with_system(&path)
}

#[tauri::command]
pub async fn get_items_by_date_range(
    manager: State<'_, Arc<ClipboardManager>>,
    start_timestamp: i64,
    end_timestamp: i64,
) -> Result<Vec<ClipboardItem>, String> {
    manager
        .get_items_by_date_range(start_timestamp, end_timestamp)
        .await
        .map_err(|e| e.to_string())
}
