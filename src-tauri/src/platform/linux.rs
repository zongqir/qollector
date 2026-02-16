use super::clipboard_trait::{ClipboardCallback, ClipboardError, PlatformClipboard};
use crate::core::models::{ClipboardContent, WindowMetadata};
use async_trait::async_trait;

pub struct LinuxClipboard;

impl LinuxClipboard {
    pub fn new() -> Result<Self, ClipboardError> {
        todo!("Linux clipboard not yet implemented")
    }
}

#[async_trait]
impl PlatformClipboard for LinuxClipboard {
    fn register_listener(&self, _callback: ClipboardCallback) -> Result<(), ClipboardError> {
        todo!("Linux clipboard listener not yet implemented")
    }

    async fn get_content(&self) -> Result<ClipboardContent, ClipboardError> {
        todo!("Linux get_content not yet implemented")
    }

    async fn set_content(&self, _content: ClipboardContent) -> Result<(), ClipboardError> {
        todo!("Linux set_content not yet implemented")
    }

    fn get_active_window_info(&self) -> Result<WindowMetadata, ClipboardError> {
        todo!("Linux get_active_window_info not yet implemented")
    }

    async fn clear(&self) -> Result<(), ClipboardError> {
        todo!("Linux clear not yet implemented")
    }
}
