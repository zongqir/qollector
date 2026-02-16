use crate::core::clipboard_manager::ClipboardManager;
use crate::repository::config_repo::ConfigRepository;
use crate::share::config::ShareConfig;
use crate::share::service::{ShareResult, ShareService};
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
pub async fn get_share_config(
    state: tauri::State<'_, ShareState>,
) -> Result<ShareConfig, String> {
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

#[tauri::command]
pub async fn share_clipboard_item(
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

    let service = ShareService::new(config);
    service
        .share_content(
            &item.type_,
            item.content.as_deref(),
            item.image_paths.as_deref(),
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
