use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, State, WebviewWindow};
use uuid::Uuid;

use crate::platform::drag_out::{DragOutOperation, DragOutRequest, PlatformDragOut};

const DRAG_TEXT_TEMP_DIR_NAME: &str = "qollect_drag_text";
const DRAG_TEXT_FILE_PREFIX: &str = "qollect";
const DRAG_TEXT_TTL_SECONDS: u64 = 24 * 60 * 60;
const MAX_FILENAME_STEM_CHARS: usize = 64;
const DEFAULT_FILENAME_STEM: &str = "qollect";

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

fn is_json_text(content: &str) -> bool {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return false;
    }
    if !(trimmed.starts_with('{') || trimmed.starts_with('[')) {
        return false;
    }
    serde_json::from_str::<serde_json::Value>(trimmed).is_ok()
}

fn resolve_text_extension(language: Option<&str>, content: &str) -> &'static str {
    let normalized = language.unwrap_or("").trim().to_ascii_lowercase();
    match normalized.as_str() {
        "json" => "json",
        "javascript" | "js" => "js",
        "typescript" | "ts" => "ts",
        "python" | "py" => "py",
        "rust" | "rs" => "rs",
        "java" => "java",
        "cpp" | "c++" | "cc" | "cxx" => "cpp",
        "c" => "c",
        "go" => "go",
        "bash" | "shell" | "sh" => "sh",
        "sql" => "sql",
        "yaml" | "yml" => "yml",
        "xml" => "xml",
        "html" => "html",
        "css" => "css",
        "markdown" | "md" => "md",
        _ => {
            if is_json_text(content) {
                "json"
            } else {
                "txt"
            }
        }
    }
}

fn sanitize_filename_stem(raw: Option<&str>, extension: &str) -> String {
    let candidate = raw.unwrap_or("").trim();

    let mut stem: String = candidate
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            {
                '_'
            } else {
                ch
            }
        })
        .collect();

    stem = stem.split_whitespace().collect::<Vec<_>>().join(" ");
    stem = stem
        .trim_matches(|c: char| c == ' ' || c == '.')
        .to_string();
    while stem.starts_with('.') {
        stem.remove(0);
    }

    let extension_suffix = format!(".{}", extension.to_ascii_lowercase());
    let lower = stem.to_ascii_lowercase();
    if lower.ends_with(&extension_suffix) && stem.len() > extension_suffix.len() {
        let next_len = stem.len() - extension_suffix.len();
        stem.truncate(next_len);
        stem = stem.trim_end_matches('.').trim().to_string();
    }

    stem = stem
        .chars()
        .take(MAX_FILENAME_STEM_CHARS)
        .collect::<String>();
    stem = stem
        .trim_matches(|c: char| c == ' ' || c == '.')
        .to_string();

    if stem.is_empty() {
        stem = DRAG_TEXT_FILE_PREFIX.to_string();
    }

    let reserved = [
        "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
        "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
    ];
    if reserved.contains(&stem.to_ascii_lowercase().as_str()) {
        stem.push_str("_file");
    }

    if stem.is_empty() {
        DEFAULT_FILENAME_STEM.to_string()
    } else {
        stem
    }
}

fn cleanup_expired_drag_text_files(temp_dir: &std::path::Path) {
    let entries = match std::fs::read_dir(temp_dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };
        let modified = match metadata.modified() {
            Ok(modified) => modified,
            Err(_) => continue,
        };
        let elapsed = match modified.elapsed() {
            Ok(elapsed) => elapsed,
            Err(_) => continue,
        };
        if elapsed.as_secs() > DRAG_TEXT_TTL_SECONDS {
            if metadata.is_dir() {
                let _ = std::fs::remove_dir_all(path);
            } else {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

fn create_temp_drag_text_file(
    content: &str,
    language: Option<&str>,
    filename_stem: Option<&str>,
) -> Result<PathBuf, String> {
    let temp_root = std::env::temp_dir().join(DRAG_TEXT_TEMP_DIR_NAME);
    std::fs::create_dir_all(&temp_root)
        .map_err(|error| format!("failed to create drag temp dir: {error}"))?;
    cleanup_expired_drag_text_files(&temp_root);

    let extension = resolve_text_extension(language, content);
    let stem = sanitize_filename_stem(filename_stem, extension);
    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let base_name = format!("{stem}_{timestamp}", stem = stem, timestamp = timestamp,);
    let drag_session_dir = temp_root.join(format!("drag_{}", Uuid::new_v4().simple()));
    std::fs::create_dir_all(&drag_session_dir)
        .map_err(|error| format!("failed to create drag session dir: {error}"))?;
    let output_path = drag_session_dir.join(format!("{base_name}.{extension}"));

    std::fs::write(&output_path, content)
        .map_err(|error| format!("failed to write drag temp file: {error}"))?;

    Ok(output_path)
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

    let parsed_paths: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let operation = parse_operation(operation)?;
    let request = DragOutRequest {
        paths: parsed_paths,
        operation,
    };

    backend
        .start_file_drag(app, window, request)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_native_text_drag(
    app: AppHandle,
    window: WebviewWindow,
    backend: State<'_, Arc<dyn PlatformDragOut>>,
    content: String,
    language: Option<String>,
    filename_stem: Option<String>,
    operation: Option<String>,
) -> Result<(), String> {
    if content.trim().is_empty() {
        return Err("text content is empty".to_string());
    }

    let temp_path =
        create_temp_drag_text_file(&content, language.as_deref(), filename_stem.as_deref())?;
    let operation = parse_operation(operation)?;
    let request = DragOutRequest {
        paths: vec![temp_path],
        operation,
    };

    backend
        .start_file_drag(app, window, request)
        .map_err(|e| e.to_string())
}
