use crate::core::models::{ClipboardItem, WindowMetadata};
use crate::core::clipboard_manager::ClipboardManager;
use tauri::{State, AppHandle, Manager};
use std::sync::Arc;
use std::path::PathBuf;
use base64::Engine;

/// 手动添加剪贴板项（用于拖拽功能）
#[tauri::command]
pub async fn add_clipboard_item_manual(
    app: AppHandle,
    manager: State<'_, Arc<ClipboardManager>>,
    content_type: String,
    content: String,
) -> Result<String, String> {
    println!("手动添加剪贴板项: type={}, content_len={}", content_type, content.len());

    let app_dir = app.path().app_data_dir()
        .map_err(|e| format!("获取应用目录失败: {}", e))?;

    let metadata = WindowMetadata {
        source_app: "拖拽".to_string(),
        window_title: "".to_string(),
        source_url: None,
    };

    let item = match content_type.as_str() {
        "text" => {
            if content.trim().is_empty() {
                return Err("文本内容为空".to_string());
            }
            ClipboardItem::new_text(content, metadata)
        }
        "file" => {
            // 文件路径列表（换行符分隔）
            let paths: Vec<&str> = content.lines().collect();
            let file_count = paths.len();

            let file_names: Vec<String> = paths.iter()
                .map(|p| {
                    std::path::Path::new(p)
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(p)
                        .to_string()
                })
                .collect();

            let summary = if file_count == 1 {
                format!("文件: {}", file_names[0])
            } else {
                format!("{} 个文件: {}", file_count, file_names.join(", "))
            };

            let mut item = ClipboardItem::new_text(summary, metadata);
            item.type_ = "file".to_string();
            item.content = Some(content);
            item
        }
        "image" => {
            // content 是 base64 编码的图片数据
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

            // 保存原图
            std::fs::write(&image_path, &image_data)
                .map_err(|e| format!("保存图片失败: {}", e))?;

            // 生成缩略图
            if let Ok(img) = image::load_from_memory(&image_data) {
                let thumbnail = img.thumbnail(300, 300);
                thumbnail.save(&thumb_path)
                    .map_err(|e| format!("保存缩略图失败: {}", e))?;
            } else {
                std::fs::copy(&image_path, &thumb_path)
                    .map_err(|e| format!("复制图片失败: {}", e))?;
            }

            let image_paths_json = serde_json::json!({
                "original": image_path.to_string_lossy().to_string(),
                "thumbnail": thumb_path.to_string_lossy().to_string()
            }).to_string();

            let mut item = ClipboardItem::new_text(
                format!("[Image: {}]", filename),
                metadata
            );
            item.type_ = "image".to_string();
            item.image_paths = Some(image_paths_json);
            item
        }
        _ => {
            return Err(format!("不支持的内容类型: {}", content_type));
        }
    };

    // 保存到数据库
    manager.insert_item(&item)
        .await
        .map_err(|e| format!("保存失败: {}", e))?;

    println!("剪贴板项添加成功: {}", item.id);
    Ok(item.id)
}

/// 直接从文件路径添加图片（用于拖拽图片文件）
#[tauri::command]
pub async fn add_image_file(
    app: AppHandle,
    manager: State<'_, Arc<ClipboardManager>>,
    file_path: String,
) -> Result<String, String> {
    println!("添加图片文件: {}", file_path);

    let app_dir = app.path().app_data_dir()
        .map_err(|e| format!("获取应用目录失败: {}", e))?;

    let metadata = WindowMetadata {
        source_app: "拖拽".to_string(),
        window_title: "".to_string(),
        source_url: None,
    };

    // 读取图片文件
    let image_data = std::fs::read(&file_path)
        .map_err(|e| format!("读取图片文件失败: {}", e))?;

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

    // 保存原图
    std::fs::write(&image_path, &image_data)
        .map_err(|e| format!("保存图片失败: {}", e))?;

    // 生成缩略图
    if let Ok(img) = image::load_from_memory(&image_data) {
        let thumbnail = img.thumbnail(300, 300);
        thumbnail.save(&thumb_path)
            .map_err(|e| format!("保存缩略图失败: {}", e))?;
    } else {
        std::fs::copy(&image_path, &thumb_path)
            .map_err(|e| format!("复制图片失败: {}", e))?;
    }

    let image_paths_json = serde_json::json!({
        "original": image_path.to_string_lossy().to_string(),
        "thumbnail": thumb_path.to_string_lossy().to_string()
    }).to_string();

    let mut item = ClipboardItem::new_text(
        format!("[Image: {}]", filename),
        metadata
    );
    item.type_ = "image".to_string();
    item.image_paths = Some(image_paths_json);

    // 保存到数据库
    manager.insert_item(&item)
        .await
        .map_err(|e| format!("保存失败: {}", e))?;

    println!("图片文件添加成功: {}", item.id);
    Ok(item.id)
}
