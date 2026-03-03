use std::sync::Arc;
use parking_lot::Mutex;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

use crate::core::clipboard_manager::ClipboardManager;
use crate::low_memory_mode::AppExitState;
use crate::window_lifecycle::{
    cancel_main_window_release, ensure_main_window, hide_main_window_with_release,
    MAIN_WINDOW_LABEL,
};

/// Shared tray language state so menu event handlers always use the latest language.
pub struct TrayLanguage(pub Mutex<String>);

/// Detect the OS UI language and map it to our supported language codes.
fn get_system_language() -> String {
    if let Some(lang) = detect_os_language() {
        return lang;
    }
    // Fallback: LANG / LANGUAGE env vars (Linux, some CI environments)
    if let Ok(val) = std::env::var("LANG").or_else(|_| std::env::var("LANGUAGE")) {
        let lower = val.to_lowercase();
        if lower.starts_with("zh") {
            return "zh-CN".to_string();
        }
    }
    "en-US".to_string()
}

#[cfg(target_os = "windows")]
fn detect_os_language() -> Option<String> {
    extern "system" {
        fn GetUserDefaultUILanguage() -> u16;
    }
    let langid = unsafe { GetUserDefaultUILanguage() };
    let primary = langid & 0x3FF;
    if primary == 0x04 {
        Some("zh-CN".to_string())
    } else {
        Some("en-US".to_string())
    }
}

#[cfg(target_os = "macos")]
fn detect_os_language() -> Option<String> {
    let output = std::process::Command::new("defaults")
        .args(["read", "-g", "AppleLanguages"])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&output.stdout).to_lowercase();
    if text.contains("zh") {
        Some("zh-CN".to_string())
    } else {
        Some("en-US".to_string())
    }
}

#[cfg(target_os = "linux")]
fn detect_os_language() -> Option<String> {
    None
}

fn t<'a>(key: &'a str, lang: &str) -> &'a str {
    let is_zh = lang.starts_with("zh");
    match key {
        "toggle" => {
            if is_zh {
                "显示 / 隐藏"
            } else {
                "Show / Hide"
            }
        }
        "settings" => {
            if is_zh {
                "设置"
            } else {
                "Settings"
            }
        }
        "pause" => {
            if is_zh {
                "暂停记录"
            } else {
                "Pause Recording"
            }
        }
        "resume" => {
            if is_zh {
                "继续记录"
            } else {
                "Resume Recording"
            }
        }
        "quit" => {
            if is_zh {
                "退出"
            } else {
                "Quit"
            }
        }
        "tooltip" => {
            if is_zh {
                "Qollect"
            } else {
                "Qollect"
            }
        }
        "tooltip_paused" => {
            if is_zh {
                "Qollect (记录已暂停)"
            } else {
                "Qollect (Recording Paused)"
            }
        }
        _ => key,
    }
}

fn load_tray_icon(app: &AppHandle, is_paused: bool) -> Image<'static> {
    let icon_candidates: &[&str] = if is_paused {
        &[
            "icons/icon-disconnected-32.png",
            "icons/32x32.png",
            "icons/icon.png",
        ]
    } else {
        &["icons/32x32.png", "icons/icon.png"]
    };

    for icon_path in icon_candidates {
        if let Ok(icon) = Image::from_path(icon_path).or_else(|_| {
            let resource_dir = app.path().resource_dir().unwrap_or_default();
            Image::from_path(resource_dir.join(icon_path))
        }) {
            return icon;
        }
    }

    let fallback = if is_paused {
        include_bytes!("../icons/icon-disconnected-32.png").as_slice()
    } else {
        include_bytes!("../icons/32x32.png").as_slice()
    };
    Image::from_bytes(fallback).unwrap()
}

/// Build a tray menu for the given language and pause state.
fn build_tray_menu(
    app: &AppHandle,
    lang: &str,
    is_paused: bool,
) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    let show_hide = MenuItemBuilder::with_id("toggle", t("toggle", lang)).build(app)?;
    let settings = MenuItemBuilder::with_id("settings", t("settings", lang)).build(app)?;
    let pause_text = if is_paused {
        t("resume", lang)
    } else {
        t("pause", lang)
    };
    let pause = MenuItemBuilder::with_id("pause", pause_text).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", t("quit", lang)).build(app)?;

    MenuBuilder::new(app)
        .item(&show_hide)
        .separator()
        .item(&settings)
        .item(&pause)
        .separator()
        .item(&quit)
        .build()
}

