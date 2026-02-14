pub mod clipboard_trait;

#[cfg(target_os = "windows")]
pub mod windows;

#[cfg(target_os = "linux")]
pub mod linux;

#[cfg(target_os = "macos")]
pub mod macos;

use std::sync::Arc;
use clipboard_trait::{PlatformClipboard, ClipboardError};

pub fn create_platform() -> Result<Arc<dyn PlatformClipboard>, ClipboardError> {
    #[cfg(target_os = "windows")]
    {
        use windows::windows::WindowsClipboard;
        Ok(Arc::new(WindowsClipboard::new()?))
    }

    #[cfg(target_os = "linux")]
    {
        use linux::LinuxClipboard;
        Ok(Arc::new(LinuxClipboard::new()?))
    }

    #[cfg(target_os = "macos")]
    {
        use macos::MacosClipboard;
        Ok(Arc::new(MacosClipboard::new()?))
    }
}
