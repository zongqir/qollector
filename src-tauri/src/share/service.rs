use serde::{Deserialize, Serialize};

use crate::share::config::{ShareConfig, ShareProvider};
use crate::share::file_io::upload_to_file_hosting;
use crate::share::qr_generator::generate_qr_base64;
use crate::share::s3_uploader::upload_to_s3;
use crate::share::ShareError;

const LOCAL_QR_TEXT_LIMIT: usize = 400;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ShareMethod {
    LocalQr,
    CloudUpload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareResult {
    pub method: ShareMethod,
    pub qr_code: String,
    pub url: Option<String>,
}

pub struct ShareService {
    pub config: ShareConfig,
}

impl ShareService {
    pub fn new(config: ShareConfig) -> Self {
        Self { config }
    }

    pub async fn share_content(
        &self,
        content_type: &str,
        content: Option<&str>,
        image_paths: Option<&str>,
    ) -> Result<ShareResult, ShareError> {
        match content_type {
            "text" | "link" | "code" => {
                let text = content.unwrap_or("");
                if text.is_empty() {
                    return Err(ShareError::InvalidConfig("No content to share".into()));
                }
                if text.len() <= LOCAL_QR_TEXT_LIMIT {
                    let qr = generate_qr_base64(text)?;
                    return Ok(ShareResult {
                        method: ShareMethod::LocalQr,
                        qr_code: qr,
                        url: None,
                    });
                }
                let bytes = text.as_bytes();
                let filename = "clipboard.txt";
                let url = self.upload_bytes(bytes, filename).await?;
                let qr = generate_qr_base64(&url)?;
                Ok(ShareResult {
                    method: ShareMethod::CloudUpload,
                    qr_code: qr,
                    url: Some(url),
                })
            }
            "image" => {
                let paths_str = image_paths
                    .ok_or_else(|| ShareError::InvalidConfig("No image paths".into()))?;
                let paths: serde_json::Value = serde_json::from_str(paths_str)
                    .map_err(|e| ShareError::InvalidConfig(e.to_string()))?;
                let original = paths
                    .get("original")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ShareError::InvalidConfig("No original in image_paths".into()))?;
                let bytes = tokio::fs::read(original).await?;
                let ext = std::path::Path::new(original)
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("png");
                let filename = format!("clipboard.{}", ext);
                let url = self.upload_bytes(&bytes, &filename).await?;
                let qr = generate_qr_base64(&url)?;
                Ok(ShareResult {
                    method: ShareMethod::CloudUpload,
                    qr_code: qr,
                    url: Some(url),
                })
            }
            "file" => {
                let text = content.unwrap_or("");
                if text.is_empty() {
                    return Err(ShareError::InvalidConfig("No file content".into()));
                }
                if text.len() <= LOCAL_QR_TEXT_LIMIT {
                    let qr = generate_qr_base64(text)?;
                    return Ok(ShareResult {
                        method: ShareMethod::LocalQr,
                        qr_code: qr,
                        url: None,
                    });
                }
                let url = self.upload_bytes(text.as_bytes(), "clipboard.txt").await?;
                let qr = generate_qr_base64(&url)?;
                Ok(ShareResult {
                    method: ShareMethod::CloudUpload,
                    qr_code: qr,
                    url: Some(url),
                })
            }
            _ => Err(ShareError::InvalidConfig(format!(
                "Unsupported content type: {}",
                content_type
            ))),
        }
    }

    async fn upload_bytes(&self, bytes: &[u8], filename: &str) -> Result<String, ShareError> {
        match &self.config.provider {
            ShareProvider::FileIo => upload_to_file_hosting(bytes, filename).await,
            ShareProvider::S3 => {
                let s3_config = self
                    .config
                    .s3_config
                    .as_ref()
                    .ok_or_else(|| ShareError::InvalidConfig("S3 config required".into()))?;
                s3_config.validate().map_err(ShareError::InvalidConfig)?;
                upload_to_s3(bytes, filename, s3_config).await
            }
        }
    }
}
