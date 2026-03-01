use crate::commands::ai_commands::AIState;
use crate::core::clipboard_manager::ClipboardManager;
use std::sync::Arc;
use tauri::State;
use uuid::Uuid;

const LEGACY_SALT: &str = "qollect_lock_salt_2024";

fn hash_password_legacy(password: &str) -> String {
    let input = format!("{}{}", LEGACY_SALT, password);
    blake3::hash(input.as_bytes()).to_hex().to_string()
}

fn generate_password_salt() -> [u8; 16] {
    *Uuid::new_v4().as_bytes()
}

fn hash_password_v2(password: &str, salt: &[u8; 16]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(salt);
    hasher.update(password.as_bytes());
    hasher.finalize().to_hex().to_string()
}

fn encode_password_hash(password: &str) -> String {
    let salt = generate_password_salt();
    let hash = hash_password_v2(password, &salt);
    format!("v2:{}:{}", hex::encode(salt), hash)
}

fn verify_password_hash(stored_hash: &str, password: &str) -> bool {
    if let Some(rest) = stored_hash.strip_prefix("v2:") {
        let mut parts = rest.splitn(2, ':');
        let salt_hex = parts.next().unwrap_or_default();
        let hash_hex = parts.next().unwrap_or_default();
        if salt_hex.is_empty() || hash_hex.is_empty() {
            return false;
        }
        let salt_vec = match hex::decode(salt_hex) {
            Ok(v) => v,
            Err(_) => return false,
        };
        if salt_vec.len() != 16 {
            return false;
        }
        let mut salt = [0u8; 16];
        salt.copy_from_slice(&salt_vec);
        return hash_password_v2(password, &salt) == hash_hex;
    }

    hash_password_legacy(password) == stored_hash
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
        Some(hash) => Ok(verify_password_hash(&hash, &password)),
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
        if !verify_password_hash(hash, &old_password) {
            return Err("旧密码不正确".to_string());
        }
    }

    // 设置或清除密码
    if new_password.is_empty() {
        config.lock_password_hash = None;
    } else {
        config.lock_password_hash = Some(encode_password_hash(&new_password));
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
