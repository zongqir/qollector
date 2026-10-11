#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

mod ai;
mod commands;
mod collector;
mod config;
mod copy_on_select;
mod core;
mod crash_log;
mod http_client;
mod mcp;
mod ocr;
mod platform;
mod quick_action;
mod repository;
mod share;
mod shortcuts;
mod startup_metrics;
mod tray;
mod window_lifecycle;

use commands::ai_commands::*;
use commands::clipboard_commands::*;
use commands::collector_commands::*;
use commands::drag_drop_commands::*;
use commands::export_commands::*;
use commands::general_commands::*;
use commands::input_access_probe_commands::*;
use commands::lock_commands::*;
use commands::mcp_commands::*;
use commands::native_drag_commands::*;
use commands::ocr_commands::*;
use commands::prompt_commands::*;
use commands::share_commands::*;
use commands::workbench_commands::*;
use copy_on_select::{start_copy_on_select_monitor, CopyOnSelectState};
use core::clipboard_manager::ClipboardManager;
use parking_lot::Mutex;
use repository::clipboard_repo::ClipboardRepository;
use repository::config_repo::ConfigRepository;
use shortcuts::{apply_shortcut_config, ShortcutAction, ShortcutBindingState};
use startup_metrics::StartupMetricsState;
use std::sync::Arc;
use std::time::Instant;
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt;
use tokio::sync::Mutex as TokioMutex;
use window_lifecycle::{
    ensure_main_window, hide_main_window, AppExitState, MAIN_WINDOW_LABEL,
};

struct StartupMeter {
    scope: &'static str,
    started_at: Instant,
    last_mark_at: Instant,
}

impl StartupMeter {
    fn new(scope: &'static str) -> Self {
        let now = Instant::now();
        println!("[Startup:{}] begin", scope);
        Self {
            scope,
            started_at: now,
            last_mark_at: now,
        }
    }

    fn mark(&mut self, stage: &'static str) {
        let now = Instant::now();
        let step_ms = now.duration_since(self.last_mark_at).as_millis();
        let total_ms = now.duration_since(self.started_at).as_millis();
        println!(
            "[Startup:{}] {} (+{} ms, total {} ms)",
            self.scope, stage, step_ms, total_ms
        );
        self.last_mark_at = now;
    }
}

fn overlap_area(a: (i32, i32, i32, i32), b: (i32, i32, i32, i32)) -> i64 {
    let ax2 = a.0 + a.2;
    let ay2 = a.1 + a.3;
    let bx2 = b.0 + b.2;
    let by2 = b.1 + b.3;

    let x_overlap = (ax2.min(bx2) - a.0.max(b.0)).max(0) as i64;
    let y_overlap = (ay2.min(by2) - a.1.max(b.1)).max(0) as i64;
    x_overlap * y_overlap
}

fn choose_window_position_near_cursor(
    cursor_x: i32,
    cursor_y: i32,
    win_w: i32,
    win_h: i32,
    scr_x: i32,
    scr_y: i32,
    scr_w: i32,
    scr_h: i32,
) -> (i32, i32) {
    let gap = 18;
    let avoid_rect = (cursor_x - 150, cursor_y - 38, 300, 84);

    let max_x = scr_x + (scr_w - win_w).max(0);
    let max_y = scr_y + (scr_h - win_h).max(0);

    let candidates = [
        (cursor_x + gap, cursor_y + gap),
        (cursor_x + gap, cursor_y - win_h - gap),
        (cursor_x - win_w - gap, cursor_y + gap),
        (cursor_x - win_w - gap, cursor_y - win_h - gap),
        (cursor_x + gap, cursor_y - (win_h / 2)),
        (cursor_x - win_w - gap, cursor_y - (win_h / 2)),
    ];

    let mut best = (scr_x, scr_y);
    let mut best_score = (i64::MAX, i64::MAX, i64::MAX);

    for (raw_x, raw_y) in candidates {
        let x = raw_x.clamp(scr_x, max_x);
        let y = raw_y.clamp(scr_y, max_y);

        let win_rect = (x, y, win_w, win_h);
        let overlap = overlap_area(win_rect, avoid_rect);
        let clamp_penalty = (x - raw_x).abs() as i64 + (y - raw_y).abs() as i64;
        let proximity = ((x - cursor_x).abs() + (y - cursor_y).abs()) as i64;

        let score = (overlap, clamp_penalty, proximity);
        if score < best_score {
            best = (x, y);
            best_score = score;
        }
    }

    best
}

