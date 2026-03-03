use crate::ai::{AIConfig, AIProvider, AIService};
use crate::commands::license_commands::LicenseState;
use crate::core::clipboard_manager::ClipboardManager;
use crate::repository::config_repo::ConfigRepository;
use std::sync::Arc;
use parking_lot::Mutex;
use tauri::State;

pub struct AIState {
    pub config: Arc<Mutex<AIConfig>>,
    pub config_repo: Arc<ConfigRepository>,
}

#[tauri::command]
pub async fn get_ai_config(state: State<'_, AIState>) -> Result<AIConfig, String> {
    let config = state.config.lock();
    Ok(config.clone())
}

#[tauri::command]
pub async fn update_ai_config(
    state: State<'_, AIState>,
    manager: State<'_, Arc<ClipboardManager>>,
    config: AIConfig,
) -> Result<(), String> {
    // 更新内存中的配置
    {
        let mut current_config = state.config.lock();
        *current_config = config.clone();
    }

    // 同步更新 ClipboardManager 中的配置
    manager.update_ai_config(config.clone());

    // 持久化到数据库
    state
        .config_repo
        .save_ai_config(&config)
        .await
        .map_err(|e| format!("保存配置失败: {}", e))?;

    Ok(())
}

#[tauri::command]
pub async fn generate_ai_tags(
    state: State<'_, AIState>,
    _license_state: State<'_, LicenseState>,
    content: String,
) -> Result<(Vec<String>, Option<String>, Option<String>), String> {
    // License gate - temporarily disabled for beta
    // {
    //     let license = license_state.config.lock();
    //     if license.status != LicenseStatus::Active {
    //         return Err("PRO_REQUIRED".to_string());
    //     }
    // }

    let config = state.config.lock().clone();

    if !config.enabled || config.get_current_api_key().is_empty() {
        return Ok((Vec::new(), None, None));
    }

    let language = state
        .config_repo
        .load_general_config()
        .await
        .ok()
        .flatten()
        .map(|c| c.language)
        .unwrap_or_else(|| "zh-CN".to_string());

    let service = AIService::new(config);
    match service.generate_tags(&content, &language).await {
        Ok(result) => Ok(result),
        Err(e) => {
            eprintln!("AI tag generation failed (silent): {}", e);
            Ok((Vec::new(), None, None))
        }
    }
}

#[tauri::command]
pub async fn test_ai_connection(
    state: State<'_, AIState>,
    config: AIConfig,
) -> Result<bool, String> {
    // 获取当前语言配置
    let language = state
        .config_repo
        .load_general_config()
        .await
        .ok()
        .flatten()
        .map(|c| c.language)
        .unwrap_or_else(|| "zh-CN".to_string());

    let service = AIService::new(config);
    match service.generate_tags("test", &language).await {
        Ok(_) => Ok(true),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn get_ai_models(provider: String) -> Result<Vec<String>, String> {
    let ai_provider = match provider.as_str() {
        "SiliconFlow" => AIProvider::SiliconFlow,
        "Volcano" => AIProvider::Volcano,
        "Alibaba" => AIProvider::Alibaba,
        "OpenAI" => AIProvider::OpenAI,
        "Gemini" => AIProvider::Gemini,
        "Custom" => AIProvider::Custom {
            name: "Custom".to_string(),
            base_url: "".to_string(),
        },
        _ => return Err("Unknown provider".to_string()),
    };

    Ok(ai_provider.available_models())
}

#[tauri::command]
pub fn get_default_ai_model(provider: String) -> Result<String, String> {
    let ai_provider = match provider.as_str() {
        "SiliconFlow" => AIProvider::SiliconFlow,
        "Volcano" => AIProvider::Volcano,
        "Alibaba" => AIProvider::Alibaba,
        "OpenAI" => AIProvider::OpenAI,
        "Gemini" => AIProvider::Gemini,
        "Custom" => AIProvider::Custom {
            name: "Custom".to_string(),
            base_url: "".to_string(),
        },
        _ => return Err("Unknown provider".to_string()),
    };

    Ok(ai_provider.default_model())
}

#[tauri::command]
pub async fn fetch_remote_models(base_url: String, api_key: String) -> Result<Vec<String>, String> {
    crate::ai::fetch_models(&base_url, &api_key)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn generate_timeline_summary(
    state: State<'_, AIState>,
    _license_state: State<'_, LicenseState>,
    items: Vec<crate::core::models::ClipboardItem>,
) -> Result<String, String> {
    // License gate - temporarily disabled for beta
    // {
    //     let license = license_state.config.lock();
    //     if license.status != LicenseStatus::Active {
    //         return Err("PRO_REQUIRED".to_string());
    //     }
    // }

    let config = state.config.lock().clone();

    if !config.enabled {
        return Err("AI feature is disabled".to_string());
    }

    if config.get_current_api_key().is_empty() {
        return Err("AI not configured".to_string());
    }

    let language = state
        .config_repo
        .load_general_config()
        .await
        .ok()
        .flatten()
        .map(|c| c.language)
        .unwrap_or_else(|| "zh-CN".to_string());

    let service = AIService::new(config);
    service
        .generate_timeline_summary(&items, &language)
        .await
        .map_err(|e| e.to_string())
}
