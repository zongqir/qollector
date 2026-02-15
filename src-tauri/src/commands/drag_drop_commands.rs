use crate::core::clipboard_manager::ClipboardManager;
use crate::core::models::{ClipboardItem, WindowMetadata};
use base64::Engine;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};

fn normalize_unique_paths(raw: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let key = if cfg!(target_os = "windows") {
            trimmed.to_ascii_lowercase()
        } else {
            trimmed.to_string()
        };

        if seen.insert(key) {
            result.push(trimmed.to_string());
        }
    }

    result
}

fn is_windows_shortcut(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".lnk")
}

#[cfg(target_os = "windows")]
fn resolve_shortcut_target(path: &str) -> Option<String> {
    if !is_windows_shortcut(path) {
        return None;
    }

    let escaped = path.replace('"', "`\"");
    let script = format!(
        "$p=\"{}\"; if (Test-Path $p) {{ $s=(New-Object -ComObject WScript.Shell).CreateShortcut($p); if ($s.TargetPath) {{ Write-Output $s.TargetPath }} }}",
        escaped
    );

    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let target = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if target.is_empty() {
        None
    } else {
        Some(target)
    }
}

#[cfg(not(target_os = "windows"))]
fn resolve_shortcut_target(_path: &str) -> Option<String> {
    None
}

fn calculate_sha256(input: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[tauri::command]
pub async fn add_clipboard_item_manual(
    app: AppHandle,
    manager: State<'_, Arc<ClipboardManager>>,
    content_type: String,
    content: String,
    source: Option<String>,
    auto_favorite: Option<bool>,
    dedupe_by_hash: Option<bool>,
) -> Result<String, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用目录失败: {}", e))?;

    let metadata = WindowMetadata {
        source_app: source.unwrap_or_else(|| "拖拽".to_string()),
        window_title: "".to_string(),
        source_url: None,
    };

    let mut item = match content_type.as_str() {
        "text" => {
            if content.trim().is_empty() {
                return Err("文本内容为空".to_string());
            }
            ClipboardItem::new_text(content, metadata.clone())
        }
        "file" => {
            let paths = normalize_unique_paths(&content);
            if paths.is_empty() {
                return Err("文件路径为空".to_string());
            }

            let file_names: Vec<String> = paths
                .iter()
                .map(|p| {
                    std::path::Path::new(p)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(p)
                        .to_string()
                })
                .collect();

            let summary = if paths.len() == 1 {
                format!("文件: {}", file_names[0])
            } else {
                format!("{} 个文件: {}", paths.len(), file_names.join(", "))
            };

            let content_paths = paths.join("\n");
            let mut shortcut_targets: Vec<Value> = Vec::new();
            let mut resolved_targets: Vec<String> = Vec::with_capacity(paths.len());

            for path in &paths {
                if is_windows_shortcut(path) {
                    if let Some(target) = resolve_shortcut_target(path) {
                        shortcut_targets.push(json!({
                            "original": path,
                            "target": target,
                        }));
                        resolved_targets.push(target);
                        continue;
                    }
                }
                resolved_targets.push(path.clone());
            }

            let mut item = ClipboardItem::new_text(summary, metadata.clone());
            item.type_ = "file".to_string();
            item.content = Some(content_paths.clone());
            item.content_hash = calculate_sha256(&content_paths);

            if !shortcut_targets.is_empty() {
                let mut metadata_value = serde_json::to_value(&metadata).unwrap_or_else(|_| json!({}));
                metadata_value["shortcut_targets"] = Value::Array(shortcut_targets);
                item.metadata = Some(metadata_value.to_string());
                item.original_content = Some(resolved_targets.join("\n"));
            }

            item
        }
        "image" => {
            let image_data = base64::engine::general_purpose::STANDARD
                .decode(&content)
                .map_err(|e| format!("Base64 解码失败: {}", e))?;

            let image_dir = app_dir.join("images");
            std::fs::create_dir_all(&image_dir)
                .map_err(|e| format!("创建图片目录失败: {}", e))?;

            let timestamp = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| format!("获取时间戳失败: {}", e))?
                .as_millis();
            let filename = format!("{}.png", timestamp);
            let thumb_filename = format!("{}_thumb.png", timestamp);

            let image_path = image_dir.join(&filename);
            let thumb_path = image_dir.join(&thumb_filename);

            std::fs::write(&image_path, &image_data)
                .map_err(|e| format!("保存图片失败: {}", e))?;

            if let Ok(img) = image::load_from_memory(&image_data) {
                let thumbnail = img.thumbnail(300, 300);
                thumbnail
                    .save(&thumb_path)
                    .map_err(|e| format!("保存缩略图失败: {}", e))?;
            } else {
                std::fs::copy(&image_path, &thumb_path)
                    .map_err(|e| format!("复制图片失败: {}", e))?;
            }

            let image_paths_json = json!({
                "original": image_path.to_string_lossy().to_string(),
                "thumbnail": thumb_path.to_string_lossy().to_string(),
            })
            .to_string();

            let mut item = ClipboardItem::new_text(format!("[Image: {}]", filename), metadata.clone());
            item.type_ = "image".to_string();
            item.image_paths = Some(image_paths_json);

            if dedupe_by_hash.unwrap_or(false) {
                item.content_hash = format!("{:x}", md5::compute(&image_data));
            }

            item
        }
        _ => {
            return Err(format!("不支持的内容类型: {}", content_type));
        }
    };

    if auto_favorite.unwrap_or(false) {
        item.is_favorite = true;
    }

    if dedupe_by_hash.unwrap_or(false) {
        if let Some(existing) = manager
            .find_by_hash(&item.content_hash)
            .await
            .map_err(|e| format!("查询重复项失败: {}", e))?
        {
            return Ok(existing.id);
        }
    }

    manager
        .insert_item(&item)
        .await
        .map_err(|e| format!("保存失败: {}", e))?;

    Ok(item.id)
}

