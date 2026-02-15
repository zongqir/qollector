pub mod clipboard_trait;
pub mod drag_out;

#[cfg(target_os = "windows")]
pub mod windows;
#[cfg(target_os = "windows")]
pub mod windows_drag_out;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "linux")]
pub mod linux_drag_out;

#[cfg(target_os = "macos")]
pub mod macos;
#[cfg(target_os = "macos")]
pub mod macos_drag_out;

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
