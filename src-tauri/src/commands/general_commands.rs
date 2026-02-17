use crate::commands::ai_commands::AIState;
use crate::config::GeneralConfig;
use crate::shortcuts::{apply_shortcut_config, ShortcutBindingState};
use crate::startup_metrics::{StartupMetricsSnapshot, StartupMetricsState};
use std::sync::Arc;
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

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
    app: AppHandle,
    ai_state: State<'_, AIState>,
    shortcut_state: State<'_, Arc<ShortcutBindingState>>,
    mut config: GeneralConfig,
) -> Result<(), String> {
    config.validate();
    let previous_config = ai_state
        .config_repo
        .load_general_config()
        .await
        .map_err(|e| e.to_string())?
        .unwrap_or_default();

    apply_shortcut_config(&app, shortcut_state.inner(), &config)?;

    if let Err(error) = ai_state.config_repo.save_general_config(&config).await {
        let _ = apply_shortcut_config(&app, shortcut_state.inner(), &previous_config);
        return Err(error.to_string());
    }

    // Update tray menu language if it changed
    if config.language != previous_config.language {
        crate::tray::update_tray_language(&app, &config.language);
    }

    // Update autostart if it changed
    if config.autostart_enabled != previous_config.autostart_enabled {
        if let Err(e) = update_autostart_state(&app, config.autostart_enabled) {
            eprintln!("[Autostart] Failed to update autostart state: {}", e);
        }
    }

    Ok(())
}

fn update_autostart_state(app: &AppHandle, enabled: bool) -> Result<(), String> {
    let autostart_manager = app.autolaunch();

    if enabled {
        if !autostart_manager.is_enabled().map_err(|e: tauri_plugin_autostart::Error| e.to_string())? {
            autostart_manager.enable().map_err(|e: tauri_plugin_autostart::Error| e.to_string())?;
            println!("[Autostart] Enabled");
        }
    } else {
        if autostart_manager.is_enabled().map_err(|e: tauri_plugin_autostart::Error| e.to_string())? {
            autostart_manager.disable().map_err(|e: tauri_plugin_autostart::Error| e.to_string())?;
            println!("[Autostart] Disabled");
        }
    }

    Ok(())
}

#[tauri::command]
pub fn get_startup_metrics(
    startup_metrics: State<'_, Arc<StartupMetricsState>>,
) -> Result<StartupMetricsSnapshot, String> {
    Ok(startup_metrics.snapshot())
}
