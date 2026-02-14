use crate::config::GeneralConfig;
use crate::repository::config_repo::ConfigRepository;
use tauri::State;
use std::sync::Arc;
use tokio::sync::Mutex as TokioMutex;

#[tauri::command]
pub async fn get_general_config(
    config_repo: State<'_, Arc<TokioMutex<ConfigRepository>>>,
) -> Result<GeneralConfig, String> {
    let repo = config_repo.lock().await;
    let config = repo.load_general_config()
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    Ok(config)
}

#[tauri::command]
pub async fn update_general_config(
    config_repo: State<'_, Arc<TokioMutex<ConfigRepository>>>,
    mut config: GeneralConfig,
) -> Result<(), String> {
    config.validate();
    let repo = config_repo.lock().await;
    repo.save_general_config(&config)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
