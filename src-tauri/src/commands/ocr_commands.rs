use tauri::State;
use std::sync::{Mutex, Arc};
use crate::ocr::{OcrService, OcrConfig};
use crate::core::clipboard_manager::ClipboardManager;
use crate::repository::config_repo::ConfigRepository;

pub struct OcrState {
    pub service: Arc<Mutex<Option<OcrService>>>,
    pub config_repo: Arc<ConfigRepository>,
}

impl OcrState {
    pub fn new(config_repo: Arc<ConfigRepository>) -> Self {
        Self {
            service: Arc::new(Mutex::new(None)),
            config_repo,
        }
    }
}

#[tauri::command]
pub async fn init_ocr_service(
    config: OcrConfig,
    state: State<'_, OcrState>,
    manager: State<'_, Arc<ClipboardManager>>,
) -> Result<String, String> {
    let service = OcrService::new(config.clone())
        .map_err(|e| format!("Failed to initialize OCR service: {}", e))?;

    let provider_name = service.provider_name().to_string();
    *state.service.lock().unwrap() = Some(service.clone());

    // 同步更新 ClipboardManager 中的配置
    manager.update_ocr_service(Some(service));

    // 持久化到数据库
    state.config_repo.save_ocr_config(&config).await
        .map_err(|e| format!("保存配置失败: {}", e))?;

    Ok(format!("OCR service initialized with provider: {}", provider_name))
}

#[tauri::command]
pub async fn get_ocr_config(
    state: State<'_, OcrState>,
) -> Result<OcrConfig, String> {
    println!("获取 OCR 配置");
    let service_guard = state.service.lock().unwrap();
    if let Some(service) = service_guard.as_ref() {
        let config = service.get_config().clone();
        println!("返回已保存的配置: {:?}", config.current_provider);
        println!("  API Key 长度: {}", config.get_current_api_key().map(|k| k.len()).unwrap_or(0));
        Ok(config)
    } else {
        println!("返回默认配置");
        Ok(OcrConfig::default())
    }
}

#[tauri::command]
pub async fn update_ocr_config(
    config: OcrConfig,
    state: State<'_, OcrState>,
    manager: State<'_, Arc<ClipboardManager>>,
) -> Result<String, String> {
    println!("收到 OCR 配置更新请求:");
    println!("  enabled: {}", config.enabled);
    println!("  provider: {:?}", config.current_provider);
    println!("  api_key: {:?}", config.get_current_api_key().map(|k| format!("{}...", &k[..10.min(k.len())])));
    println!("  language: {}", config.language);
    println!("  auto_ocr: {}", config.auto_ocr);

    let service_opt = {
        let mut service_guard = state.service.lock().unwrap();
        service_guard.take()
    };

    if let Some(mut service) = service_opt {
        service.update_config(config.clone())
            .map_err(|e| format!("Failed to update OCR config: {}", e))?;
        *state.service.lock().unwrap() = Some(service.clone());

        // 同步更新 ClipboardManager 中的配置
        manager.update_ocr_service(Some(service));

        // 持久化到数据库
        state.config_repo.save_ocr_config(&config).await
            .map_err(|e| format!("保存配置失败: {}", e))?;

        println!("OCR 配置更新成功");
        Ok("OCR config updated".to_string())
    } else {
        // 如果服务不存在，创建新服务
        println!("OCR 服务不存在，创建新服务");
        init_ocr_service(config, state, manager).await
    }
}

#[tauri::command]
pub async fn recognize_image(
    image_path: String,
    state: State<'_, OcrState>,
) -> Result<String, String> {
    let service_opt = {
        let service_guard = state.service.lock().unwrap();
        service_guard.clone()
    };

    if let Some(service) = service_opt {
        let result = service.recognize(&image_path).await
            .map_err(|e| format!("OCR recognition failed: {}", e))?;
        Ok(result.text)
    } else {
        Err("OCR service not initialized".to_string())
    }
}

#[tauri::command]
pub async fn recognize_and_update(
    item_id: String,
    image_path: String,
    state: State<'_, OcrState>,
    manager: State<'_, Arc<ClipboardManager>>,
) -> Result<String, String> {
    // 执行 OCR 识别
    let service_opt = {
        let service_guard = state.service.lock().unwrap();
        service_guard.clone()
    };

    let ocr_text = if let Some(service) = service_opt {
        let result = service.recognize(&image_path).await
            .map_err(|e| format!("OCR recognition failed: {}", e))?;
        result.text
    } else {
        return Err("OCR service not initialized".to_string());
    };

    // 更新数据库
    manager.update_ocr_text(&item_id, &ocr_text).await
        .map_err(|e| format!("Failed to update OCR text: {}", e))?;

    Ok(ocr_text)
}

#[tauri::command]
pub async fn check_ocr_available(
    state: State<'_, OcrState>,
) -> Result<bool, String> {
    println!("检查 OCR 服务可用性");

    let service_opt = {
        let service_guard = state.service.lock().unwrap();
        service_guard.clone()
    };

    if let Some(service) = service_opt {
        let available = service.is_available().await;
        println!("OCR 服务可用性: {}", available);
        println!("提供商: {}", service.provider_name());
        Ok(available)
    } else {
        println!("OCR 服务未初始化");
        Ok(false)
    }
}

#[tauri::command]
pub async fn get_ocr_providers() -> Result<Vec<String>, String> {
    Ok(vec![
        "本地 Tesseract".to_string(),
        "硅基流动 OCR".to_string(),
        "DeepSeek OCR".to_string(),
        "阿里云 OCR".to_string(),
        "腾讯云 OCR".to_string(),
        "百度 OCR".to_string(),
    ])
}
