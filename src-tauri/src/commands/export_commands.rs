use crate::core::clipboard_manager::ClipboardManager;
use crate::core::models::ClipboardItem;
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read, Write};
use std::sync::Arc;
use tauri::State;

const MAGIC: &[u8; 8] = b"CLIPBOX\0";

#[derive(Serialize, Deserialize)]
struct ExportData {
    version: u32,
    exported_at: String,
    app_version: String,
    items: Vec<ExportItem>,
}

#[derive(Serialize, Deserialize)]
struct ExportItem {
    id: String,
    #[serde(rename = "type")]
    type_: String,
    content: Option<String>,
    content_hash: String,
    image_paths: Option<String>,
    ocr_text: Option<String>,
    tags: Option<String>,
    user_note: Option<String>,
    metadata: Option<String>,
    is_pinned: bool,
    is_favorite: bool,
    created_at: i64,
    updated_at: i64,
    #[serde(default)]
    raw_formats: Option<Vec<ExportRawFormat>>,
}

#[derive(Serialize, Deserialize)]
struct ExportRawFormat {
    mime_type: String,
    data: String, // base64-encoded (already zstd-compressed in DB, but decompressed here)
}

#[derive(Serialize)]
pub struct ImportResult {
    pub total: usize,
    pub imported: usize,
    pub skipped: usize,
}

impl From<&ClipboardItem> for ExportItem {
    fn from(item: &ClipboardItem) -> Self {
        Self {
            id: item.id.clone(),
            type_: item.type_.clone(),
            content: item.content.clone(),
            content_hash: item.content_hash.clone(),
            image_paths: item.image_paths.clone(),
            ocr_text: item.ocr_text.clone(),
            tags: item.tags.clone(),
            user_note: item.user_note.clone(),
            metadata: item.metadata.clone(),
            is_pinned: item.is_pinned,
            is_favorite: item.is_favorite,
            created_at: item.created_at,
            updated_at: item.updated_at,
            raw_formats: None,
        }
    }
}

fn encrypt_data(data: &[u8], password: &str) -> Result<Vec<u8>, String> {
    use aes_gcm::aead::rand_core::RngCore;
    use aes_gcm::aead::OsRng;
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};
    use sha2::{Digest, Sha256};

    // 从密码派生 256-bit 密钥
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let key_bytes = hasher.finalize();

    let cipher =
        Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| format!("加密初始化失败: {}", e))?;

    // 生成随机 96-bit nonce
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = aes_gcm::Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, data)
        .map_err(|e| format!("加密失败: {}", e))?;

    // 输出: MAGIC(8) + nonce(12) + ciphertext
    let mut output = Vec::with_capacity(8 + 12 + ciphertext.len());
    output.extend_from_slice(MAGIC);
    output.extend_from_slice(&nonce_bytes);
    output.extend_from_slice(&ciphertext);
    Ok(output)
}

fn decrypt_data(data: &[u8], password: &str) -> Result<Vec<u8>, String> {
    use aes_gcm::{aead::Aead, Aes256Gcm, KeyInit};
    use sha2::{Digest, Sha256};

    if data.len() < 20 || &data[..8] != MAGIC {
        return Err("不是有效的 ClipBox 加密文件".to_string());
    }

    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let key_bytes = hasher.finalize();

    let cipher =
        Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| format!("解密初始化失败: {}", e))?;

    let nonce = aes_gcm::Nonce::from_slice(&data[8..20]);
    let ciphertext = &data[20..];

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "解密失败，密码可能不正确".to_string())
}

fn is_encrypted(data: &[u8]) -> bool {
    data.len() >= 8 && &data[..8] == MAGIC
}

