use std::path::PathBuf;
use std::sync::mpsc;

use tauri::{AppHandle, WebviewWindow};

use drag::{start_drag, DragItem, DragMode, Image, Options};

use super::drag_out::{DragOutError, DragOutOperation, DragOutRequest, PlatformDragOut};

pub struct MacosDragOutBackend;

impl MacosDragOutBackend {
    pub fn new() -> Self {
        Self
    }
}

fn build_drag_preview_image() -> Image {
    // 1x1 transparent PNG.
    Image::Raw(vec![
        137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
        0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 252, 255, 159, 161,
        30, 0, 6, 131, 2, 127, 148, 221, 149, 53, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ])
}

impl PlatformDragOut for MacosDragOutBackend {
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
            let canonical_path = std::fs::canonicalize(&path).map_err(|e| {
                DragOutError::Native(format!(
                    "failed to canonicalize drag path {}: {e}",
                    path.display()
                ))
            })?;
            valid_paths.push(canonical_path);
        }

        let drag_mode = match request.operation {
            DragOutOperation::Copy => DragMode::Copy,
            DragOutOperation::Move => DragMode::Move,
            DragOutOperation::Link => DragMode::Copy,
        };

        let (tx, rx) = mpsc::sync_channel::<Result<(), DragOutError>>(1);
        app.run_on_main_thread(move || {
            let options = Options {
                skip_animatation_on_cancel_or_failure: true,
                mode: drag_mode,
            };

            let result = start_drag(
                &window,
                DragItem::Files(valid_paths),
                build_drag_preview_image(),
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
