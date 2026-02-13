use serde::{Deserialize, Serialize};
use thiserror::Error;

pub mod provider;
pub mod local;
pub mod deepseek;
pub mod siliconflow;
pub mod service;

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OcrConfig {
    pub enabled: bool,
    pub provider: OcrProviderType,
    pub api_key: Option<String>,
    pub api_secret: Option<String>,
    pub language: String,
    pub auto_ocr: bool,
}

impl Default for OcrConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            provider: OcrProviderType::SiliconFlow,
            // 内置硅基流动 API Key（临时测试用）
            api_key: Some("sk-huvjsuypfcuzqzolhjmccmjfcwzotwxqojwcvdwpxlyohqrp".to_string()),
            api_secret: None,
            language: "chi_sim+eng".to_string(), // 中英文
            auto_ocr: true,
        }
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
