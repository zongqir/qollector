use crate::commands::ai_commands::AIState;
use crate::core::clipboard_manager::ClipboardManager;
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::State;

const SALT: &str = "clipbox_lock_salt_2024";

fn hash_password(password: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(format!("{}{}", SALT, password));
    format!("{:x}", hasher.finalize())
}

#[tauri::command]
pub async fn has_lock_password(ai_state: State<'_, AIState>) -> Result<bool, String> {
    let config = ai_state
        .config_repo
        .load_general_config()
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    Ok(config.lock_password_hash.is_some())
}

#[tauri::command]
pub async fn verify_lock_password(
    ai_state: State<'_, AIState>,
    password: String,
) -> Result<bool, String> {
    let config = ai_state
        .config_repo
        .load_general_config()
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    match config.lock_password_hash {
        Some(hash) => Ok(hash == hash_password(&password)),
        None => Ok(true),
    }
}

#[tauri::command]
pub async fn set_lock_password(
    ai_state: State<'_, AIState>,
    old_password: String,
    new_password: String,
) -> Result<(), String> {
    let mut config = ai_state
        .config_repo
        .load_general_config()
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    // 验证旧密码
    if let Some(ref hash) = config.lock_password_hash {
        if *hash != hash_password(&old_password) {
            return Err("旧密码不正确".to_string());
        }
    }

    // 设置或清除密码
    if new_password.is_empty() {
        config.lock_password_hash = None;
    } else {
        config.lock_password_hash = Some(hash_password(&new_password));
    }

    ai_state
        .config_repo
        .save_general_config(&config)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn reset_all_data(
    ai_state: State<'_, AIState>,
    manager: State<'_, Arc<ClipboardManager>>,
) -> Result<(), String> {
    // 清除密码
    let mut config = ai_state
        .config_repo
        .load_general_config()
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    config.lock_password_hash = None;
    ai_state
        .config_repo
        .save_general_config(&config)
        .await
        .map_err(|e| e.to_string())?;

    // 清空剪贴板数据
    manager.clear_all_items().await.map_err(|e| e.to_string())?;

    Ok(())
}
