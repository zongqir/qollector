use crate::config::GeneralConfig;
use crate::repository::config_repo::ConfigRepository;
use crate::commands::ai_commands::AIState;
use tauri::State;

#[tauri::command]
pub async fn get_general_config(
    ai_state: State<'_, AIState>,
) -> Result<GeneralConfig, String> {
    let config = ai_state.config_repo.load_general_config()
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();
    Ok(config)
}

#[tauri::command]
pub async fn update_general_config(
    ai_state: State<'_, AIState>,
    mut config: GeneralConfig,
) -> Result<(), String> {
    config.validate();
    ai_state.config_repo.save_general_config(&config)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}
