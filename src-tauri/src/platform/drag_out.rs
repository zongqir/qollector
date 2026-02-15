use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, WebviewWindow};

#[derive(Debug, Clone, Copy)]
pub enum DragOutOperation {
    Copy,
    Move,
    Link,
}

impl Default for DragOutOperation {
    fn default() -> Self {
        Self::Copy
    }
}

#[derive(Debug, Clone)]
pub struct DragOutRequest {
    pub paths: Vec<PathBuf>,
    pub operation: DragOutOperation,
}

#[derive(Debug, thiserror::Error)]
pub enum DragOutError {
    #[error("no file path provided for drag out")]
    EmptyPaths,
    #[error("file path does not exist: {0}")]
    MissingPath(String),
    #[error("failed to dispatch drag task to main thread: {0}")]
    MainThread(String),
    #[error("native drag out failed: {0}")]
    Native(String),
    #[error("drag out is not supported on this platform yet")]
    Unsupported,
}

pub trait PlatformDragOut: Send + Sync {
    fn start_file_drag(
        &self,
        app: AppHandle,
        window: WebviewWindow,
        request: DragOutRequest,
    ) -> Result<(), DragOutError>;
}

pub fn create_drag_out_backend() -> Arc<dyn PlatformDragOut> {
    #[cfg(target_os = "windows")]
    {
        Arc::new(super::windows_drag_out::WindowsDragOutBackend::new())
    }

    #[cfg(target_os = "linux")]
    {
        Arc::new(super::linux_drag_out::LinuxDragOutBackend::new())
    }

    #[cfg(target_os = "macos")]
    {
        Arc::new(super::macos_drag_out::MacosDragOutBackend::new())
    }
}
