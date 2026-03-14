use parking_lot::Mutex;
use std::sync::Arc;
use tauri::State;

use crate::license::config::{LicenseConfig, LicenseStatus};
use crate::license::{client, validator};
use crate::repository::config_repo::ConfigRepository;

pub struct LicenseState {
    pub config: Arc<Mutex<LicenseConfig>>,
    pub config_repo: Arc<ConfigRepository>,
}

#[tauri::command]
pub async fn get_license_info(state: State<'_, LicenseState>) -> Result<LicenseConfig, String> {
    let config = state.config.lock().clone();
    Ok(config)
}

#[tauri::command]
pub async fn activate_license(
    key: String,
    state: State<'_, LicenseState>,
) -> Result<LicenseConfig, String> {
    let device_id = {
        let config = state.config.lock();
        config.device_id.clone()
    };

    let resp = client::activate(&key, &device_id).await?;

    if !resp.success {
        return Err(resp.message);
    }

    let now = chrono::Utc::now().timestamp();
    let updated = {
        let mut config = state.config.lock();
        config.license_key = Some(key);
        config.status = LicenseStatus::Active;
        config.activated_at = Some(now);
        config.last_verified_at = Some(now);
        config.expires_at = resp.expires_at;
        config.max_devices = resp.max_devices.unwrap_or(3);
        config.activated_devices = resp.activated_devices.unwrap_or(1);
        config.clone()
    };

    // Persist to database
    state
        .config_repo
        .save_license_config(&updated)
        .await
        .map_err(|e| format!("Failed to save license config: {}", e))?;

    Ok(updated)
}

#[tauri::command]
pub async fn deactivate_license(state: State<'_, LicenseState>) -> Result<(), String> {
    let (key, device_id) = {
        let config = state.config.lock();
        match &config.license_key {
            Some(k) => (k.clone(), config.device_id.clone()),
            None => return Err("No license to deactivate".to_string()),
        }
    };

    let resp = client::deactivate(&key, &device_id).await?;

    if !resp.success {
        return Err(resp.message);
    }

    let updated = {
        let mut config = state.config.lock();
        config.license_key = None;
        config.status = LicenseStatus::Free;
        config.activated_at = None;
        config.expires_at = None;
        config.last_verified_at = None;
        config.activated_devices = 0;
        config.clone()
    };

    state
        .config_repo
        .save_license_config(&updated)
        .await
        .map_err(|e| format!("Failed to save license config: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn check_license_valid(state: State<'_, LicenseState>) -> Result<bool, String> {
    let mut config = state.config.lock().clone();
    let result = validator::check_feature_access(&mut config).await;

    // Update stored config if status changed
    let needs_save = {
        let mut stored = state.config.lock();
        if stored.status != config.status || stored.last_verified_at != config.last_verified_at {
            *stored = config.clone();
            true
        } else {
            false
        }
    };

    if needs_save {
        let _ = state.config_repo.save_license_config(&config).await;
    }

    Ok(result.is_ok())
}