pub fn setup_tray(
    app: &AppHandle,
    config_language: Option<&str>,
) -> Result<(), Box<dyn std::error::Error>> {
    let lang = match config_language {
        Some(l) if !l.is_empty() => l.to_string(),
        _ => get_system_language(),
    };

    if let Some(lang_state) = app.try_state::<TrayLanguage>() {
        *lang_state.0.lock() = lang.clone();
    } else {
        app.manage(TrayLanguage(Mutex::new(lang.clone())));
    }

    let menu = build_tray_menu(app, &lang, false)?;
    let icon = load_tray_icon(app, false);

    if let Some(existing_tray) = app.tray_by_id("main") {
        let _ = existing_tray.set_menu(Some(menu));
        let _ = existing_tray.set_tooltip(Some(t("tooltip", &lang)));
        let _ = existing_tray.set_icon(Some(icon));
        return Ok(());
    }

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip(t("tooltip", &lang))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| {
            let current_lang = app
                .try_state::<TrayLanguage>()
                .map(|s| s.0.lock().clone())
                .unwrap_or_else(|| "en-US".to_string());

            match event.id().as_ref() {
                "toggle" => {
                    toggle_main_window(app);
                }
                "settings" => {
                    let app_handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        cancel_main_window_release(&app_handle, "tray_settings_show");
                        match ensure_main_window(&app_handle) {
                            Ok(window) => {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                            Err(error) => {
                                eprintln!(
                                    "[Tray] failed to ensure main window for settings: {}",
                                    error
                                );
                            }
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
                        let _ = app_handle.emit("open-settings", ());
                    });
                }
                "pause" => {
                    if let Some(manager) = app.try_state::<Arc<ClipboardManager>>() {
                        let is_paused = manager.is_paused();
                        if is_paused {
                            manager.resume();
                        } else {
                            manager.pause();
                        }
                        let new_paused = !is_paused;
                        // Rebuild menu with updated pause label
                        if let Some(tray) = app.tray_by_id("main") {
                            if let Ok(new_menu) = build_tray_menu(app, &current_lang, new_paused) {
                                let _ = tray.set_menu(Some(new_menu));
                            }
                            let tooltip = if new_paused {
                                t("tooltip_paused", &current_lang)
                            } else {
                                t("tooltip", &current_lang)
                            };
                            let _ = tray.set_tooltip(Some(tooltip));

                            let _ = tray.set_icon(Some(load_tray_icon(app, new_paused)));
                        }
                    }
                }
                "quit" => {
                    if let Some(exit_state) = app.try_state::<AppExitState>() {
                        exit_state.mark_user_requested_exit();
                    }
                    app.exit(0);
                }
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                toggle_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Update tray menu text when the user changes language in settings.
pub fn update_tray_language(app: &AppHandle, lang: &str) {
    // Update shared language state
    if let Some(lang_state) = app.try_state::<TrayLanguage>() {
        *lang_state.0.lock() = lang.to_string();
    }

    let is_paused = app
        .try_state::<Arc<ClipboardManager>>()
        .map(|m| m.is_paused())
        .unwrap_or(false);

    // Rebuild and replace the entire menu
    let Some(tray) = app.tray_by_id("main") else {
        return;
    };
    if let Ok(new_menu) = build_tray_menu(app, lang, is_paused) {
        let _ = tray.set_menu(Some(new_menu));
    }
    let tooltip = if is_paused {
        t("tooltip_paused", lang)
    } else {
        t("tooltip", lang)
    };
    let _ = tray.set_tooltip(Some(tooltip));
}

fn toggle_main_window(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(window) = app_handle.get_webview_window(MAIN_WINDOW_LABEL) {
            let is_visible = window.is_visible().unwrap_or(false);
            let is_minimized = window.is_minimized().unwrap_or(false);

            if is_visible && !is_minimized {
                hide_main_window_with_release(&app_handle, "tray_toggle_hide");
                return;
            }
        }

        cancel_main_window_release(&app_handle, "tray_toggle_show");
        match ensure_main_window(&app_handle) {
            Ok(window) => {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            Err(error) => {
                eprintln!("[Tray] failed to ensure main window on toggle: {}", error);
            }
        }
    });
}

pub fn perform_shutdown(app: &tauri::AppHandle) {
    println!("[Shutdown] Cleaning up tray icon");
    if let Some(_tray) = app.tray_by_id("main") {
        let _ = app.remove_tray_by_id("main");
    }

    if let Some(mcp_state) = app.try_state::<crate::commands::mcp_commands::McpState>() {
        if let Some(server) = &mcp_state.server {
            let server_clone = Arc::clone(server);
            tauri::async_runtime::block_on(async move {
                server_clone.shutdown().await;
            });
        }
    }

    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    let db_path = app_dir.join("qollect.db");
    crate::core::db_obfuscate::obfuscate_db(&db_path);
}
