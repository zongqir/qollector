#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod core;
mod platform;
mod repository;
mod commands;
mod ai;
mod ocr;

use std::sync::Arc;
use core::clipboard_manager::ClipboardManager;
use repository::clipboard_repo::ClipboardRepository;
use platform::clipboard_trait::PlatformClipboard;
use commands::clipboard_commands::*;
use commands::ai_commands::*;
use commands::ocr_commands::*;
use tauri::Manager;
use std::sync::Mutex;

#[cfg(target_os = "windows")]
use platform::windows::windows::WindowsClipboard;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_dir = app.path().app_data_dir()
                .expect("Failed to get app data directory");

            println!("App data directory: {:?}", app_dir);

            std::fs::create_dir_all(&app_dir)
                .expect("Failed to create app directory");

            let db_path = app_dir.join("clipbox.db");
            println!("Database path: {:?}", db_path);

            tauri::async_runtime::block_on(async move {
                let repository = ClipboardRepository::new(db_path)
                    .await
                    .expect("Failed to initialize database");

                println!("Database initialized successfully");

                #[cfg(target_os = "windows")]
                let platform: Arc<dyn PlatformClipboard> = Arc::new(
                    WindowsClipboard::new().expect("Failed to initialize clipboard")
                );

                #[cfg(not(target_os = "windows"))]
                panic!("Unsupported platform");

                let manager = Arc::new(ClipboardManager::new(platform, repository, app_dir));

                println!("Starting clipboard monitoring...");

                manager.start_monitoring()
                    .await
                    .expect("Failed to start clipboard monitoring");

                app.manage(manager);

                // Initialize AI state
                let ai_config = ai::AIConfig::default();
                let ai_state = AIState {
                    config: Arc::new(Mutex::new(ai_config)),
                };
                app.manage(ai_state);

                // Initialize OCR state
                let ocr_state = OcrState::new();
                app.manage(ocr_state);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_recent_items,
            copy_item,
            update_item,
            delete_item,
            get_ai_config,
            update_ai_config,
            generate_ai_tags,
            test_ai_connection,
            init_ocr_service,
            get_ocr_config,
            update_ocr_config,
            recognize_image,
            recognize_and_update,
            check_ocr_available,
            get_ocr_providers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
// test
