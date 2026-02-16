use std::sync::Arc;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};

use crate::core::clipboard_manager::ClipboardManager;

// Get system language or default to English
fn get_system_language() -> String {
    std::env::var("LANG")
        .or_else(|_| std::env::var("LANGUAGE"))
        .unwrap_or_else(|_| "en".to_string())
        .split('.')
        .next()
        .unwrap_or("en")
        .to_lowercase()
}

// Localized strings
fn t(key: &str, lang: &str) -> &'static str {
    let is_zh = lang.starts_with("zh");
    match key {
        "toggle" => if is_zh { "显示 / 隐藏" } else { "Show / Hide" },
        "settings" => if is_zh { "设置" } else { "Settings" },
        "pause" => if is_zh { "暂停监听" } else { "Pause Monitoring" },
        "resume" => if is_zh { "恢复监听" } else { "Resume Monitoring" },
        "quit" => if is_zh { "退出" } else { "Quit" },
        "tooltip" => if is_zh { "ClipBox" } else { "ClipBox" },
        "tooltip_paused" => if is_zh { "ClipBox (已暂停)" } else { "ClipBox (Paused)" },
        _ => key,
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let lang = get_system_language();

    let show_hide = MenuItemBuilder::with_id("toggle", t("toggle", &lang)).build(app)?;
    let settings = MenuItemBuilder::with_id("settings", t("settings", &lang)).build(app)?;
    let pause = MenuItemBuilder::with_id("pause", t("pause", &lang)).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", t("quit", &lang)).build(app)?;

    let menu = MenuBuilder::new(app)
        .item(&show_hide)
        .separator()
        .item(&settings)
        .item(&pause)
        .separator()
        .item(&quit)
        .build()?;

    let icon = Image::from_path("icons/icon.png")
        .or_else(|_| {
            let resource_dir = app.path().resource_dir().unwrap_or_default();
            Image::from_path(resource_dir.join("icons/icon.png"))
        })
        .unwrap_or_else(|_| Image::from_bytes(include_bytes!("../icons/icon.png")).unwrap());

    let pause_item = pause.clone();
    let lang_clone = lang.clone();

    TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip(t("tooltip", &lang))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "toggle" => {
                toggle_main_window(app);
            }
            "settings" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
                let _ = app.emit("open-settings", ());
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
                    let text = if new_paused { t("resume", &lang_clone) } else { t("pause", &lang_clone) };
                    let _ = pause_item.set_text(text);
                    if let Some(tray) = app.tray_by_id("main") {
                        let tooltip = if new_paused { t("tooltip_paused", &lang_clone) } else { t("tooltip", &lang_clone) };
                        let _ = tray.set_tooltip(Some(tooltip));

                        // Update tray icon based on pause state
                        let icon_path = if new_paused {
                            "icons/icon-disconnected-32.png"
                        } else {
                            "icons/icon.png"
                        };

                        if let Ok(new_icon) = Image::from_path(icon_path)
                            .or_else(|_| {
                                let resource_dir = app.path().resource_dir().unwrap_or_default();
                                Image::from_path(resource_dir.join(icon_path))
                            })
                        {
                            let _ = tray.set_icon(Some(new_icon));
                        }
                    }
                }
            }
            "quit" => {
                perform_shutdown(app);
                app.exit(0);
            }
            _ => {}
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

fn toggle_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let is_visible = window.is_visible().unwrap_or(false);
        let is_minimized = window.is_minimized().unwrap_or(false);

        if is_visible && !is_minimized {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }
}

pub fn perform_shutdown(app: &tauri::AppHandle) {
    // Shutdown MCP server
    if let Some(mcp_state) = app.try_state::<crate::commands::mcp_commands::McpState>() {
        if let Some(server) = &mcp_state.server {
            let server_clone = Arc::clone(server);
            tauri::async_runtime::block_on(async move {
                server_clone.shutdown().await;
            });
        }
    }

    // Obfuscate database on exit
    let app_dir = app
        .path()
        .app_data_dir()
        .expect("Failed to get app data dir");
    let db_path = app_dir.join("clipbox.db");
    crate::core::db_obfuscate::obfuscate_db(&db_path);
}
