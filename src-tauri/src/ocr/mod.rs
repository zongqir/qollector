use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use thiserror::Error;

pub mod deepseek;
pub mod local;
pub mod native;
pub mod provider;
pub mod service;
pub mod siliconflow;

pub use service::OcrService;

#[derive(Debug, Error)]
pub enum OcrError {
    #[error("HTTP request failed: {0}")]
    RequestError(#[from] reqwest::Error),
    #[error("API error: {0}")]
    ApiError(String),
    #[error("Invalid configuration: {0}")]
    ConfigError(String),
    #[error("Image processing error: {0}")]
    ImageError(String),
    #[error("OCR engine error: {0}")]
    EngineError(String),
    #[error("IO error: {0}")]
    IoError(#[from] std::io::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum OcrProviderType {
    Native,
    Local,
    SiliconFlow,
    DeepSeek,
    Aliyun,
    Tencent,
    Baidu,
    Custom { name: String, base_url: String },
}

impl OcrProviderType {
    pub fn name(&self) -> &str {
        match self {
            OcrProviderType::Native => "Native OCR",
            OcrProviderType::Local => "本地 Tesseract",
            OcrProviderType::SiliconFlow => "硅基流动 OCR",
            OcrProviderType::DeepSeek => "DeepSeek OCR",
            OcrProviderType::Aliyun => "阿里云 OCR",
            OcrProviderType::Tencent => "腾讯云 OCR",
            OcrProviderType::Baidu => "百度 OCR",
            OcrProviderType::Custom { name, .. } => name,
        }
    }

    pub fn base_url(&self) -> Option<&str> {
        match self {
            OcrProviderType::Native => None,
            OcrProviderType::Local => None,
            OcrProviderType::SiliconFlow => Some("https://api.siliconflow.cn/v1"),
            OcrProviderType::DeepSeek => Some("https://api.deepseek.com/v1"),
            OcrProviderType::Aliyun => Some("https://ocr-api.cn-shanghai.aliyuncs.com"),
            OcrProviderType::Tencent => Some("https://ocr.tencentcloudapi.com"),
            OcrProviderType::Baidu => Some("https://aip.baidubce.com/rest/2.0/ocr/v1"),
            OcrProviderType::Custom { base_url, .. } => Some(base_url),
        }
    }
}

/// OCR 供应商的凭证信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrCredentials {
    pub api_key: Option<String>,
    pub api_secret: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
}

impl OcrCredentials {
    pub fn new(api_key: Option<String>, api_secret: Option<String>, model: Option<String>) -> Self {
        Self {
            api_key,
            api_secret,
            model,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrConfig {
    pub enabled: bool,
    pub current_provider: OcrProviderType,
    pub credentials: HashMap<String, OcrCredentials>, // key 是 provider 的字符串表示
    pub language: String,
    pub auto_ocr: bool,
}

impl OcrConfig {
    /// 获取当前供应商的凭证
    pub fn get_current_credentials(&self) -> Option<&OcrCredentials> {
        self.credentials
            .get(&self.provider_key(&self.current_provider))
    }

    /// 获取当前供应商的 API Key
    pub fn get_current_api_key(&self) -> Option<String> {
        self.get_current_credentials()
            .and_then(|c| c.api_key.clone())
    }

    /// 获取当前供应商的 API Secret
    pub fn get_current_api_secret(&self) -> Option<String> {
        self.get_current_credentials()
            .and_then(|c| c.api_secret.clone())
    }

    /// 获取当前供应商的 Model
    pub fn get_current_model(&self) -> Option<String> {
        self.get_current_credentials()
            .and_then(|c| c.model.clone())
            .filter(|m| !m.trim().is_empty())
    }

    /// 设置当前供应商的凭证
    pub fn set_current_credentials(&mut self, api_key: Option<String>, api_secret: Option<String>, model: Option<String>) {
        let key = self.provider_key(&self.current_provider);
        self.credentials
            .insert(key, OcrCredentials::new(api_key, api_secret, model));
    }

    /// 生成供应商的唯一键
    fn provider_key(&self, provider: &OcrProviderType) -> String {
        match provider {
            OcrProviderType::Native => "native".to_string(),
            OcrProviderType::Local => "local".to_string(),
            OcrProviderType::SiliconFlow => "siliconflow".to_string(),
            OcrProviderType::DeepSeek => "deepseek".to_string(),
            OcrProviderType::Aliyun => "aliyun".to_string(),
            OcrProviderType::Tencent => "tencent".to_string(),
            OcrProviderType::Baidu => "baidu".to_string(),
            OcrProviderType::Custom { name, .. } => format!("custom_{}", name),
        }
    }
}

impl Default for OcrConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            current_provider: OcrProviderType::Native,
            credentials: HashMap::new(),
            language: "chi_sim+eng".to_string(), // 中英文
            auto_ocr: true,
        }
    }
}

// 用于反序列化旧格式配置的临时结构
#[derive(Debug, Deserialize)]
struct LegacyOcrConfig {
    enabled: bool,
    provider: OcrProviderType,
    api_key: Option<String>,
    api_secret: Option<String>,
    language: String,
    auto_ocr: bool,
}

impl OcrConfig {
    /// 从旧格式配置迁移
    pub fn from_legacy(json_str: &str) -> Result<Self, serde_json::Error> {
        // 尝试解析为新格式
        if let Ok(config) = serde_json::from_str::<OcrConfig>(json_str) {
            return Ok(config);
        }

        // 如果失败，尝试解析为旧格式并迁移
        let legacy: LegacyOcrConfig = serde_json::from_str(json_str)?;

        let mut config = OcrConfig {
            enabled: legacy.enabled,
            current_provider: legacy.provider.clone(),
            credentials: HashMap::new(),
            language: legacy.language,
            auto_ocr: legacy.auto_ocr,
        };

        // 将旧的 api_key 和 api_secret 迁移到 credentials
        if legacy.api_key.is_some() || legacy.api_secret.is_some() {
            config.set_current_credentials(legacy.api_key, legacy.api_secret, None);
        }

        Ok(config)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrResult {
    pub text: String,
    pub confidence: Option<f32>,
    pub language: Option<String>,
    pub provider: String,
}

impl OcrResult {
    pub fn new(text: String, provider: String) -> Self {
        Self {
            text,
            confidence: None,
            language: None,
            provider,
        }
    }

    pub fn with_confidence(mut self, confidence: f32) -> Self {
        self.confidence = Some(confidence);
        self
    }

    pub fn with_language(mut self, language: String) -> Self {
        self.language = Some(language);
        self
    }
}

/// 为云端视觉多模态大模型预处理图片（尺寸优化与 Base64 编码）
///
/// 1. 若图片长宽超过 2048px，采用高质量下采样保持文字清晰的同时控制尺寸；
/// 2. 转换为 RGB JPEG 格式降低传输体积，降低服务端排队与解码延迟；
/// 3. 若解析失败或格式异常，优雅降级为原二进制 Base64。
pub fn preprocess_image_for_vlm(image_data: &[u8]) -> String {
    use base64::{engine::general_purpose, Engine as _};
    use image::{DynamicImage, ImageFormat};
    use std::io::Cursor;

    if let Ok(img) = image::load_from_memory(image_data) {
        let (w, h) = (img.width(), img.height());
        // 确保满足部分 VLM 模型的最小尺寸限制（>=28px）
        if w >= 28 && h >= 28 {
            let resized = if w > 2048 || h > 2048 {
                crate::core::thumbnail::generate_thumbnail(&img, 2048)
            } else {
                img
            };

            let rgb_img = DynamicImage::ImageRgb8(resized.to_rgb8());
            let mut buf = Cursor::new(Vec::new());
            if rgb_img.write_to(&mut buf, ImageFormat::Jpeg).is_ok() {
                let bytes = buf.into_inner();
                if !bytes.is_empty() {
                    return general_purpose::STANDARD.encode(&bytes);
                }
            }
        }
    }

    base64::engine::general_purpose::STANDARD.encode(image_data)
}