fn show_main_window_near_cursor(app: &tauri::AppHandle) {
    let window = match ensure_main_window(app) {
        Ok(window) => window,
        Err(error) => {
            eprintln!(
                "[MainWindow] failed to ensure main window for shortcut show: {}",
                error
            );
            return;
        }
    };

    if let Ok(size) = window.outer_size() {
        let cursor = platform::cursor::get_cursor_position();
        let mon = window
            .available_monitors()
            .ok()
            .and_then(|monitors| {
                monitors.into_iter().find(|m| {
                    let pos = m.position();
                    let sz = m.size();
                    let right = pos.x + sz.width as i32;
                    let bottom = pos.y + sz.height as i32;
                    cursor.x >= pos.x && cursor.x < right && cursor.y >= pos.y && cursor.y < bottom
                })
            })
            .or_else(|| window.current_monitor().ok().flatten())
            .or_else(|| window.primary_monitor().ok().flatten());

        let (scr_x, scr_y, scr_w, scr_h) = if let Some(m) = mon {
            let pos = m.position();
            let sz = m.size();
            (pos.x, pos.y, sz.width as i32, sz.height as i32)
        } else {
            (0, 0, 3840, 2160)
        };

        let win_w = size.width as i32;
        let win_h = size.height as i32;

        let (x, y) = choose_window_position_near_cursor(
            cursor.x, cursor.y, win_w, win_h, scr_x, scr_y, scr_w, scr_h,
        );

        let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    }

    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

fn toggle_main_window_from_shortcut(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
            let is_visible = window.is_visible().unwrap_or(false);
            let is_minimized = window.is_minimized().unwrap_or(false);

            if is_visible && !is_minimized {
                hide_main_window(&app);
                return;
            }
        }

        show_main_window_near_cursor(&app);
    });
}

fn log_runtime_diagnostics(stage: &str, snapshot: &RuntimeDiagnosticsSnapshot) {
    let app_mb = snapshot.app_memory_bytes as f64 / 1024.0 / 1024.0;
    let webview_mb = snapshot.webview2_memory_bytes_total as f64 / 1024.0 / 1024.0;

    println!(
        "[RuntimeDiag:{}] app_pid={} app_mem_mb={:.1} descendants={} webview2_count={} webview2_mem_mb={:.1} windows={}",
        stage,
        snapshot.app_pid,
        app_mb,
        snapshot.descendant_process_count,
        snapshot.webview2_process_count,
        webview_mb,
        snapshot.windows.len()
    );

    if let Some(browser_host_pid) = snapshot.webview2_browser_host_pid {
        println!(
            "[RuntimeDiag:{}] webview2 browser_host_pid={}",
            stage, browser_host_pid
        );
    }

    for role in &snapshot.webview2_role_summary {
        println!(
            "[RuntimeDiag:{}] webview2 role={} count={} mem_mb={:.1} vmem_mb={:.1}",
            stage,
            role.role,
            role.process_count,
            role.memory_bytes_total as f64 / 1024.0 / 1024.0,
            role.virtual_memory_bytes_total as f64 / 1024.0 / 1024.0
        );
    }

    for p in snapshot.webview2_processes.iter().take(10) {
        println!(
            "[RuntimeDiag:{}] webview2 pid={} parent={:?} role={} role_source={} role_confidence={} utility_sub_type={:?} mem_mb={:.1} vmem_mb={:.1} cpu={:.1} exe={:?} cmd={}",
            stage,
            p.pid,
            p.parent_pid,
            p.process_role,
            p.role_source,
            p.role_confidence,
            p.utility_sub_type,
            p.memory_bytes as f64 / 1024.0 / 1024.0,
            p.virtual_memory_bytes as f64 / 1024.0 / 1024.0,
            p.cpu_usage_percent,
            p.exe_path,
            p.command_line_preview
        );
    }

    for w in snapshot
        .windows
        .iter()
        .filter(|w| w.visible || !w.title.is_empty())
    {
        println!(
            "[RuntimeDiag:{}] window handle={} visible={} size={}x{} pos=({}, {}) title={}",
            stage, w.handle, w.visible, w.width, w.height, w.x, w.y, w.title
        );
    }
}

