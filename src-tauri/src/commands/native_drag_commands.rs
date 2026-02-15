use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State, WebviewWindow};

use crate::platform::drag_out::{DragOutOperation, DragOutRequest, PlatformDragOut};

fn parse_operation(operation: Option<String>) -> Result<DragOutOperation, String> {
    match operation
        .unwrap_or_else(|| "copy".to_string())
        .to_ascii_lowercase()
        .as_str()
    {
        "copy" => Ok(DragOutOperation::Copy),
        "move" => Ok(DragOutOperation::Move),
        "link" => Ok(DragOutOperation::Link),
        other => Err(format!("unsupported drag operation: {other}")),
    }
}

#[tauri::command]
pub async fn start_native_file_drag(
    app: AppHandle,
    window: WebviewWindow,
    backend: State<'_, Arc<dyn PlatformDragOut>>,
    paths: Vec<String>,
    operation: Option<String>,
) -> Result<(), String> {
    if paths.is_empty() {
        return Err("no paths provided".to_string());
    }

    let parsed_paths: Vec<PathBuf> = paths
        .into_iter()
        .map(PathBuf::from)
        .collect();
    let operation = parse_operation(operation)?;
    let request = DragOutRequest {
        paths: parsed_paths,
        operation,
    };

    backend
        .start_file_drag(app, window, request)
        .map_err(|e| e.to_string())
}
