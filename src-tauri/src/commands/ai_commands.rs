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

    // 只要有API key就尝试生成,失败静默返回空数组
    if config.api_key.is_empty() {
        return Ok(Vec::new());
    }

    let service = AIService::new(config);
    match service.generate_tags(&content).await {
        Ok(tags) => Ok(tags),
        Err(e) => {
            eprintln!("AI标签生成失败(静默): {}", e);
            Ok(Vec::new()) // 失败时返回空数组而不是错误
        }
    }
}

#[tauri::command]
pub async fn test_ai_connection(config: AIConfig) -> Result<bool, String> {
    let service = AIService::new(config);
    match service.generate_tags("测试").await {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}
