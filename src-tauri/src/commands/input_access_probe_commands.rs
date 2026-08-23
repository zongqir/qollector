use crate::core::clipboard_manager::ClipboardManager;
use crate::core::models::WindowMetadata;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

const MAX_DELAY_MS: u64 = 15_000;
const MIN_DELAY_MS: u64 = 1_000;
const MAX_PREVIEW_CHARS: usize = 500;
const MAX_CAPTURE_CHARS: i32 = 10_000;
const CAPTURE_POLL_INTERVAL: Duration = Duration::from_millis(750);
const CAPTURE_SETTLE_DELAY: Duration = Duration::from_millis(900);

pub struct InputCaptureState {
    enabled: AtomicBool,
}

impl InputCaptureState {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled: AtomicBool::new(enabled),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::Relaxed);
    }

    fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }
}

#[derive(Debug, Clone)]
struct FocusedTextSnapshot {
    element_id: String,
    text: String,
}

#[derive(Clone)]
struct PendingCapture {
    element_id: String,
    text: String,
    metadata: WindowMetadata,
    changed_at: Instant,
    dirty: bool,
    saved_item_id: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InputAccessProbeResult {
    pub supported: bool,
    pub readable: bool,
    pub is_password: bool,
    pub value_kind: Option<String>,
    pub text_preview: Option<String>,
    pub text_truncated: bool,
    pub element_name: String,
    pub control_type: String,
    pub class_name: String,
    pub framework_id: String,
    pub process_id: Option<u32>,
    pub read_error: Option<String>,
}

#[cfg(not(target_os = "windows"))]
impl InputAccessProbeResult {
    fn unsupported() -> Self {
        Self {
            supported: false,
            readable: false,
            is_password: false,
            value_kind: None,
            text_preview: None,
            text_truncated: false,
            element_name: String::new(),
            control_type: String::new(),
            class_name: String::new(),
            framework_id: String::new(),
            process_id: None,
            read_error: Some("Windows UI Automation is unavailable on this platform.".to_string()),
        }
    }
}

fn preview_text(text: String) -> (String, bool) {
    let mut chars = text.chars();
    let preview: String = chars.by_ref().take(MAX_PREVIEW_CHARS).collect();
    (preview, chars.next().is_some())
}

#[cfg(target_os = "windows")]
fn read_focused_text_snapshot_sync() -> Option<FocusedTextSnapshot> {
    use uiautomation::patterns::{UITextPattern, UIValuePattern};
    use uiautomation::UIAutomation;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

    unsafe {
        if CoInitializeEx(None, COINIT_MULTITHREADED).is_err() {
            return None;
        }
    }

    let snapshot = (|| {
        let automation = UIAutomation::new_direct().ok()?;
        let element = automation.get_focused_element().ok()?;
        if element.is_password().unwrap_or(false) {
            return None;
        }

        let text = element
            .get_pattern::<UIValuePattern>()
            .and_then(|pattern| pattern.get_value())
            .or_else(|_| {
                element
                    .get_pattern::<UITextPattern>()
                    .and_then(|pattern| pattern.get_document_range())
                    .and_then(|range| range.get_text(MAX_CAPTURE_CHARS + 1))
            })
            .ok()?;
        let text: String = text.chars().take(MAX_CAPTURE_CHARS as usize).collect();

        let runtime_id = element.get_runtime_id().ok()?;
        Some(FocusedTextSnapshot {
            element_id: runtime_id
                .iter()
                .map(i32::to_string)
                .collect::<Vec<_>>()
                .join("."),
            text,
        })
    })();

    unsafe {
        CoUninitialize();
    }

    snapshot
}

#[cfg(not(target_os = "windows"))]
fn read_focused_text_snapshot_sync() -> Option<FocusedTextSnapshot> {
    None
}

async fn flush_pending_capture(manager: &ClipboardManager, pending: &mut PendingCapture) {
    if !pending.dirty || pending.text.trim().is_empty() {
        return;
    }

    let text = pending.text.clone();
    let result = match &pending.saved_item_id {
        // Treat changes in one focused field as one input session. This covers
        // both accumulating IME values and candidate corrections.
        Some(item_id) => {
            manager
                .update_input_snapshot(item_id, text.clone(), pending.metadata.clone())
                .await
                .map(|_| item_id.clone())
        }
        _ => manager
            .record_input_snapshot(text.clone(), pending.metadata.clone())
            .await,
    };

    match result {
        Ok(item_id) => {
            pending.saved_item_id = Some(item_id);
            pending.dirty = false;
        }
        Err(error) => {
            eprintln!("[Input Capture] failed to store focused text: {error}");
        }
    }
}

/// Starts the lightweight focused-input monitor once for the application lifetime.
/// It idles without calling UI Automation while the feature is disabled.
pub fn start_input_capture_monitor(
    manager: Arc<ClipboardManager>,
    state: Arc<InputCaptureState>,
) {
    tauri::async_runtime::spawn(async move {
        let mut pending: Option<PendingCapture> = None;

        loop {
            tokio::time::sleep(CAPTURE_POLL_INTERVAL).await;

            if !state.is_enabled() {
                pending = None;
                continue;
            }

            let snapshot = tokio::task::spawn_blocking(read_focused_text_snapshot_sync)
                .await
                .ok()
                .flatten();
            let now = Instant::now();

            let Some(snapshot) = snapshot else {
                if let Some(mut previous) = pending.take() {
                    flush_pending_capture(&manager, &mut previous).await;
                }
                continue;
            };

            let metadata = match manager.get_active_window_info() {
                Ok(metadata) if !metadata.is_self => metadata,
                _ => {
                    pending = None;
                    continue;
                }
            };

            match pending.as_mut() {
                Some(previous) if previous.element_id == snapshot.element_id => {
                    if previous.text != snapshot.text {
                        if snapshot.text.trim().is_empty() {
                            flush_pending_capture(&manager, previous).await;
                            previous.saved_item_id = None;
                        }
                        previous.text = snapshot.text;
                        previous.metadata = metadata;
                        previous.changed_at = now;
                        previous.dirty = !previous.text.trim().is_empty();
                    } else if previous.dirty
                        && now.duration_since(previous.changed_at) >= CAPTURE_SETTLE_DELAY
                    {
                        flush_pending_capture(&manager, previous).await;
                    }
                }
                _ => {
                    if let Some(mut previous) = pending.take() {
                        flush_pending_capture(&manager, &mut previous).await;
                    }
                    // Baseline a newly focused field so existing text is never captured on enable.
                    pending = Some(PendingCapture {
                        element_id: snapshot.element_id,
                        text: snapshot.text,
                        metadata,
                        changed_at: now,
                        dirty: false,
                        saved_item_id: None,
                    });
                }
            }
        }
    });
}

#[cfg(target_os = "windows")]
fn probe_focused_text_sync() -> Result<InputAccessProbeResult, String> {
    use uiautomation::patterns::{UITextPattern, UIValuePattern};
    use uiautomation::UIAutomation;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED)
            .ok()
            .map_err(|error| format!("Unable to initialize Windows UI Automation: {error}"))?;
    }

    let result = (|| {
        let automation = UIAutomation::new_direct()
            .map_err(|error| format!("Unable to create Windows UI Automation client: {error}"))?;
        let element = automation
            .get_focused_element()
            .map_err(|error| format!("Unable to inspect the focused control: {error}"))?;

        let element_name = element.get_name().unwrap_or_default();
        let control_type = element
            .get_control_type()
            .map(|value| format!("{value:?}"))
            .unwrap_or_default();
        let class_name = element.get_classname().unwrap_or_default();
        let framework_id = element.get_framework_id().unwrap_or_default();
        let process_id = element.get_process_id().ok();
        let is_password = element.is_password().unwrap_or(false);

        if is_password {
            return Ok(InputAccessProbeResult {
                supported: true,
                readable: false,
                is_password: true,
                value_kind: None,
                text_preview: None,
                text_truncated: false,
                element_name,
                control_type,
                class_name,
                framework_id,
                process_id,
                read_error: Some("The focused control is marked as a password field.".to_string()),
            });
        }

        let value_result = element
            .get_pattern::<UIValuePattern>()
            .and_then(|pattern| pattern.get_value());
        let (text_result, value_kind) = match value_result {
            Ok(text) => (Ok(text), "value"),
            Err(value_error) => {
                let text_result = element
                    .get_pattern::<UITextPattern>()
                    .and_then(|pattern| pattern.get_document_range())
                    .and_then(|range| range.get_text(MAX_PREVIEW_CHARS as i32 + 1));
                match text_result {
                    Ok(text) => (Ok(text), "text"),
                    Err(text_error) => (
                        Err(format!(
                            "Value pattern: {value_error}; Text pattern: {text_error}"
                        )),
                        "none",
                    ),
                }
            }
        };

        match text_result {
            Ok(text) => {
                let (text_preview, text_truncated) = preview_text(text);
                Ok(InputAccessProbeResult {
                    supported: true,
                    readable: true,
                    is_password: false,
                    value_kind: Some(value_kind.to_string()),
                    text_preview: Some(text_preview),
                    text_truncated,
                    element_name,
                    control_type,
                    class_name,
                    framework_id,
                    process_id,
                    read_error: None,
                })
            }
            Err(read_error) => Ok(InputAccessProbeResult {
                supported: true,
                readable: false,
                is_password: false,
                value_kind: None,
                text_preview: None,
                text_truncated: false,
                element_name,
                control_type,
                class_name,
                framework_id,
                process_id,
                read_error: Some(read_error),
            }),
        }
    })();

    unsafe {
        CoUninitialize();
    }

    result
}

#[cfg(not(target_os = "windows"))]
fn probe_focused_text_sync() -> Result<InputAccessProbeResult, String> {
    Ok(InputAccessProbeResult::unsupported())
}

#[tauri::command]
pub async fn probe_focused_text(delay_ms: Option<u64>) -> Result<InputAccessProbeResult, String> {
    let delay_ms = delay_ms.unwrap_or(6_000).clamp(MIN_DELAY_MS, MAX_DELAY_MS);
    tokio::time::sleep(Duration::from_millis(delay_ms)).await;
    tokio::task::spawn_blocking(probe_focused_text_sync)
        .await
        .map_err(|error| format!("The input-access probe task failed: {error}"))?
}
