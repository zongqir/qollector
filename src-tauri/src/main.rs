#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod commands;
mod config;
mod core;
mod mcp;
mod ocr;
mod platform;
mod repository;
mod shortcuts;
mod startup_metrics;
mod tray;

use commands::ai_commands::*;
use commands::clipboard_commands::*;
use commands::drag_drop_commands::*;
use commands::export_commands::*;
use commands::general_commands::*;
use commands::lock_commands::*;
use commands::mcp_commands::*;
use commands::native_drag_commands::*;
use commands::ocr_commands::*;
use core::clipboard_manager::ClipboardManager;
use repository::clipboard_repo::ClipboardRepository;
use repository::config_repo::ConfigRepository;
use shortcuts::{apply_shortcut_config, ShortcutAction, ShortcutBindingState};
use startup_metrics::StartupMetricsState;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;
use tauri::Manager;
use tokio::sync::Mutex as TokioMutex;

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

fn main() {
    let startup_metrics = Arc::new(StartupMetricsState::new());
    let startup_metrics_for_setup = startup_metrics.clone();

    // WebView2 内存优化：通过 Chromium 启动参数降低内存占用
    // ClipBox 是剪贴板管理器，大量 Web 功能用不到，全部关掉
    std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", [
        // === 进程与内存 ===
        "--js-flags=--max-old-space-size=128 --lite-mode", // V8 堆上限 128MB + 精简模式
        "--renderer-process-limit=1",            // 限制渲染进程数
        // === 禁用不需要的 Chromium 功能 ===
        "--disable-features=RendererCodeIntegrity,MediaRouter,WebRtcHideLocalIpsWithMdns,SpareRendererForSitePerProcess,AutofillServerCommunication,InterestFeedContentSuggestions,Translate,OptimizationHints,ServiceWorkerPaymentApps,WebPayments,WebOTP",
        "--disable-background-networking",       // 后台网络
        "--disable-component-update",            // 组件更新
        "--disable-domain-reliability",          // 域名监控
        "--no-pings",                            // 超链接审计
        "--disable-breakpad",                    // 崩溃报告
        // === 禁用 Web API（ClipBox 不需要） ===
        "--disable-speech-api",                  // 语音识别/合成
        "--disable-notifications",               // 系统通知（用 Tauri 原生通知）
        "--disable-webgl",                       // WebGL（不做 3D 渲染）
        "--disable-webgl2",                      // WebGL2
        "--disable-client-side-phishing-detection", // 钓鱼检测
        "--disable-sync",                        // 账号同步
        "--disable-translate",                   // 翻译功能
        "--disable-default-apps",                // 默认应用
        "--disable-extensions",                  // 扩展系统
        "--disable-hang-monitor",                // 挂起监控
        "--disable-popup-blocking",              // 弹窗拦截
        "--disable-prompt-on-repost",            // 重复提交提示
        // === GPU 缓存 ===
        "--disable-gpu-shader-disk-cache",       // 着色器缓存
        "--gpu-disk-cache-size-kb=1",            // GPU 磁盘缓存最小化
    ].join(" "));

    tauri::Builder::default()
        .manage(startup_metrics)
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 当尝试启动第二个实例时，聚焦到现有窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
                println!("[SingleInstance] 检测到重复启动，已聚焦到现有窗口");
            }
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

            let db_path = app_dir.join("clipbox.db");
            println!("Database path: {:?}", db_path);

            // 获取主窗口并确保拖放已启用
            if let Some(_window) = app.get_webview_window("main") {
                println!("设置窗口拖放功能...");
                // Tauri v2 中拖放应该通过配置自动启用
                // 但我们可以验证窗口是否正确创建
                println!("主窗口已创建");
            } else {
                eprintln!("警告: 无法获取主窗口");
            }

            // 启动时恢复数据库文件头
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

                println!("Database initialized successfully");

                // 初始化配置仓库
                let config_repo = Arc::new(ConfigRepository::new(repository.pool().clone()));
                config_repo
                    .init_table()
                    .await
                    .expect("Failed to initialize config table");
                println!("Config repository initialized");
                init_meter.mark("init_config_repo");

                let platform = platform::create_platform().expect("Failed to initialize clipboard");
                init_meter.mark("create_platform");

                // 加载或初始化 AI 配置
                let (ai_config_opt, ocr_config_opt, mcp_config_opt, general_config_opt) =
                    tokio::try_join!(
                        config_repo.load_ai_config(),
                        config_repo.load_ocr_config(),
                        config_repo.load_mcp_config(),
                        config_repo.load_general_config()
                    )
                    .expect("Failed to load startup configs");
                init_meter.mark("load_startup_configs");
                let general_config = general_config_opt.unwrap_or_default();

                let ai_config = ai_config_opt.unwrap_or_default();
                println!("AI config loaded: enabled={}", ai_config.enabled);

                let ai_config_arc = Arc::new(Mutex::new(ai_config.clone()));
                let ai_state = AIState {
                    config: ai_config_arc.clone(),
                    config_repo: config_repo.clone(),
                };

                // 加载或初始化 OCR 配置
                let ocr_config = ocr_config_opt.unwrap_or_default();
                println!(
                    "OCR config loaded: enabled={}, provider={:?}",
                    ocr_config.enabled, ocr_config.current_provider
                );

                // 初始化 OCR 服务
                let ocr_service_arc = Arc::new(Mutex::new(None));
                let ocr_state = OcrState {
                    service: ocr_service_arc.clone(),
                    config_repo: config_repo.clone(),
                };

                // 加载或初始化 MCP 配置
                let mcp_config = mcp_config_opt.unwrap_or_default();
                println!("MCP config loaded: enabled={}", mcp_config.enabled);

                let mcp_config_arc = Arc::new(TokioMutex::new(mcp_config.clone()));

                // 克隆 app_dir 用于后续使用
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

                // 启动 MCP 服务器 (如果启用)
                let mcp_state = if mcp_config.enabled {
                    let mcp_server = Arc::new(mcp::McpServer::new(
                        mcp_config_arc.clone(),
                        manager.clone(),
                        app_dir_for_mcp,
                    ));

                    let server_clone = mcp_server.clone();
                    tokio::spawn(async move {
                        if let Err(e) = server_clone.start().await {
                            eprintln!("[MCP] 服务器启动失败: {}", e);
                        }
                    });

                    println!("[MCP] 服务器已启动");
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
                                *ocr_service_slot.lock().unwrap() = Some(service.clone());
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
                app.manage(drag_out_backend);
                app.manage(ai_state);
                app.manage(ocr_state);
                app.manage(mcp_state);
                app.manage(shortcut_binding_state_for_setup);
                init_meter.mark("register_states");
                startup_metrics_for_core_init.mark_core_init_complete();

                let manager_for_monitor = manager.clone();
                tokio::spawn(async move {
                    println!("Starting clipboard monitoring...");
                    if let Err(error) = manager_for_monitor.start_monitoring().await {
                        eprintln!("Failed to start clipboard monitoring: {}", error);
                    }
                });
                init_meter.mark("spawn_clipboard_monitor");
                startup_metrics_for_core_init.mark_monitor_spawn_complete();
                general_config
            });

            setup_meter.mark("setup_complete");
            startup_metrics_for_setup.mark_setup_complete();

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
                                ShortcutAction::CopyPin => {
                                    let app_handle = app.clone();
                                    tauri::async_runtime::spawn(async move {
                                        if let Some(manager) =
                                            app_handle.try_state::<Arc<ClipboardManager>>()
                                        {
                                            match manager.copy_and_pin_foreground_selection().await {
                                                Ok(id) => {
                                                    println!("[Shortcut] Pinned clipboard item: {}", id);
                                                    let _ = app_handle.emit("clipboard-changed", ());
                                                }
                                                Err(e) => {
                                                    eprintln!("[Shortcut] Failed to pin clipboard: {}", e);
                                                }
                                            }
                                        }
                                    });
                                }
                                ShortcutAction::ToggleWindow => {
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
            tray::setup_tray(&app_handle_for_shortcuts)?;
            setup_meter.mark("setup_tray");

            Ok(())
        })
        .on_window_event(|window, event| {
            // Intercept close on main window: hide to tray instead
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_recent_items,
            get_recent_items_light,
            get_more_items,
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
            toggle_favorite_item,
            open_item,
            open_url,
            reveal_in_folder,
            save_image_as,
            search_items,
            get_mcp_config,
            get_mcp_port,
            update_mcp_config,
            test_mcp_connection,
            shutdown_mcp_server,
            get_mcp_current_port,
            get_general_config,
            update_general_config,
            get_startup_metrics,
            has_lock_password,
            verify_lock_password,
            set_lock_password,
            reset_all_data,
            export_data,
            import_data,
            clear_all_data,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                println!("[Shutdown] Application exiting");
                tray::perform_shutdown(app);
            }
        });
}
// test
