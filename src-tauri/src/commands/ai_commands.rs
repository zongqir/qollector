use crate::ai::{AIConfig, AIProvider, AIService};
use crate::core::clipboard_manager::ClipboardManager;
use crate::repository::config_repo::ConfigRepository;
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct AIState {
    pub config: Arc<Mutex<AIConfig>>,
    pub config_repo: Arc<ConfigRepository>,
}

#[tauri::command]
pub async fn get_ai_config(state: State<'_, AIState>) -> Result<AIConfig, String> {
    let config = state.config.lock().unwrap();
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
        let mut current_config = state.config.lock().unwrap();
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
    content: String,
) -> Result<Vec<String>, String> {
    let config = state.config.lock().unwrap().clone();

    // 只要有API key就尝试生成,失败静默返回空数组
    if config.get_current_api_key().is_empty() {
        return Ok(Vec::new());
    }

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
    match service.generate_tags(&content, &language).await {
        Ok(tags) => Ok(tags),
        Err(e) => {
            eprintln!("AI标签生成失败(静默): {}", e);
            Ok(Vec::new()) // 失败时返回空数组而不是错误
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
    match service.generate_tags("测试", &language).await {
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
        "Custom" => AIProvider::Custom {
            name: "自定义".to_string(),
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
        "Custom" => AIProvider::Custom {
            name: "自定义".to_string(),
            base_url: "".to_string(),
        },
        _ => return Err("Unknown provider".to_string()),
    };

    Ok(ai_provider.default_model())
}
