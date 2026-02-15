use tauri::{AppHandle, WebviewWindow};

use super::drag_out::{DragOutError, DragOutRequest, PlatformDragOut};

pub struct LinuxDragOutBackend;

impl LinuxDragOutBackend {
    pub fn new() -> Self {
        Self
    }
}

impl PlatformDragOut for LinuxDragOutBackend {
    fn start_file_drag(
        &self,
        _app: AppHandle,
        _window: WebviewWindow,
        _request: DragOutRequest,
    ) -> Result<(), DragOutError> {
        // Future Linux implementation should use GTK drag source and provide
        // file list content (e.g. GFile) from this abstraction entrypoint.
        Err(DragOutError::Unsupported)
    }
}
