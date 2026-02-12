use crate::ai::{AIConfig, AIService};
use tauri::State;
use std::sync::{Arc, Mutex};

pub struct AIState {
    pub config: Arc<Mutex<AIConfig>>,
}

#[tauri::command]
pub async fn get_ai_config(state: State<'_, AIState>) -> Result<AIConfig, String> {
    let config = state.config.lock().unwrap();
    Ok(config.clone())
}

#[tauri::command]
pub async fn update_ai_config(
    state: State<'_, AIState>,
    config: AIConfig,
) -> Result<(), String> {
    let mut current_config = state.config.lock().unwrap();
    *current_config = config;
    Ok(())
}

#[tauri::command]
pub async fn generate_ai_tags(
    state: State<'_, AIState>,
    content: String,
) -> Result<Vec<String>, String> {
    let config = state.config.lock().unwrap().clone();

    if !config.enabled {
        return Ok(Vec::new());
    }

    let service = AIService::new(config);
    service
        .generate_tags(&content)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn test_ai_connection(config: AIConfig) -> Result<bool, String> {
    let service = AIService::new(config);
    match service.generate_tags("测试").await {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}
