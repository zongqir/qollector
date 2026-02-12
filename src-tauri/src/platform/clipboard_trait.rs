use async_trait::async_trait;
use std::future::Future;
use std::pin::Pin;
use crate::core::models::{ClipboardContent, WindowMetadata};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;
pub type ClipboardCallback = Box<dyn Fn(ClipboardContent) -> BoxFuture<'static, Result<(), ClipboardError>> + Send + Sync + 'static>;

#[async_trait]
pub trait PlatformClipboard: Send + Sync {
    fn register_listener(&self, callback: ClipboardCallback) -> Result<(), ClipboardError>;

    async fn get_content(&self) -> Result<ClipboardContent, ClipboardError>;

    async fn set_content(&self, content: ClipboardContent) -> Result<(), ClipboardError>;

    fn get_active_window_info(&self) -> Result<WindowMetadata, ClipboardError>;

    async fn clear(&self) -> Result<(), ClipboardError>;
}

#[derive(Debug, thiserror::Error)]
pub enum ClipboardError {
    #[error("Failed to access clipboard: {0}")]
    AccessError(String),

    #[error("Unsupported content type")]
    UnsupportedType,

    #[error("Platform error: {0}")]
    PlatformError(String),
}
