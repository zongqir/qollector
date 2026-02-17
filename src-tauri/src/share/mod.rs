pub mod config;
pub mod qr_generator;
pub mod s3_uploader;
pub mod service;

pub use config::{S3Config, ShareConfig, ShareProvider};
pub use service::{ShareMethod, ShareResult, UploadResponse};

#[derive(Debug, thiserror::Error)]
pub enum ShareError {
    #[error("QR generation failed: {0}")]
    QrGeneration(String),

    #[error("Upload failed: {0}")]
    Upload(String),

    #[error("S3 error: {0}")]
    S3(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid config: {0}")]
    InvalidConfig(String),
}