fn main() {
    crash_log::install_panic_hook();

    let startup_metrics = Arc::new(StartupMetricsState::new());
    let startup_metrics_for_setup = startup_metrics.clone();

    // WebView2 memory tuning via Chromium startup arguments.
    // Qollect does not rely on most browser capabilities.
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", [
        // === Process and memory ===
        "--js-flags=--max-old-space-size=64 --lite-mode --optimize-for-size", // V8 heap cap + lite mode + smaller code
        "--renderer-process-limit=1",            // Limit renderer process count
        "--process-per-site",                    // Share renderer across same-origin pages
        // === Memory pressure ===
        "--enable-aggressive-domstorage-flushing", // Flush DOM storage sooner
        "--memory-pressure-thresholds-mb=128:256", // Trigger GC earlier (moderate:critical)
        // === Disable unneeded Chromium features ===
        "--disable-features=RendererCodeIntegrity,MediaRouter,WebRtcHideLocalIpsWithMdns,SpareRendererForSitePerProcess,AutofillServerCommunication,InterestFeedContentSuggestions,Translate,OptimizationHints,ServiceWorkerPaymentApps,WebPayments,WebOTP,BackForwardCache,IdleDetection,WebUSB,WebBluetooth",
        "--disable-background-networking",       // Background networking
        "--disable-component-update",            // Component updater
        "--disable-domain-reliability",          // Domain reliability
        "--no-pings",                            // Hyperlink auditing
        "--disable-breakpad",                    // Crash reporting
        // === Disable unused Web APIs ===
        "--disable-speech-api",                  // Speech APIs
        "--disable-notifications",               // Browser notifications
        "--disable-webgl",                       // WebGL
        "--disable-webgl2",                      // WebGL2
        "--disable-client-side-phishing-detection", // Phishing detection
        "--disable-sync",                        // Account sync
        "--disable-translate",                   // Translation
        "--disable-default-apps",               // Default apps
        "--disable-extensions",                  // Extension system
        "--disable-hang-monitor",                // Hang monitor
        "--disable-popup-blocking",              // Popup blocker
        "--disable-prompt-on-repost",            // Repost prompts
        // === GPU memory ===
        "--disable-gpu-shader-disk-cache",       // Shader disk cache
        "--gpu-disk-cache-size-kb=1",            // Minimal GPU disk cache
        "--force-gpu-mem-available-mb=64",       // Limit GPU memory budget
        "--disable-gpu-compositing",             // CPU compositing (saves GPU memory, OK for simple UI)
    ].join(" "));

    tauri::Builder::default()
        .manage(AppExitState::default())
        .manage(startup_metrics)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                match ensure_main_window(&app_handle) {
                    Ok(window) => {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                        println!(
                            "[SingleInstance] detected duplicate launch and focused existing window"
                        );
                    }
                    Err(error) => {
                        eprintln!(
                            "[SingleInstance] failed to focus main window on duplicate launch: {}",
                            error
                        );
                    }
                }
            });
        }))
        .setup(move |app| {
            let mut setup_meter = StartupMeter::new("setup");
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");
            setup_meter.mark("resolve_app_dir");

            println!("App data directory: {:?}", app_dir);

            std::fs::create_dir_all(&app_dir).expect("Failed to create app directory");
            setup_meter.mark("ensure_app_dir");

            let db_path = app_dir.join("qollect.db");
            println!("Database path: {:?}", db_path);

            // Verify main window is available during setup.
            if let Some(_window) = app.get_webview_window("main") {
                println!("[Window] main window is ready");
            } else {
                eprintln!("[Window] warning: failed to get main window in setup");
            }

            // Restore database file header during startup.
            core::db_obfuscate::deobfuscate_db(&db_path);
            setup_meter.mark("db_deobfuscate");

            let app_handle_for_shortcuts = app.app_handle().clone();
            let shortcut_binding_state = Arc::new(ShortcutBindingState::default());
            let shortcut_binding_state_for_setup = shortcut_binding_state.clone();
            let startup_metrics_for_core_init = startup_metrics_for_setup.clone();
            let startup_general_config = tauri::async_runtime::block_on(async move {
                let mut init_meter = StartupMeter::new("core_init");
                let repository = ClipboardRepository::new(db_path)
                    .await
                    .expect("Failed to initialize database");
                init_meter.mark("open_repository");

                println!("[DB] initialized");

                // Initialize config repository.
                let config_repo = Arc::new(ConfigRepository::new(repository.pool().clone()));
                config_repo
                    .init_table()
                    .await
                    .expect("Failed to initialize config table");
                println!("Config repository initialized");
                init_meter.mark("init_config_repo");

                let platform = platform::create_platform().expect("Failed to initialize clipboard");
                init_meter.mark("create_platform");

                // Load startup AI/OCR/MCP/general configs.
                let (
                    ai_config_opt,
                    ocr_config_opt,
                    mcp_config_opt,
                    general_config_opt,
                ) =
                    tokio::try_join!(
                        config_repo.load_ai_config(),
                        config_repo.load_ocr_config(),
                        config_repo.load_mcp_config(),
                        config_repo.load_general_config()
                    )
                    .expect("Failed to load startup configs");
                init_meter.mark("load_startup_configs");
                let is_first_run_general_config = general_config_opt.is_none();
                let general_config = general_config_opt.unwrap_or_default();
                if is_first_run_general_config {
                    if let Err(error) = config_repo.save_general_config(&general_config).await {
                        eprintln!(
                            "[Config] failed to persist first-run general config defaults: {}",
                            error
                        );
                    }
                }

                let ai_config = ai_config_opt.unwrap_or_default();
                println!("AI config loaded: enabled={}", ai_config.enabled);

                let ai_config_arc = Arc::new(Mutex::new(ai_config.clone()));
                let ai_state = AIState {
                    config: ai_config_arc.clone(),
                    config_repo: config_repo.clone(),
                };

                // OCR config.
                let ocr_config = ocr_config_opt.unwrap_or_default();
                println!(
                    "OCR config loaded: enabled={}, provider={:?}",
                    ocr_config.enabled, ocr_config.current_provider
                );

                // OCR service container.
                let ocr_service_arc = Arc::new(Mutex::new(None));
                let ocr_state = OcrState {
                    service: ocr_service_arc.clone(),
                    config_repo: config_repo.clone(),
                };

                // MCP config.
                let mcp_config = mcp_config_opt.unwrap_or_default();
                println!("MCP config loaded: enabled={}", mcp_config.enabled);

                let mcp_config_arc = Arc::new(TokioMutex::new(mcp_config.clone()));

                // Clone app_dir for MCP server usage.
                let app_dir_for_mcp = app_dir.clone();

                let manager = Arc::new(ClipboardManager::new(
                    platform,
                    repository,
                    config_repo.clone(),
                    app_dir,
                    ai_config_arc,
                    ocr_service_arc,
                    app.app_handle().clone(),
                ));

                let drag_out_backend = platform::drag_out::create_drag_out_backend();
                init_meter.mark("create_drag_out_backend");

                // Start MCP server if enabled.
                let mcp_state = if mcp_config.enabled {
                    let mcp_server = Arc::new(mcp::McpServer::new(
                        mcp_config_arc.clone(),
                        manager.clone(),
                        app_dir_for_mcp,
                    ));

                    let server_clone = mcp_server.clone();
                    tokio::spawn(async move {
                        if let Err(e) = server_clone.start().await {
                            eprintln!("[MCP] server startup failed: {}", e);
                        }
                    });

                    println!("[MCP] server started");
                    McpState {
                        config: mcp_config_arc.clone(),
                        config_repo: config_repo.clone(),
                        server: Some(mcp_server),
                    }
                } else {
                    McpState {
                        config: mcp_config_arc.clone(),
                        config_repo: config_repo.clone(),
                        server: None,
                    }
                };
                init_meter.mark("prepare_mcp_state");

                let ocr_service_slot = ocr_state.service.clone();
                if ocr_config.enabled {
                    let ocr_config_for_prewarm = ocr_config.clone();
                    let manager_for_prewarm = manager.clone();
                    tokio::spawn(async move {
                        let started = Instant::now();
                        match ocr::OcrService::new(ocr_config_for_prewarm) {
                            Ok(service) => {
                                let provider = service.provider_name().to_string();
                                *ocr_service_slot.lock() = Some(service.clone());
                                manager_for_prewarm.update_ocr_service(Some(service));
                                println!(
                                    "[Startup:ocr_prewarm] ready in {} ms (provider={})",
                                    started.elapsed().as_millis(),
                                    provider
                                );
                            }
                            Err(error) => {
                                eprintln!("[Startup:ocr_prewarm] failed: {}", error);
                            }
                        }
                    });
                }

                app.manage(manager.clone());
                let input_capture_state = Arc::new(InputCaptureState::new(
                    general_config.input_capture_enabled,
                ));
                app.manage(input_capture_state.clone());
                let copy_on_select_state = Arc::new(CopyOnSelectState::new(
                    general_config.copy_on_select_enabled,
                    general_config.copy_on_select_double_click_enabled,
                ));
                app.manage(copy_on_select_state.clone());
                app.manage(drag_out_backend);
                app.manage(ai_state);
                app.manage(ocr_state);
                app.manage(mcp_state);
                app.manage(shortcut_binding_state_for_setup);

                let share_state = ShareState::new(config_repo.clone());
                app.manage(share_state);

                init_meter.mark("register_states");
                startup_metrics_for_core_init.mark_core_init_complete();

                let manager_for_monitor = manager.clone();
                tokio::spawn(async move {
                    println!("Starting clipboard monitoring...");
                    if let Err(error) = manager_for_monitor.start_monitoring().await {
                        eprintln!("Failed to start clipboard monitoring: {}", error);
                    }
                });
                start_input_capture_monitor(manager.clone(), input_capture_state);
                start_copy_on_select_monitor(copy_on_select_state);
                init_meter.mark("spawn_clipboard_monitor");
                startup_metrics_for_core_init.mark_monitor_spawn_complete();
                (general_config, is_first_run_general_config)
            });

            setup_meter.mark("setup_complete");
            startup_metrics_for_setup.mark_setup_complete();

            let (startup_general_config, is_first_run_general_config) = startup_general_config;

            if is_first_run_general_config && startup_general_config.autostart_enabled {
                match app_handle_for_shortcuts.autolaunch().is_enabled() {
                    Ok(true) => {}
                    Ok(false) => {
                        if let Err(error) = app_handle_for_shortcuts.autolaunch().enable() {
                            eprintln!("[Autostart] Failed to enable first-run autostart: {}", error);
                        } else {
                            println!("[Autostart] Enabled by first-run default");
                        }
                    }
                    Err(error) => {
                        eprintln!(
                            "[Autostart] Failed to query first-run autostart state: {}",
                            error
                        );
                    }
                }
            }

            // Register global shortcuts
            #[cfg(desktop)]
            {
                use tauri::Emitter;
                use tauri_plugin_global_shortcut::ShortcutState;

                let app_handle = app_handle_for_shortcuts.clone();
                let shortcut_binding_state_for_handler = shortcut_binding_state.clone();
                let plugin_result = app_handle.plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            if event.state != ShortcutState::Pressed {
                                return;
                            }

                            match shortcut_binding_state_for_handler
                                .action_for_shortcut_id(shortcut.id())
                            {
                                ShortcutAction::ToggleWindow => {
                                    toggle_main_window_from_shortcut(app.clone());
                                }
                                ShortcutAction::None => {}
                            }
                        })
                        .build(),
                );

                if let Err(error) = plugin_result {
                    eprintln!(
                        "[Shortcut] Global shortcut plugin initialization failed. Continue without global shortcuts: {}",
                        error
                    );
                } else if let Err(error) =
                    apply_shortcut_config(&app_handle, &shortcut_binding_state, &startup_general_config)
                {
                    eprintln!("[Shortcut] Failed to apply startup shortcut config: {}", error);
                }
                setup_meter.mark("register_global_shortcuts");
            }

            // Setup system tray
            tray::setup_tray(&app_handle_for_shortcuts, Some(&startup_general_config.language))?;
            setup_meter.mark("setup_tray");

            // Sync autostart state with system
            let app_for_autostart = app_handle_for_shortcuts.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(ai_state) = app_for_autostart.try_state::<AIState>() {
                    if let Ok(Some(mut config)) = ai_state.config_repo.load_general_config().await {
                        if let Ok(is_enabled) = app_for_autostart.autolaunch().is_enabled() {
                            if config.autostart_enabled != is_enabled {
                                println!("[Autostart] Syncing state: DB={}, System={}", config.autostart_enabled, is_enabled);
                                config.autostart_enabled = is_enabled;
                                let _ = ai_state.config_repo.save_general_config(&config).await;
                            }
                        }
                    }
                }
            });

            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(1800)).await;
                let snapshot_early = collect_runtime_diagnostics_snapshot();
                log_runtime_diagnostics("t+1.8s", &snapshot_early);

                tokio::time::sleep(std::time::Duration::from_millis(6200)).await;
                let snapshot_settled = collect_runtime_diagnostics_snapshot();
                log_runtime_diagnostics("t+8.0s", &snapshot_settled);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Intercept close on main window: hide to tray instead
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == MAIN_WINDOW_LABEL {
                    if cfg!(debug_assertions) {
                        println!(
                            "[Shutdown] Main window close requested in debug mode, exiting app"
                        );
                        window.app_handle().exit(0);
                        return;
                    }

                    api.prevent_close();
                    let app_handle = window.app_handle().clone();
                    hide_main_window(&app_handle);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_recent_items,
            get_recent_items_light,
            get_more_items,
            get_workbenches,
            create_workbench,
            rename_workbench,
            delete_workbench,
            get_workbench_pinned_items,
            reorder_workbench_pinned_items,
            get_collection_favorite_items,
            reorder_collection_favorite_items,
            get_item_by_id,
            copy_item,
            copy_plain_text,
            update_item,
            delete_item,
            toggle_pin_item,
            pin_item,
            get_ai_config,
            update_ai_config,
            generate_ai_tags,
            test_ai_connection,
            get_ai_models,
            get_default_ai_model,
            fetch_remote_models,
            ai_search_items,
            init_ocr_service,
            get_ocr_config,
            update_ocr_config,
            recognize_image,
            recognize_and_update,
            check_ocr_available,
            get_ocr_providers,
            add_clipboard_item_manual,
            add_image_file,
            start_native_file_drag,
            start_native_text_drag,
            toggle_favorite_item,
            open_item,
            open_url,
            try_paste_foreground,
            reveal_in_folder,
            save_image_as,
            export_workbench_text,
            search_items,
            get_user_tags,
            get_items_by_date_range,
            get_history_group_counts,
            generate_timeline_summary,
            run_prompt_assistant_task,
            get_mcp_config,
            get_mcp_port,
            update_mcp_config,
            test_mcp_connection,
            shutdown_mcp_server,
            get_mcp_current_port,
            get_general_config,
            update_general_config,
            probe_focused_text,
            get_collector_config,
            update_collector_config,
            test_collector_connection,
            get_collector_upload_status,
            sync_collector_items,
            get_startup_metrics,
            get_runtime_diagnostics,
            analyze_quick_action,
            open_external_url,
            has_lock_password,
            verify_lock_password,
            set_lock_password,
            reset_all_data,
            export_data,
            import_data,
            clear_all_data,
            clear_recent_day_data,
            get_share_config,
            update_share_config,
            get_item_share_data,
            upload_to_free_host,
            generate_qr,
            share_via_s3,
            test_share_s3_connection,
            preview_file,
            open_file_path,
            reveal_file_path,
            crash_log::get_crash_log,
            crash_log::clear_crash_log,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            match event {
                tauri::RunEvent::ExitRequested { api, .. } => {
                    if cfg!(debug_assertions) {
                        println!("[Shutdown] Exit requested in debug mode, allowing app exit");
                        return;
                    }

                    let user_requested_exit = app
                        .try_state::<AppExitState>()
                        .map(|state| state.is_user_requested_exit())
                        .unwrap_or(false);
                    if !user_requested_exit {
                        api.prevent_exit();
                        println!("[Shutdown] Exit requested without explicit quit, keeping app alive");
                    }
                }
                tauri::RunEvent::Exit => {
                    println!("[Shutdown] Application exiting");
                    tray::perform_shutdown(app);
                }
                _ => {}
            }
        });
}
