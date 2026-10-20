use crate::core::clipboard_manager::ClipboardManager;
use crate::repository::config_repo::ConfigRepository;
use crate::share::config::ShareConfig;
use crate::share::service::{ShareResult, UploadResponse};
use base64::Engine;
use std::collections::HashMap;
use std::sync::Arc;

pub struct ShareState {
    pub config_repo: Arc<ConfigRepository>,
}

impl ShareState {
    pub fn new(config_repo: Arc<ConfigRepository>) -> Self {
        Self { config_repo }
    }
}

#[tauri::command]
pub async fn get_share_config(state: tauri::State<'_, ShareState>) -> Result<ShareConfig, String> {
    let config = state
        .config_repo
        .load_share_config()
        .await
        .map_err(|e| e.to_string())?;
    Ok(config.unwrap_or_default())
}

#[tauri::command]
pub async fn update_share_config(
    config: ShareConfig,
    state: tauri::State<'_, ShareState>,
) -> Result<String, String> {
    if config.provider == crate::share::ShareProvider::S3 {
        if let Some(ref s3) = config.s3_config {
            s3.validate().map_err(|e| e.to_string())?;
        }
    }
    state
        .config_repo
        .save_share_config(&config)
        .await
        .map_err(|e| e.to_string())?;
    Ok("ok".into())
}

/// Prepare item data for sharing. Returns LocalQr for short text,
/// or NeedUpload with base64 data for the frontend to upload.
#[tauri::command]
pub async fn get_item_share_data(
    item_id: String,
    _state: tauri::State<'_, ShareState>,
    manager: tauri::State<'_, Arc<ClipboardManager>>,
) -> Result<ShareResult, String> {
    let item = manager
        .get_item_by_id(&item_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Item not found: {}", item_id))?;

    let (image_bytes, image_ext) = if item.type_ == "image" {
        if let Some(ref paths_str) = item.image_paths {
            let paths: serde_json::Value =
                serde_json::from_str(paths_str).map_err(|e| e.to_string())?;
            let original = paths
                .get("original")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "No original in image_paths".to_string())?;
            let bytes = tokio::fs::read(original).await.map_err(|e| e.to_string())?;
            let ext = std::path::Path::new(original)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png")
                .to_string();
            (Some(bytes), Some(ext))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    crate::share::service::prepare_share_data(
        &item.type_,
        item.content.as_deref(),
        image_bytes,
        image_ext.as_deref(),
    )
    .map_err(|e| e.to_string())
}

/// Generic multipart upload proxy. Frontend sends provider details,
/// backend just does the HTTP POST and returns raw response.
#[tauri::command]
pub async fn upload_to_free_host(
    url: String,
    file_field: String,
    file_data_base64: String,
    filename: String,
    extra_fields: HashMap<String, String>,
) -> Result<UploadResponse, String> {
    let file_data = base64::engine::general_purpose::STANDARD
        .decode(&file_data_base64)
        .map_err(|e| format!("Invalid base64: {}", e))?;

    crate::share::service::upload_to_free_host(
        &url,
        &file_field,
        file_data,
        &filename,
        extra_fields,
    )
    .await
    .map_err(|e| e.to_string())
}

/// Generate a QR code from arbitrary text. Returns base64 PNG data URL.
#[tauri::command]
pub fn generate_qr(text: String) -> Result<String, String> {
    crate::share::qr_generator::generate_qr_base64(&text).map_err(|e| e.to_string())
}

/// S3 one-shot: read item, upload to S3, generate QR, return result.
#[tauri::command]
pub async fn share_via_s3(
    item_id: String,
    state: tauri::State<'_, ShareState>,
    manager: tauri::State<'_, Arc<ClipboardManager>>,
) -> Result<ShareResult, String> {
    let item = manager
        .get_item_by_id(&item_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Item not found: {}", item_id))?;

    let config = state
        .config_repo
        .load_share_config()
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    let s3_config = config
        .s3_config
        .as_ref()
        .ok_or_else(|| "S3 config required".to_string())?;

    let (image_bytes, image_ext) = if item.type_ == "image" {
        if let Some(ref paths_str) = item.image_paths {
            let paths: serde_json::Value =
                serde_json::from_str(paths_str).map_err(|e| e.to_string())?;
            let original = paths
                .get("original")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "No original in image_paths".to_string())?;
            let bytes = tokio::fs::read(original).await.map_err(|e| e.to_string())?;
            let ext = std::path::Path::new(original)
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or("png")
                .to_string();
            (Some(bytes), Some(ext))
        } else {
            (None, None)
        }
    } else {
        (None, None)
    };

    crate::share::service::share_via_s3(
        &item.type_,
        item.content.as_deref(),
        image_bytes,
        image_ext.as_deref(),
        s3_config,
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_share_s3_connection(
    config: crate::share::config::S3Config,
) -> Result<String, String> {
    crate::share::s3_uploader::test_s3_connection(&config)
        .await
        .map_err(|e| e.to_string())?;
    Ok("ok".into())
}
