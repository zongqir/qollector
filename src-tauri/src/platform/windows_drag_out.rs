#[cfg(target_os = "windows")]
use std::path::PathBuf;
#[cfg(target_os = "windows")]
use std::sync::mpsc;

#[cfg(target_os = "windows")]
use tauri::{AppHandle, WebviewWindow};

#[cfg(target_os = "windows")]
use drag::{start_drag, DragItem, DragMode, Image, Options};

#[cfg(target_os = "windows")]
use super::drag_out::{DragOutError, DragOutOperation, DragOutRequest, PlatformDragOut};

pub struct WindowsDragOutBackend;

impl WindowsDragOutBackend {
    pub fn new() -> Self {
        Self
    }
}

#[cfg(target_os = "windows")]
impl PlatformDragOut for WindowsDragOutBackend {
    fn start_file_drag(
        &self,
        app: AppHandle,
        window: WebviewWindow,
        request: DragOutRequest,
    ) -> Result<(), DragOutError> {
        if request.paths.is_empty() {
            return Err(DragOutError::EmptyPaths);
        }

        let mut valid_paths: Vec<PathBuf> = Vec::with_capacity(request.paths.len());
        for path in request.paths {
            if !path.exists() {
                return Err(DragOutError::MissingPath(path.display().to_string()));
            }
            valid_paths.push(path);
        }

        let drag_mode = match request.operation {
            DragOutOperation::Copy => DragMode::Copy,
            DragOutOperation::Move => DragMode::Move,
            DragOutOperation::Link => DragMode::Copy,
        };

        let (tx, rx) = mpsc::sync_channel::<Result<(), DragOutError>>(1);
        app.run_on_main_thread(move || {
            let image = Image::Raw(vec![0, 0, 0, 0]);
            let options = Options {
                skip_animatation_on_cancel_or_failure: true,
                mode: drag_mode,
            };

            let result = start_drag(
                &window,
                DragItem::Files(valid_paths),
                image,
                |_result, _cursor_position| {},
                options,
            )
            .map_err(|e| DragOutError::Native(e.to_string()));

            let _ = tx.send(result);
        })
        .map_err(|e| DragOutError::MainThread(e.to_string()))?;

        rx.recv()
            .map_err(|e| DragOutError::Native(format!("failed to receive drag result: {e}")))??;

        Ok(())
    }
}
