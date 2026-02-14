use async_trait::async_trait;
use crate::core::models::{ClipboardContent, WindowMetadata};
use super::clipboard_trait::{PlatformClipboard, ClipboardCallback, ClipboardError};

pub struct MacosClipboard;

impl MacosClipboard {
    pub fn new() -> Result<Self, ClipboardError> {
        todo!("macOS clipboard not yet implemented")
    }
}

#[async_trait]
impl PlatformClipboard for MacosClipboard {
    fn register_listener(&self, _callback: ClipboardCallback) -> Result<(), ClipboardError> {
        todo!("macOS clipboard listener not yet implemented")
    }

    async fn get_content(&self) -> Result<ClipboardContent, ClipboardError> {
        todo!("macOS get_content not yet implemented")
    }

    async fn set_content(&self, _content: ClipboardContent) -> Result<(), ClipboardError> {
        todo!("macOS set_content not yet implemented")
    }

    fn get_active_window_info(&self) -> Result<WindowMetadata, ClipboardError> {
        todo!("macOS get_active_window_info not yet implemented")
    }

    async fn clear(&self) -> Result<(), ClipboardError> {
        todo!("macOS clear not yet implemented")
    }
}
