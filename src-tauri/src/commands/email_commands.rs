use crate::core::clipboard_manager::ClipboardManager;
use crate::email::{EmailRelayConfig, EmailService};
use crate::repository::config_repo::ConfigRepository;
use parking_lot::Mutex;
use serde::Deserialize;
use std::sync::Arc;
use tauri::State;

pub struct EmailState {
    pub config: Arc<Mutex<EmailRelayConfig>>,
    pub config_repo: Arc<ConfigRepository>,
}

impl EmailState {
    pub fn new(config: Arc<Mutex<EmailRelayConfig>>, config_repo: Arc<ConfigRepository>) -> Self {
        Self { config, config_repo }
    }
}

#[derive(Debug, Deserialize)]
pub struct SendClipboardEmailRequest {
    pub item_id: String,
    #[serde(default)]
    pub recipients: Vec<String>,
    pub custom_subject: Option<String>,
    pub body_note: Option<String>,
}

#[tauri::command]
pub async fn get_email_relay_config(
    state: State<'_, EmailState>,
) -> Result<EmailRelayConfig, String> {
    Ok(state.config.lock().clone())
}

#[tauri::command]
pub async fn update_email_relay_config(
    config: EmailRelayConfig,
    state: State<'_, EmailState>,
) -> Result<(), String> {
    state
        .config_repo
        .save_email_relay_config(&config)
        .await
        .map_err(|e| e.to_string())?;
    *state.config.lock() = config;
    Ok(())
}

#[tauri::command]
pub async fn test_email_relay_connection(
    config: EmailRelayConfig,
    test_recipient: Option<String>,
) -> Result<String, String> {
    EmailService::test_connection(&config, test_recipient).await
}

#[tauri::command]
pub async fn send_clipboard_item_via_email(
    req: SendClipboardEmailRequest,
    state: State<'_, EmailState>,
    manager: State<'_, Arc<ClipboardManager>>,
) -> Result<String, String> {
    let config = state.config.lock().clone();

    if !config.enabled {
        return Err("邮件中继功能当前未启用，请先在设置中启用".to_string());
    }

    let item = manager
        .get_item_by_id(&req.item_id)
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("未找到指定的剪贴板内容: {}", req.item_id))?;

    EmailService::send_item(
        &config,
        &item,
        req.recipients,
        req.custom_subject,
        req.body_note,
    )
    .await
}