#[tauri::command]
pub async fn export_data(
    manager: State<'_, Arc<ClipboardManager>>,
    include_images: bool,
    password: Option<String>,
) -> Result<String, String> {
    // 弹出保存对话框
    let default_ext = if password.is_some() { "clipbox" } else { "zip" };
    let filter_name = if password.is_some() {
        "ClipBox Encrypted"
    } else {
        "ZIP Archive"
    };

    let save_path = rfd::FileDialog::new()
        .set_file_name(&format!("clipbox_export.{}", default_ext))
        .add_filter(filter_name, &[default_ext])
        .save_file()
        .ok_or_else(|| "CANCELLED".to_string())?;

    // 查询所有未删除条目
    let items = manager
        .get_all_items()
        .await
        .map_err(|e| format!("查询数据失败: {}", e))?;

    let mut zip_buf = Vec::new();
    {
        let cursor = Cursor::new(&mut zip_buf);
        let mut zip = zip::ZipWriter::new(cursor);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        // 构建导出条目，处理图片路径
        let mut export_items: Vec<ExportItem> = Vec::new();
        for item in &items {
            let mut ei = ExportItem::from(item);

            if include_images && item.type_ == "image" {
                if let Some(ref paths_str) = item.image_paths {
                    if let Ok(paths) = serde_json::from_str::<serde_json::Value>(paths_str) {
                        let original = paths["original"].as_str().unwrap_or("");
                        if !original.is_empty() {
                            if let Ok(img_data) = std::fs::read(original) {
                                let filename = std::path::Path::new(original)
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .unwrap_or("unknown.png");
                                let zip_path = format!("images/{}", filename);
                                let _ = zip.start_file(&zip_path, options);
                                let _ = zip.write_all(&img_data);

                                // 更新路径为相对路径
                                let mut new_paths = paths.clone();
                                new_paths["original"] = serde_json::Value::String(zip_path.clone());

                                // 缩略图也处理
                                if let Some(thumb) = paths["thumbnail"].as_str() {
                                    if !thumb.is_empty() {
                                        if let Ok(thumb_data) = std::fs::read(thumb) {
                                            let thumb_name = std::path::Path::new(thumb)
                                                .file_name()
                                                .and_then(|n| n.to_str())
                                                .unwrap_or("unknown_thumb.png");
                                            let thumb_zip = format!("images/{}", thumb_name);
                                            let _ = zip.start_file(&thumb_zip, options);
                                            let _ = zip.write_all(&thumb_data);
                                            new_paths["thumbnail"] =
                                                serde_json::Value::String(thumb_zip);
                                        }
                                    }
                                }
                                ei.image_paths = Some(new_paths.to_string());
                            }
                        }
                    }
                }
            } else if !include_images && item.type_ == "image" {
                // 不含图片时清空路径
                ei.image_paths = None;
            }

            export_items.push(ei);
        }

        // Query raw formats for text/link items
        for (idx, item) in items.iter().enumerate() {
            if item.type_ == "text" || item.type_ == "link" {
                if let Ok(formats) = manager.get_raw_formats(&item.id).await {
                    if !formats.is_empty() {
                        let b64 = base64::engine::general_purpose::STANDARD;
                        export_items[idx].raw_formats = Some(
                            formats
                                .into_iter()
                                .map(|(mime_type, data)| ExportRawFormat {
                                    mime_type,
                                    data: b64.encode(&data),
                                })
                                .collect(),
                        );
                    }
                }
            }
        }

        let export_data = ExportData {
            version: 2,
            exported_at: chrono::Utc::now().to_rfc3339(),
            app_version: "0.1.0".to_string(),
            items: export_items,
        };

        let json =
            serde_json::to_string_pretty(&export_data).map_err(|e| format!("序列化失败: {}", e))?;

        zip.start_file("data.json", options)
            .map_err(|e| format!("创建 zip 条目失败: {}", e))?;
        zip.write_all(json.as_bytes())
            .map_err(|e| format!("写入 zip 失败: {}", e))?;

        zip.finish().map_err(|e| format!("完成 zip 失败: {}", e))?;
    }

    // 加密或直接写入
    let final_data = if let Some(ref pwd) = password {
        encrypt_data(&zip_buf, pwd)?
    } else {
        zip_buf
    };

    std::fs::write(&save_path, &final_data).map_err(|e| format!("写入文件失败: {}", e))?;

    Ok(save_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn import_data(
    manager: State<'_, Arc<ClipboardManager>>,
    password: Option<String>,
    file_path: Option<String>,
) -> Result<ImportResult, String> {
    // 如果提供了路径（重试时），直接使用；否则弹出文件选择对话框
    let file_path = if let Some(p) = file_path {
        std::path::PathBuf::from(p)
    } else {
        rfd::FileDialog::new()
            .add_filter("ClipBox Files", &["zip", "clipbox"])
            .pick_file()
            .ok_or_else(|| "CANCELLED".to_string())?
    };

    let raw_data = std::fs::read(&file_path).map_err(|e| format!("读取文件失败: {}", e))?;

    // 检测是否加密
    let zip_data = if is_encrypted(&raw_data) {
        let pwd = password
            .as_deref()
            .ok_or_else(|| format!("ENCRYPTED:{}", file_path.to_string_lossy()))?;
        decrypt_data(&raw_data, pwd)?
    } else {
        raw_data
    };

    // 解压 zip
    let cursor = Cursor::new(&zip_data);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("解压失败: {}", e))?;

    // 读取 data.json
    let export_data: ExportData = {
        let mut json_file = archive
            .by_name("data.json")
            .map_err(|_| "zip 中未找到 data.json".to_string())?;
        let mut json_str = String::new();
        json_file
            .read_to_string(&mut json_str)
            .map_err(|e| format!("读取 data.json 失败: {}", e))?;
        serde_json::from_str(&json_str).map_err(|e| format!("解析 data.json 失败: {}", e))?
    };

    let image_dir = manager.image_dir().to_path_buf();
    std::fs::create_dir_all(&image_dir).ok();

    // 先提取所有图片文件到 image_dir
    let mut extracted_images: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("读取 zip 条目失败: {}", e))?;
        let name = entry.name().to_string();
        if name.starts_with("images/") && name.len() > 7 {
            let filename = &name[7..]; // 去掉 "images/" 前缀
            let dest = image_dir.join(filename);
            let mut buf = Vec::new();
            entry
                .read_to_end(&mut buf)
                .map_err(|e| format!("读取图片失败: {}", e))?;
            std::fs::write(&dest, &buf).map_err(|e| format!("写入图片失败: {}", e))?;
            extracted_images.insert(name, dest.to_string_lossy().to_string());
        }
    }

    let total = export_data.items.len();
    let mut imported = 0usize;
    let mut skipped = 0usize;

    for ei in &export_data.items {
        // 构建 ClipboardItem
        let mut image_paths = ei.image_paths.clone();

        // 更新图片路径为新的绝对路径
        if let Some(ref paths_str) = image_paths {
            if let Ok(mut paths) = serde_json::from_str::<serde_json::Value>(paths_str) {
                let mut changed = false;
                if let Some(orig) = paths["original"].as_str() {
                    if let Some(new_path) = extracted_images.get(orig) {
                        paths["original"] = serde_json::Value::String(new_path.clone());
                        changed = true;
                    }
                }
                if let Some(thumb) = paths["thumbnail"].as_str() {
                    if let Some(new_path) = extracted_images.get(thumb) {
                        paths["thumbnail"] = serde_json::Value::String(new_path.clone());
                        changed = true;
                    }
                }
                if changed {
                    image_paths = Some(paths.to_string());
                }
            }
        }

        let item = ClipboardItem {
            id: uuid::Uuid::new_v4().to_string(), // 生成新 ID 避免冲突
            type_: ei.type_.clone(),
            content: ei.content.clone(),
            original_content: ei.content.clone(),
            content_hash: ei.content_hash.clone(),
            image_paths,
            ocr_text: ei.ocr_text.clone(),
            code_language: None,
            embedding: None,
            tags: ei.tags.clone(),
            user_note: ei.user_note.clone(),
            metadata: ei.metadata.clone(),
            is_pinned: ei.is_pinned,
            is_favorite: ei.is_favorite,
            is_deleted: false,
            pinned_at: None,
            created_at: ei.created_at,
            updated_at: ei.updated_at,
            has_raw_formats: false,
        };

        match manager.insert_item_if_not_exists(&item).await {
            Ok(true) => {
                imported += 1;
                // Import raw formats if present
                if let Some(ref raw_fmts) = ei.raw_formats {
                    let b64 = base64::engine::general_purpose::STANDARD;
                    let formats: Vec<(String, Vec<u8>)> = raw_fmts
                        .iter()
                        .filter_map(|rf| {
                            b64.decode(&rf.data)
                                .ok()
                                .map(|data| (rf.mime_type.clone(), data))
                        })
                        .collect();
                    if !formats.is_empty() {
                        let _ = manager.insert_raw_formats(&item.id, &formats).await;
                    }
                }
            }
            Ok(false) => skipped += 1,
            Err(e) => {
                eprintln!("导入条目失败: {}", e);
                skipped += 1;
            }
        }
    }

    Ok(ImportResult {
        total,
        imported,
        skipped,
    })
}

#[tauri::command]
pub async fn clear_all_data(
    manager: State<'_, Arc<ClipboardManager>>,
) -> Result<(), String> {
    manager
        .clear_all_data()
        .await
        .map_err(|e| format!("clear all data failed: {}", e))
}