#[tauri::command]
pub async fn add_image_file(
    app: AppHandle,
    manager: State<'_, Arc<ClipboardManager>>,
    file_path: String,
    dedupe_by_hash: Option<bool>,
) -> Result<String, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取应用目录失败: {}", e))?;

    let metadata = WindowMetadata {
        source_app: "拖拽".to_string(),
        window_title: "".to_string(),
        source_url: None,
    };

    let image_data = std::fs::read(&file_path).map_err(|e| format!("读取图片文件失败: {}", e))?;

    let image_dir = app_dir.join("images");
    std::fs::create_dir_all(&image_dir).map_err(|e| format!("创建图片目录失败: {}", e))?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("获取时间戳失败: {}", e))?
        .as_millis();
    let filename = format!("{}.png", timestamp);
    let thumb_filename = format!("{}_thumb.png", timestamp);

    let image_path = image_dir.join(&filename);
    let thumb_path = image_dir.join(&thumb_filename);

    std::fs::write(&image_path, &image_data).map_err(|e| format!("保存图片失败: {}", e))?;

    if let Ok(img) = image::load_from_memory(&image_data) {
        let thumbnail = img.thumbnail(300, 300);
        thumbnail
            .save(&thumb_path)
            .map_err(|e| format!("保存缩略图失败: {}", e))?;
    } else {
        std::fs::copy(&image_path, &thumb_path).map_err(|e| format!("复制图片失败: {}", e))?;
    }

    let image_paths_json = json!({
        "original": image_path.to_string_lossy().to_string(),
        "thumbnail": thumb_path.to_string_lossy().to_string(),
    })
    .to_string();

    let mut item = ClipboardItem::new_text(format!("[Image: {}]", filename), metadata);
    item.type_ = "image".to_string();
    item.image_paths = Some(image_paths_json);

    if dedupe_by_hash.unwrap_or(false) {
        item.content_hash = format!("{:x}", md5::compute(&image_data));

        if let Some(existing) = manager
            .find_by_hash(&item.content_hash)
            .await
            .map_err(|e| format!("查询重复项失败: {}", e))?
        {
            return Ok(existing.id);
        }
    }

    manager
        .insert_item(&item)
        .await
        .map_err(|e| format!("保存失败: {}", e))?;

    Ok(item.id)
}
