use super::deepseek::DeepSeekOcr;
use super::local::LocalOcr;
use super::siliconflow::SiliconFlowOcr;
use super::{provider::OcrProvider, OcrConfig, OcrError, OcrProviderType, OcrResult};
use std::sync::Arc;

/// OCR 服务统一入口
///
/// 根据配置自动选择合适的 OCR 提供者
#[derive(Clone)]
pub struct OcrService {
    config: OcrConfig,
    provider: Arc<dyn OcrProvider>,
}

impl OcrService {
    /// 创建 OCR 服务实例
    pub fn new(config: OcrConfig) -> Result<Self, OcrError> {
        let provider = Self::create_provider(&config)?;
        Ok(Self { config, provider })
    }

    /// 根据配置创建对应的 OCR 提供者
    fn create_provider(config: &OcrConfig) -> Result<Arc<dyn OcrProvider>, OcrError> {
        match &config.current_provider {
            OcrProviderType::Local => Ok(Arc::new(LocalOcr::new(config.language.clone()))),
            OcrProviderType::SiliconFlow => {
                let api_key = config.get_current_api_key().ok_or_else(|| {
                    OcrError::ConfigError("硅基流动 API key is required".to_string())
                })?;

                Ok(Arc::new(SiliconFlowOcr::new(
                    api_key,
                    config.current_provider.base_url().map(|s| s.to_string()),
                )))
            }
            OcrProviderType::DeepSeek => {
                let api_key = config.get_current_api_key().ok_or_else(|| {
                    OcrError::ConfigError("DeepSeek API key is required".to_string())
                })?;

                Ok(Arc::new(DeepSeekOcr::new(
                    api_key,
                    config.current_provider.base_url().map(|s| s.to_string()),
                )))
            }
            OcrProviderType::Aliyun => {
                // TODO: 实现阿里云 OCR
                Err(OcrError::ConfigError("阿里云 OCR 尚未实现".to_string()))
            }
            OcrProviderType::Tencent => {
                // TODO: 实现腾讯云 OCR
                Err(OcrError::ConfigError("腾讯云 OCR 尚未实现".to_string()))
            }
            OcrProviderType::Baidu => {
                // TODO: 实现百度 OCR
                Err(OcrError::ConfigError("百度 OCR 尚未实现".to_string()))
            }
            OcrProviderType::Custom { name, base_url: _ } => {
                // TODO: 实现自定义 OCR
                Err(OcrError::ConfigError(format!(
                    "自定义 OCR ({}) 尚未实现",
                    name
                )))
            }
        }
    }

    /// 识别图片中的文字
    pub async fn recognize(&self, image_path: &str) -> Result<OcrResult, OcrError> {
        if !self.config.enabled {
            return Err(OcrError::ConfigError("OCR is disabled".to_string()));
        }

        if !self.provider.is_available().await {
            return Err(OcrError::ConfigError(format!(
                "OCR provider '{}' is not available",
                self.provider.provider_name()
            )));
        }

        self.provider.recognize(image_path).await
    }

    /// 识别图片字节数据中的文字
    pub async fn recognize_bytes(&self, image_data: &[u8]) -> Result<OcrResult, OcrError> {
        if !self.config.enabled {
            return Err(OcrError::ConfigError("OCR is disabled".to_string()));
        }

        if !self.provider.is_available().await {
            return Err(OcrError::ConfigError(format!(
                "OCR provider '{}' is not available",
                self.provider.provider_name()
            )));
        }

        self.provider.recognize_bytes(image_data).await
    }

    /// 更新配置
    pub fn update_config(&mut self, config: OcrConfig) -> Result<(), OcrError> {
        let provider = Self::create_provider(&config)?;
        self.config = config;
        self.provider = provider;
        Ok(())
    }

    /// 获取当前配置
    pub fn get_config(&self) -> &OcrConfig {
        &self.config
    }

    /// 获取提供者名称
    pub fn provider_name(&self) -> &str {
        self.provider.provider_name()
    }

    /// 检查服务是否可用
    pub async fn is_available(&self) -> bool {
        self.config.enabled && self.provider.is_available().await
    }
}
