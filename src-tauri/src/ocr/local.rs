use super::{provider::OcrProvider, OcrError, OcrResult};
use async_trait::async_trait;
use std::path::Path;
use std::process::Command;

/// 本地 Tesseract OCR 实现
///
/// 通过命令行调用 tesseract 可执行文件
pub struct LocalOcr {
    language: String,
}

impl LocalOcr {
    pub fn new(language: String) -> Self {
        Self { language }
    }

    /// 检查 Tesseract 是否已安装
    pub fn check_tesseract_installed() -> bool {
        // 尝试执行 tesseract --version
        Command::new("tesseract").arg("--version").output().is_ok()
    }

    /// 执行 OCR 识别
    fn do_recognize(&self, image_path: &str) -> Result<String, OcrError> {
        // 检查文件是否存在
        if !Path::new(image_path).exists() {
            return Err(OcrError::ImageError(format!(
                "图片文件不存在: {}",
                image_path
            )));
        }

        // 创建临时输出文件
        let temp_dir = std::env::temp_dir();
        let output_base = temp_dir.join(format!("ocr_output_{}", uuid::Uuid::new_v4()));
        let output_txt = format!("{}.txt", output_base.display());

        // 调用 tesseract
        // tesseract image.png output -l chi_sim+eng
        let output = Command::new("tesseract")
            .arg(image_path)
            .arg(output_base.to_str().unwrap())
            .arg("-l")
            .arg(&self.language)
            .output()
            .map_err(|e| {
                OcrError::EngineError(format!(
                    "执行 tesseract 失败: {}. 请确保已安装 Tesseract OCR",
                    e
                ))
            })?;

        if !output.status.success() {
            let error_msg = String::from_utf8_lossy(&output.stderr);
            return Err(OcrError::EngineError(format!(
                "Tesseract 执行失败: {}",
                error_msg
            )));
        }

        // 读取输出文件
        let text = std::fs::read_to_string(&output_txt).map_err(|e| OcrError::IoError(e))?;

        // 删除临时文件
        let _ = std::fs::remove_file(&output_txt);

        Ok(text.trim().to_string())
    }
}

#[async_trait]
impl OcrProvider for LocalOcr {
    async fn recognize(&self, image_path: &str) -> Result<OcrResult, OcrError> {
        // 在异步上下文中执行同步的命令调用
        let language = self.language.clone();
        let path = image_path.to_string();

        let text = tokio::task::spawn_blocking(move || {
            let ocr = LocalOcr::new(language);
            ocr.do_recognize(&path)
        })
        .await
        .map_err(|e| OcrError::EngineError(format!("任务执行失败: {}", e)))??;

        Ok(OcrResult::new(text, "本地 Tesseract".to_string()))
    }

    async fn recognize_bytes(&self, image_data: &[u8]) -> Result<OcrResult, OcrError> {
        // 创建临时文件
        let temp_dir = std::env::temp_dir();
        let temp_file = temp_dir.join(format!("ocr_temp_{}.png", uuid::Uuid::new_v4()));

        // 写入临时文件
        tokio::fs::write(&temp_file, image_data)
            .await
            .map_err(|e| OcrError::IoError(e))?;

        // 识别
        let result = self.recognize(temp_file.to_str().unwrap()).await;

        // 删除临时文件
        let _ = tokio::fs::remove_file(&temp_file).await;

        result
    }

    fn provider_name(&self) -> &str {
        "本地 Tesseract"
    }

    async fn is_available(&self) -> bool {
        Self::check_tesseract_installed()
    }
}
