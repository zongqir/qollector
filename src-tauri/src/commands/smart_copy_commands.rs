use crate::commands::ocr_commands::OcrState;
use crate::core::clipboard_manager::ClipboardManager;
use base64::engine::general_purpose::{STANDARD, URL_SAFE};
use base64::Engine;
use std::sync::Arc;
use tauri::State;

fn decode_image_data_to_bytes(image_data: &str) -> Result<Vec<u8>, String> {
    let trimmed = image_data.trim();
    if trimmed.is_empty() {
        return Err("image data is empty".to_string());
    }

    // Support both data URL and raw base64 payload.
    let raw_base64 = if let Some(idx) = trimmed.find(',') {
        let (prefix, payload) = trimmed.split_at(idx + 1);
        if prefix.starts_with("data:") && prefix.contains(";base64") {
            payload
        } else {
            trimmed
        }
    } else {
        trimmed
    };

    let cleaned = raw_base64.trim().replace('\n', "").replace('\r', "");
    if cleaned.is_empty() {
        return Err("image base64 payload is empty".to_string());
    }

    STANDARD
        .decode(&cleaned)
        .or_else(|_| URL_SAFE.decode(&cleaned))
        .map_err(|e| format!("failed to decode image base64: {e}"))
}

#[tauri::command]
pub async fn start_system_screen_capture() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg("ms-screenclip:")
            .spawn()
            .map_err(|e| format!("failed to start screen snipping: {e}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("system screen capture is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub async fn smart_copy_from_image_data(
    state: State<'_, OcrState>,
    manager: State<'_, Arc<ClipboardManager>>,
    image_data: String,
    copy_to_clipboard: Option<bool>,
) -> Result<String, String> {
    let image_bytes = decode_image_data_to_bytes(&image_data)?;

    let service_opt = {
        let service_guard = state.service.lock();
        service_guard.clone()
    };

    let service = service_opt.ok_or_else(|| "OCR service not initialized".to_string())?;
    let result = service
        .recognize_bytes(&image_bytes)
        .await
        .map_err(|e| format!("OCR recognition failed: {e}"))?;

    let text = result.text.trim().to_string();
    if text.is_empty() {
        return Err("OCR returned empty text".to_string());
    }

    if copy_to_clipboard.unwrap_or(true) {
        manager
            .copy_plain_text(&text)
            .await
            .map_err(|e| format!("copy text failed: {e}"))?;
    }

    Ok(text)
}

#[tauri::command]
pub async fn smart_copy_from_image_path(
    state: State<'_, OcrState>,
    manager: State<'_, Arc<ClipboardManager>>,
    image_path: String,
    copy_to_clipboard: Option<bool>,
) -> Result<String, String> {
    let path = image_path.trim();
    if path.is_empty() {
        return Err("image path is empty".to_string());
    }

    let service_opt = {
        let service_guard = state.service.lock();
        service_guard.clone()
    };

    let service = service_opt.ok_or_else(|| "OCR service not initialized".to_string())?;
    let result = service
        .recognize(path)
        .await
        .map_err(|e| format!("OCR recognition failed: {e}"))?;

    let text = result.text.trim().to_string();
    if text.is_empty() {
        return Err("OCR returned empty text".to_string());
    }

    if copy_to_clipboard.unwrap_or(true) {
        manager
            .copy_plain_text(&text)
            .await
            .map_err(|e| format!("copy text failed: {e}"))?;
    }

    Ok(text)
}
