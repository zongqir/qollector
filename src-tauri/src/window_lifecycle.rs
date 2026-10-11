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
