use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder};

pub const MAIN_WINDOW_LABEL: &str = "main";

#[derive(Default)]
pub struct AppExitState {
    user_requested_exit: AtomicBool,
}

impl AppExitState {
    pub fn mark_user_requested_exit(&self) {
        self.user_requested_exit.store(true, Ordering::SeqCst);
    }

    pub fn is_user_requested_exit(&self) -> bool {
        self.user_requested_exit.load(Ordering::SeqCst)
    }
}

fn find_main_window_config(app: &AppHandle) -> Option<tauri::utils::config::WindowConfig> {
    app.config()
        .app
        .windows
        .iter()
        .find(|cfg| cfg.label == MAIN_WINDOW_LABEL)
        .cloned()
}

pub fn ensure_main_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        return Ok(window);
    }

    let config = find_main_window_config(app)
        .ok_or_else(|| format!("main window config '{}' not found", MAIN_WINDOW_LABEL))?;

    WebviewWindowBuilder::from_config(app, &config)
        .map_err(|e| format!("failed to create main window builder: {}", e))?
        .build()
        .map_err(|e| format!("failed to build main window: {}", e))
}

pub fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
    }
}

static LAST_EXTERNAL_ACTIVE_HWND: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);

pub fn record_external_active_window() {
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
        let hwnd = GetForegroundWindow();
        if !hwnd.is_invalid() {
            let mut pid = 0;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid != 0 && pid != std::process::id() {
                LAST_EXTERNAL_ACTIVE_HWND.store(hwnd.0 as usize, Ordering::SeqCst);
            }
        }
    }
}

pub fn get_last_external_active_window() -> usize {
    LAST_EXTERNAL_ACTIVE_HWND.load(Ordering::SeqCst)
}
