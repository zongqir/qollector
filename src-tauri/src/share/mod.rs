pub mod config;
pub mod file_io;
pub mod qr_generator;
pub mod s3_uploader;
pub mod service;

pub use config::{S3Config, ShareConfig, ShareProvider};
pub use service::{ShareMethod, ShareResult, ShareService};

#[derive(Debug, thiserror::Error)]
pub enum ShareError {
    #[error("QR generation failed: {0}")]
    QrGeneration(String),

    #[error("Upload failed: {0}")]
    Upload(String),

    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("S3 error: {0}")]
    S3(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Invalid config: {0}")]
    InvalidConfig(String),
}
