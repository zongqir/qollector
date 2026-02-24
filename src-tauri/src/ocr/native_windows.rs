use super::super::{provider::OcrProvider, OcrError, OcrResult};
use async_trait::async_trait;

pub struct WindowsNativeOcr;

impl WindowsNativeOcr {
    pub fn new() -> Self {
        Self
    }

    fn do_recognize(image_path: &str) -> Result<String, OcrError> {
        use windows::core::HSTRING;
        use windows::Graphics::Imaging::BitmapDecoder;
        use windows::Media::Ocr::OcrEngine;
        use windows::Storage::StorageFile;

        let path = HSTRING::from(image_path);
        let file = StorageFile::GetFileFromPathAsync(&path)
            .map_err(|e| OcrError::EngineError(format!("Failed to open file: {}", e)))?
            .get()
            .map_err(|e| OcrError::EngineError(format!("Failed to open file: {}", e)))?;

        let stream = file
            .OpenReadAsync()
            .map_err(|e| OcrError::EngineError(format!("Failed to open stream: {}", e)))?
            .get()
            .map_err(|e| OcrError::EngineError(format!("Failed to open stream: {}", e)))?;

        let decoder = BitmapDecoder::CreateAsync(&stream)
            .map_err(|e| OcrError::EngineError(format!("Failed to create decoder: {}", e)))?
            .get()
            .map_err(|e| OcrError::EngineError(format!("Failed to create decoder: {}", e)))?;

        let bitmap = decoder
            .GetSoftwareBitmapAsync()
            .map_err(|e| OcrError::EngineError(format!("Failed to get bitmap: {}", e)))?
            .get()
            .map_err(|e| OcrError::EngineError(format!("Failed to get bitmap: {}", e)))?;

        let engine = OcrEngine::TryCreateFromUserProfileLanguages()
            .map_err(|e| OcrError::EngineError(format!("Failed to create OCR engine: {}", e)))?;

        let result = engine
            .RecognizeAsync(&bitmap)
            .map_err(|e| OcrError::EngineError(format!("OCR recognition failed: {}", e)))?
            .get()
            .map_err(|e| OcrError::EngineError(format!("OCR recognition failed: {}", e)))?;

        let text = result
            .Text()
            .map_err(|e| OcrError::EngineError(format!("Failed to get text: {}", e)))?;

        Ok(text.to_string_lossy())
    }
}

#[async_trait]
impl OcrProvider for WindowsNativeOcr {
    async fn recognize(&self, image_path: &str) -> Result<OcrResult, OcrError> {
        let path = image_path.to_string();
        let text = tokio::task::spawn_blocking(move || Self::do_recognize(&path))
            .await
            .map_err(|e| OcrError::EngineError(format!("Task failed: {}", e)))??;

        Ok(OcrResult::new(text, "Native OCR".to_string()))
    }

    async fn recognize_bytes(&self, image_data: &[u8]) -> Result<OcrResult, OcrError> {
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("native_ocr_{}.png", uuid::Uuid::new_v4()));

        tokio::fs::write(&temp_file, image_data)
            .await
            .map_err(|e| OcrError::IoError(e))?;

        let result = self
            .recognize(temp_file.to_str().unwrap())
            .await;

        let _ = tokio::fs::remove_file(&temp_file).await;

        result
    }

    fn provider_name(&self) -> &str {
        "Native OCR"
    }

    async fn is_available(&self) -> bool {
        // Windows.Media.Ocr is available on Windows 10+
        true
    }
}
