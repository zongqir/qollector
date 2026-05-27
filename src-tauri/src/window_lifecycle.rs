use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use crate::low_memory_mode::LowMemoryModeState;
use tauri::{AppHandle, Manager, WebviewWindow, WebviewWindowBuilder};

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const LOW_MEMORY_MAIN_WINDOW_RELEASE_DELAY_SECS: u64 = 120;

#[derive(Default)]
pub struct MainWindowLifecycleState {
    release_generation: AtomicU64,
}

impl MainWindowLifecycleState {
    fn bump_release_generation(&self) -> u64 {
        self.release_generation.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn current_release_generation(&self) -> u64 {
        self.release_generation.load(Ordering::SeqCst)
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

pub fn cancel_main_window_release(app: &AppHandle, reason: &str) {
    if let Some(state) = app.try_state::<MainWindowLifecycleState>() {
        let generation = state.bump_release_generation();
        println!(
            "[MainWindow] cancel delayed release generation={} reason={}",
            generation, reason
        );
    }
}

pub fn schedule_main_window_release(app: AppHandle, reason: &str) {
    let Some(state) = app.try_state::<MainWindowLifecycleState>() else {
        return;
    };

    let low_memory_mode_enabled = app
        .try_state::<LowMemoryModeState>()
        .map(|mode| mode.is_enabled())
        .unwrap_or(false);

    if !low_memory_mode_enabled {
        let generation = state.bump_release_generation();
        println!(
            "[MainWindow] keep hidden main webview generation={} reason={} (low memory mode disabled)",
            generation, reason
        );
        return;
    }

    let release_delay_secs = LOW_MEMORY_MAIN_WINDOW_RELEASE_DELAY_SECS;

    let generation = state.bump_release_generation();
    println!(
        "[MainWindow] schedule delayed release generation={} delay={}s reason={}",
        generation, release_delay_secs, reason
    );

    let reason = reason.to_string();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(release_delay_secs)).await;

        let Some(state) = app.try_state::<MainWindowLifecycleState>() else {
            return;
        };

        if state.current_release_generation() != generation {
            println!(
                "[MainWindow] skip delayed release generation={} reason={} (superseded)",
                generation, reason
            );
            return;
        }

        let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            println!(
                "[MainWindow] skip delayed release generation={} reason={} (window missing)",
                generation, reason
            );
            return;
        };

        if window.is_visible().unwrap_or(false) {
            println!(
                "[MainWindow] skip delayed release generation={} reason={} (window visible)",
                generation, reason
            );
            return;
        }

        match window.destroy() {
            Ok(_) => {
                println!(
                    "[MainWindow] released hidden main webview generation={} reason={}",
                    generation, reason
                );
            }
            Err(error) => {
                eprintln!(
                    "[MainWindow] failed to release hidden main webview generation={} reason={} error={}",
                    generation, reason, error
                );
            }
        }
    });
}

pub fn hide_main_window_with_release(app: &AppHandle, reason: &str) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
        schedule_main_window_release(app.clone(), reason);
    }
}
