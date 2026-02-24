use super::super::{provider::OcrProvider, OcrError, OcrResult};
use async_trait::async_trait;

/// Linux has no built-in OCR API. This stub directs users to use Tesseract (Local provider).
pub struct LinuxNativeOcr;

impl LinuxNativeOcr {
    pub fn new() -> Self {
        Self
    }
}

#[async_trait]
impl OcrProvider for LinuxNativeOcr {
    async fn recognize(&self, _image_path: &str) -> Result<OcrResult, OcrError> {
        Err(OcrError::EngineError(
            "Native OCR is not available on Linux. Please use the Local (Tesseract) provider instead.".to_string(),
        ))
    }

    async fn recognize_bytes(&self, _image_data: &[u8]) -> Result<OcrResult, OcrError> {
        Err(OcrError::EngineError(
            "Native OCR is not available on Linux. Please use the Local (Tesseract) provider instead.".to_string(),
        ))
    }

    fn provider_name(&self) -> &str {
        "Native OCR"
    }

    async fn is_available(&self) -> bool {
        false
    }
}
