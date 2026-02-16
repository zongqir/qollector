use crate::commands::ai_commands::AIState;
use crate::config::GeneralConfig;
use crate::startup_metrics::{StartupMetricsSnapshot, StartupMetricsState};
use std::sync::Arc;
use tauri::State;

#[tauri::command]
pub async fn get_general_config(ai_state: State<'_, AIState>) -> Result<GeneralConfig, String> {
    let config = ai_state
        .config_repo
        .load_general_config()
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
    ai_state
        .config_repo
        .save_general_config(&config)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_startup_metrics(
    startup_metrics: State<'_, Arc<StartupMetricsState>>,
) -> Result<StartupMetricsSnapshot, String> {
    Ok(startup_metrics.snapshot())
}
