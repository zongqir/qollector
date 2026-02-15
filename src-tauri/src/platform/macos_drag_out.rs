use tauri::{AppHandle, WebviewWindow};

use super::drag_out::{DragOutError, DragOutRequest, PlatformDragOut};

pub struct MacosDragOutBackend;

impl MacosDragOutBackend {
    pub fn new() -> Self {
        Self
    }
}

impl PlatformDragOut for MacosDragOutBackend {
    fn start_file_drag(
        &self,
        _app: AppHandle,
        _window: WebviewWindow,
        _request: DragOutRequest,
    ) -> Result<(), DragOutError> {
        // Future macOS implementation should bridge this abstraction to
        // NSDraggingSession with file URLs / file promises as needed.
        Err(DragOutError::Unsupported)
    }
}
