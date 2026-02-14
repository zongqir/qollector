#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core;
mod platform;
mod repository;
mod commands;
mod ai;
mod ocr;
mod mcp;
mod config;

use std::sync::Arc;
use core::clipboard_manager::ClipboardManager;
use repository::clipboard_repo::ClipboardRepository;
use repository::config_repo::ConfigRepository;
use commands::clipboard_commands::*;
use commands::ai_commands::*;
use commands::ocr_commands::*;
use commands::drag_drop_commands::*;
use commands::mcp_commands::*;
use commands::general_commands::*;
use tauri::Manager;
use std::sync::Mutex;
use tokio::sync::Mutex as TokioMutex;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 当尝试启动第二个实例时，聚焦到现有窗口
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
                let _ = window.unminimize();
                println!("[SingleInstance] 检测到重复启动，已聚焦到现有窗口");
            }
        }))
        .setup(|app| {
            let app_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");

            println!("App data directory: {:?}", app_dir);

            std::fs::create_dir_all(&app_dir)
                .expect("Failed to create app directory");

            let db_path = app_dir.join("clipbox.db");
            println!("Database path: {:?}", db_path);

            // 获取主窗口并确保拖放已启用
            if let Some(window) = app.get_webview_window("main") {
                println!("设置窗口拖放功能...");
                // Tauri v2 中拖放应该通过配置自动启用
                // 但我们可以验证窗口是否正确创建
                println!("主窗口已创建");
            } else {
                eprintln!("警告: 无法获取主窗口");
            }

            tauri::async_runtime::block_on(async move {
                let repository = ClipboardRepository::new(db_path)
                    .await
                    .expect("Failed to initialize database");

                println!("Database initialized successfully");

                // 初始化配置仓库
                let config_repo = Arc::new(ConfigRepository::new(repository.pool().clone()));
                config_repo.init_table().await
                    .expect("Failed to initialize config table");
                println!("Config repository initialized");

                let platform = platform::create_platform()
                    .expect("Failed to initialize clipboard");

                // 加载或初始化 AI 配置
                let ai_config = config_repo.load_ai_config().await
                    .expect("Failed to load AI config")
                    .unwrap_or_default();
                println!("AI config loaded: enabled={}", ai_config.enabled);

                let ai_config_arc = Arc::new(Mutex::new(ai_config.clone()));
                let ai_state = AIState {
                    config: ai_config_arc.clone(),
                    config_repo: config_repo.clone(),
                };

                // 加载或初始化 OCR 配置
                let ocr_config = config_repo.load_ocr_config().await
                    .expect("Failed to load OCR config")
                    .unwrap_or_default();
                println!("OCR config loaded: enabled={}, provider={:?}", ocr_config.enabled, ocr_config.current_provider);

                // 初始化 OCR 服务
                let ocr_service = if ocr_config.enabled {
                    match ocr::OcrService::new(ocr_config.clone()) {
                        Ok(service) => {
                            println!("OCR service initialized with provider: {}", service.provider_name());
                            Some(service)
                        }
                        Err(e) => {
                            eprintln!("Failed to initialize OCR service: {}", e);
                            None
                        }
                    }
                } else {
                    None
                };

                let ocr_service_arc = Arc::new(Mutex::new(ocr_service.clone()));
                let ocr_state = OcrState {
                    service: Mutex::new(ocr_service),
                    config_repo: config_repo.clone(),
                };

                // 加载或初始化 MCP 配置
                let mcp_config = config_repo.load_mcp_config().await
                    .expect("Failed to load MCP config")
                    .unwrap_or_default();
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
                ));

                println!("Starting clipboard monitoring...");

                manager.start_monitoring()
                    .await
                    .expect("Failed to start clipboard monitoring");

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

                app.manage(manager);
                app.manage(ai_state);
                app.manage(ocr_state);
                app.manage(mcp_state);
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // 监听窗口关闭事件
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                println!("[Shutdown] 窗口关闭事件触发");

                // 获取 MCP 状态并关闭服务器
                let app_handle = window.app_handle();
                if let Some(mcp_state) = app_handle.try_state::<McpState>() {
                    if let Some(server) = &mcp_state.server {
                        let server_clone = Arc::clone(server);
                        tauri::async_runtime::spawn(async move {
                            server_clone.shutdown().await;
                        });
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_recent_items,
            copy_item,
            update_item,
            delete_item,
            toggle_pin_item,
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
            toggle_favorite_item,
            open_item,
            get_mcp_config,
            get_mcp_port,
            update_mcp_config,
            test_mcp_connection,
            shutdown_mcp_server,
            get_mcp_current_port,
            get_general_config,
            update_general_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
// test
