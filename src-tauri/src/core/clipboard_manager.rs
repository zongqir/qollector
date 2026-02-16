use crate::ai::{AIConfig, AIService};
use crate::core::models::{ClipboardContent, ClipboardItem, WindowMetadata};
use crate::ocr::OcrService;
use crate::platform::clipboard_trait::{ClipboardCallback, ClipboardError, PlatformClipboard};
use crate::repository::clipboard_repo::ClipboardRepository;
use crate::repository::config_repo::ConfigRepository;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::{Mutex as TokioMutex, Semaphore};

const DOUBLE_COPY_MIN_INTERVAL_MS: u128 = 180;
const DOUBLE_COPY_COOLDOWN_MS: u128 = 900;

#[derive(Default)]
struct DoubleCopyEmphasisState {
    last_hash: Option<String>,
    last_source_app: Option<String>,
    last_seen_at_ms: u128,
    last_emphasis_at_ms: u128,
}

pub struct ClipboardManager {
    platform: Arc<dyn PlatformClipboard>,
    repository: Arc<TokioMutex<ClipboardRepository>>,
    config_repo: Arc<ConfigRepository>,
    image_dir: PathBuf,
    ai_config: Arc<Mutex<AIConfig>>,
    ocr_config: Arc<Mutex<Option<OcrService>>>,
    ai_semaphore: Arc<Semaphore>, // AI request serialization control
    double_copy_state: Arc<Mutex<DoubleCopyEmphasisState>>,
    app_handle: AppHandle,
}

impl ClipboardManager {
    pub fn new(
        platform: Arc<dyn PlatformClipboard>,
        repository: ClipboardRepository,
        config_repo: Arc<ConfigRepository>,
        app_dir: PathBuf,
        ai_config: Arc<Mutex<AIConfig>>,
        ocr_config: Arc<Mutex<Option<OcrService>>>,
        app_handle: AppHandle,
    ) -> Self {
        let image_dir = app_dir.join("images");
        std::fs::create_dir_all(&image_dir).expect("Failed to create images directory");

        Self {
            platform,
            repository: Arc::new(TokioMutex::new(repository)),
            config_repo,
            image_dir,
            ai_config,
            ocr_config,
            ai_semaphore: Arc::new(Semaphore::new(1)), // 鍙厑璁?涓狝I璇锋眰鍚屾椂鎵ц
            double_copy_state: Arc::new(Mutex::new(DoubleCopyEmphasisState::default())),
            app_handle,
        }
    }

    pub async fn start_monitoring(&self) -> Result<(), ClipboardError> {
        let repo = self.repository.clone();
        let config_repo = self.config_repo.clone();
        let image_dir = self.image_dir.clone();
        let ai_config = self.ai_config.clone();
        let ocr_config = self.ocr_config.clone();
        let ai_semaphore = self.ai_semaphore.clone();
        let double_copy_state = self.double_copy_state.clone();
        let app_handle = self.app_handle.clone();

        let callback: ClipboardCallback = Box::new(move |content, metadata| {
            let repo = repo.clone();
            let config_repo = config_repo.clone();
            let image_dir = image_dir.clone();
            let ai_config = ai_config.clone();
            let ocr_config = ocr_config.clone();
            let ai_semaphore = ai_semaphore.clone();
            let double_copy_state = double_copy_state.clone();
            let app_handle = app_handle.clone();

            Box::pin(async move {
                if let Err(e) = Self::handle_clipboard_change(
                    content,
                    repo,
                    config_repo,
                    metadata,
                    image_dir,
                    ai_config,
                    ocr_config,
                    ai_semaphore,
                    double_copy_state,
                    app_handle,
                )
                .await
                {
                    eprintln!("Error handling clipboard change: {}", e);
                }
                Ok(())
            })
        });

        self.platform.register_listener(callback)?;

        Ok(())
    }

    async fn handle_clipboard_change(
        content: ClipboardContent,
        repo: Arc<TokioMutex<ClipboardRepository>>,
        config_repo: Arc<ConfigRepository>,
        metadata: WindowMetadata,
        image_dir: PathBuf,
        ai_config: Arc<Mutex<AIConfig>>,
        ocr_config: Arc<Mutex<Option<OcrService>>>,
        ai_semaphore: Arc<Semaphore>,
        double_copy_state: Arc<Mutex<DoubleCopyEmphasisState>>,
        app_handle: AppHandle,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("Handling clipboard change...");

        let item = match content {
            ClipboardContent::Text(text) => {
                // 妫€鏌ユ槸鍚︿负绌虹櫧鍐呭
                if text.trim().is_empty() {
                    // 缁熻鎹㈣绗︽暟閲?
                    let newline_count = text.matches('\n').count();

                    // 濡傛灉鎹㈣绗﹀皯浜?涓紝璁や负鏄棤鎰忎箟鐨勭煭绌虹櫧锛岃烦杩?
                    if newline_count < 3 {
                        println!(
                            "Clipboard text is empty or too short (newlines: {}), skipping",
                            newline_count
                        );
                        return Ok(());
                    }

                    // 瓒呰繃3琛岀殑绌虹櫧鍙兘鏈夋剰涔夛紝淇濈暀
                    println!(
                        "Clipboard text is blank but has {} newlines, keeping",
                        newline_count
                    );
                }
                println!("Creating clipboard item for text: {} chars", text.len());
                ClipboardItem::new_text(text, metadata)
            }
            ClipboardContent::Image(data) => {
                println!("Image clipboard content detected, saving...");

                // 璁＄畻鍥剧墖鍐呭鐨凪D5鍝堝笇
                let image_hash = format!("{:x}", md5::compute(&data));

                // Generate unique filename
                let timestamp = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)?
                    .as_millis();
                let filename = format!("{}.png", timestamp);
                let thumb_filename = format!("{}_thumb.png", timestamp);

                let image_path = image_dir.join(&filename);
                let thumb_path = image_dir.join(&thumb_filename);

                // Save original image
                std::fs::write(&image_path, &data)?;
                println!("Image saved to: {:?}", image_path);

                // Generate and save thumbnail
                if let Ok(img) = image::load_from_memory(&data) {
                    // Create thumbnail (max 300x300)
                    let thumbnail = img.thumbnail(300, 300);
                    thumbnail.save(&thumb_path)?;
                    println!("Thumbnail saved to: {:?}", thumb_path);
                } else {
                    // If thumbnail generation fails, copy original
                    std::fs::copy(&image_path, &thumb_path)?;
                }

                // Create clipboard item with both paths
                let image_paths_json = serde_json::json!({
                    "original": image_path.to_string_lossy().to_string(),
                    "thumbnail": thumb_path.to_string_lossy().to_string()
                })
                .to_string();

                let now = chrono::Utc::now().timestamp();
                ClipboardItem {
                    id: uuid::Uuid::new_v4().to_string(),
                    type_: "image".to_string(),
                    content: Some(format!("[Image: {}]", filename)),
                    original_content: None,
                    content_hash: image_hash, // 浣跨敤鍥剧墖鍐呭鐨凪D5
                    image_paths: Some(image_paths_json),
                    ocr_text: None,
                    code_language: None,
                    embedding: None,
                    tags: None,
                    user_note: None,
                    metadata: Some(serde_json::to_string(&metadata).unwrap()),
                    is_pinned: false,
                    is_favorite: false,
                    is_deleted: false,
                    pinned_at: None,
                    created_at: now,
                    updated_at: now,
                }
            }
            ClipboardContent::File(paths_str) => {
                println!("File clipboard content detected");

                let paths: Vec<&str> = paths_str.lines().collect();
                let file_count = paths.len();

                // Create a summary of files
                let file_names: Vec<String> = paths
                    .iter()
                    .map(|p| {
                        std::path::Path::new(p)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or(p)
                            .to_string()
                    })
                    .collect();

                let summary = if file_count == 1 {
                    format!("鏂囦欢: {}", file_names[0])
                } else {
                    format!("{} 涓枃浠? {}", file_count, file_names.join(", "))
                };

                println!("Files: {}", summary);

                let mut item = ClipboardItem::new_text(summary, metadata);
                item.type_ = "file".to_string();
                item.content = Some(paths_str.clone());
                // Use full path payload hash to avoid false collisions on same filename.
                let mut hasher = sha2::Sha256::new();
                use sha2::Digest;
                hasher.update(paths_str.as_bytes());
                item.content_hash = format!("{:x}", hasher.finalize());
                item
            }
        };

        let content_hash = item.content_hash.clone();
        let mut item_id = item.id.clone();
        let mut inserted_new_item = false;

        let repo_lock = repo.lock().await;
        if let Some(existing) = repo_lock.find_by_hash(&content_hash).await? {
            println!("Duplicate detected, moving to top: {}", existing.id);
            repo_lock.touch(&existing.id).await?;
            item_id = existing.id;
        } else {
            println!("Inserting new clipboard item: {}", item.id);
            repo_lock.insert(&item).await?;
            inserted_new_item = true;
        }

        let item_type = item.type_.clone();
        let item_content = item.content.clone();
        let item_image_paths = item.image_paths.clone();
        drop(repo_lock);
        let _ = app_handle.emit("clipboard-changed", ());
        println!("Clipboard item saved successfully!");

        let source_app = item
            .metadata
            .as_ref()
            .and_then(|v| serde_json::from_str::<WindowMetadata>(v).ok())
            .map(|m| m.source_app)
            .unwrap_or_else(|| "Unknown".to_string());

        let general_config = config_repo
            .load_general_config()
            .await
            .ok()
            .flatten()
            .unwrap_or_default();

        if Self::should_pin_on_double_copy(
            &double_copy_state,
            &content_hash,
            &source_app,
            general_config.double_copy_emphasis_enabled,
            general_config.double_copy_window_ms,
        ) {
            let repo_lock = repo.lock().await;
            if let Some(existing) = repo_lock.find_by_id(&item_id).await? {
                if !existing.is_pinned {
                    let pinned_items = repo_lock.get_pinned_items().await?;
                    if pinned_items.len() >= general_config.max_pinned_items {
                        if let Some(oldest_pinned) = pinned_items.first() {
                            repo_lock.unpin(&oldest_pinned.id).await?;
                        }
                    }
                    repo_lock.set_pinned(&item_id, true).await?;
                    let _ = app_handle.emit("clipboard-changed", ());
                }
            }
        }

        // Process AI tags and OCR asynchronously for new items only.
        let repo_clone = repo.clone();
        let config_repo_clone = config_repo.clone();
        let ai_config_clone = ai_config.clone();
        let ocr_config_clone = ocr_config.clone();
        let ai_semaphore_clone = ai_semaphore.clone();

        if inserted_new_item {
            tokio::spawn(async move {
                if item_type == "image" {
                    if let Some(image_paths_str) = item_image_paths {
                        let ocr_service_opt = ocr_config_clone.lock().unwrap().clone();
                        let mut ocr_text = String::new();

                        if let Some(service) = ocr_service_opt {
                            let config = service.get_config();
                            if config.enabled && config.auto_ocr {
                                println!("Auto OCR started: item_id={}", item_id);

                                let image_path = if let Ok(paths) =
                                    serde_json::from_str::<serde_json::Value>(&image_paths_str)
                                {
                                    paths["original"].as_str().unwrap_or("").to_string()
                                } else {
                                    image_paths_str.clone()
                                };

                                if !image_path.is_empty() {
                                    match service.recognize(&image_path).await {
                                        Ok(result) if !result.text.trim().is_empty() => {
                                            ocr_text = result.text.clone();
                                            let repo_lock = repo_clone.lock().await;
                                            let _ = repo_lock
                                                .update_ocr_text(&item_id, &result.text)
                                                .await;
                                            println!(
                                                "Auto OCR text captured: {} chars",
                                                result.text.len()
                                            );
                                        }
                                        Ok(_) => println!("Auto OCR returned empty text"),
                                        Err(e) => eprintln!("Auto OCR failed: {}", e),
                                    }
                                }
                            }
                        }

                        if !ocr_text.is_empty() {
                            let ai_config = ai_config_clone.lock().unwrap().clone();
                            if !ai_config.get_current_api_key().is_empty() {
                                let _permit = ai_semaphore_clone.acquire().await.unwrap();
                                println!(
                                    "[AI] lock acquired for OCR text tags: item_id={}",
                                    item_id
                                );

                                let language = config_repo_clone
                                    .load_general_config()
                                    .await
                                    .ok()
                                    .flatten()
                                    .map(|c| c.language)
                                    .unwrap_or_else(|| "zh-CN".to_string());

                                let service = AIService::new(ai_config);
                                match service.generate_tags(&ocr_text, &language).await {
                                    Ok((tags, _code_lang)) if !tags.is_empty() => {
                                        let ai_tags: Vec<String> =
                                            tags.iter().map(|t| format!("AI:{}", t)).collect();

                                        let repo_lock = repo_clone.lock().await;
                                        if let Ok(Some(mut item)) =
                                            repo_lock.find_by_id(&item_id).await
                                        {
                                            let existing_tags: Vec<String> = item
                                                .tags
                                                .as_ref()
                                                .and_then(|t| serde_json::from_str(t).ok())
                                                .unwrap_or_default();

                                            let mut all_tags = existing_tags;
                                            all_tags.extend(ai_tags);

                                            item.tags =
                                                Some(serde_json::to_string(&all_tags).unwrap());
                                            let _ = repo_lock.update(&item).await;
                                            println!("[AI] tags added from OCR text: {:?}", tags);
                                        }
                                    }
                                    Ok(_) => println!("[AI] empty tag result from OCR text"),
                                    Err(e) => {
                                        eprintln!("[AI] tag generation from OCR failed: {}", e)
                                    }
                                }
                                println!("[AI] lock released");
                            }
                        } else {
                            println!("Image has no OCR text, skipping AI tags");
                        }
                    }
                } else if let Some(content) = item_content.as_ref() {
                    let ai_config = ai_config_clone.lock().unwrap().clone();
                    if !ai_config.get_current_api_key().is_empty() {
                        let _permit = ai_semaphore_clone.acquire().await.unwrap();
                        println!(
                            "[AI] lock acquired for content tags: item_id={}, type={}",
                            item_id, item_type
                        );

                        let language = config_repo_clone
                            .load_general_config()
                            .await
                            .ok()
                            .flatten()
                            .map(|c| c.language)
                            .unwrap_or_else(|| "zh-CN".to_string());

                        let service = AIService::new(ai_config);
                        match service.generate_tags(content, &language).await {
                            Ok((tags, code_language)) if !tags.is_empty() || code_language.is_some() => {
                                let ai_tags: Vec<String> =
                                    tags.iter().map(|t| format!("AI:{}", t)).collect();

                                let repo_lock = repo_clone.lock().await;
                                if let Ok(Some(mut item)) = repo_lock.find_by_id(&item_id).await {
                                    let existing_tags: Vec<String> = item
                                        .tags
                                        .as_ref()
                                        .and_then(|t| serde_json::from_str(t).ok())
                                        .unwrap_or_default();

                                    let mut all_tags = existing_tags;
                                    all_tags.extend(ai_tags);

                                    item.tags = Some(serde_json::to_string(&all_tags).unwrap());
                                    item.code_language = code_language.clone();
                                    let _ = repo_lock.update(&item).await;
                                    println!("[AI] tags added: {:?}, code_language: {:?}", tags, code_language);
                                }
                            }
                            Ok(_) => println!("[AI] empty tag result"),
                            Err(e) => eprintln!("[AI] tag generation failed: {}", e),
                        }
                        println!("[AI] lock released");
                    }
                }
            });
        }

        Ok(())
    }

    fn should_pin_on_double_copy(
        state: &Arc<Mutex<DoubleCopyEmphasisState>>,
        content_hash: &str,
        source_app: &str,
        enabled: bool,
        window_ms: u64,
    ) -> bool {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let window_ms = window_ms.clamp(300, 2500) as u128;

        let mut state = state.lock().unwrap();
        let same_hash = state.last_hash.as_deref() == Some(content_hash);
        let source_app_valid = !source_app.is_empty() && source_app != "Unknown";
        let same_source_app =
            source_app_valid && state.last_source_app.as_deref() == Some(source_app);
        let delta_ms = now_ms.saturating_sub(state.last_seen_at_ms);
        let interval_ok = delta_ms >= DOUBLE_COPY_MIN_INTERVAL_MS && delta_ms <= window_ms;
        let cooldown_ok =
            now_ms.saturating_sub(state.last_emphasis_at_ms) >= DOUBLE_COPY_COOLDOWN_MS;

        let should_pin = enabled && same_hash && same_source_app && interval_ok && cooldown_ok;

        state.last_hash = Some(content_hash.to_string());
        state.last_source_app = Some(source_app.to_string());
        state.last_seen_at_ms = now_ms;
        if should_pin {
            state.last_emphasis_at_ms = now_ms;
        }

        should_pin
    }

    pub async fn get_recent(&self, limit: i32) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_recent(limit).await
    }

    pub async fn get_recent_light(&self, limit: i32) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_recent_light(limit).await
    }

    pub async fn get_recent_paged(
        &self,
        limit: i32,
        offset: i32,
    ) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_recent_paged(limit, offset).await
    }

    pub async fn copy_to_clipboard(&self, item: &ClipboardItem) -> Result<(), ClipboardError> {
        let content = if item.type_ == "image" {
            // Load original image from file
            if let Some(image_paths_str) = &item.image_paths {
                // Try to parse as JSON first (new format)
                let image_path =
                    if let Ok(paths) = serde_json::from_str::<serde_json::Value>(image_paths_str) {
                        paths["original"]
                            .as_str()
                            .unwrap_or(image_paths_str)
                            .to_string()
                    } else {
                        // Fallback to old format (direct path string)
                        image_paths_str.clone()
                    };

                let data = std::fs::read(&image_path).map_err(|e| {
                    ClipboardError::PlatformError(format!("Failed to read image: {}", e))
                })?;
                ClipboardContent::Image(data)
            } else {
                return Err(ClipboardError::UnsupportedType);
            }
        } else if item.type_ == "file" {
            // Restore file paths to clipboard
            if let Some(paths) = &item.content {
                ClipboardContent::File(paths.clone())
            } else {
                return Err(ClipboardError::UnsupportedType);
            }
        } else if let Some(text) = &item.content {
            ClipboardContent::Text(text.clone())
        } else {
            return Err(ClipboardError::UnsupportedType);
        };

        // 濡傛灉鏄疆椤堕」,鏇存柊鍏舵椂闂存埑浠ヤ繚鎸佹椿璺?
        if item.is_pinned {
            let repo = self.repository.lock().await;
            let _ = repo.touch(&item.id).await;
        }

        self.platform.set_content(content).await
    }

    pub async fn update_item(&self, item: &ClipboardItem) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.update(item).await
    }

    pub async fn delete_item(&self, id: &str) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.delete(id).await
    }

    pub async fn insert_item(&self, item: &ClipboardItem) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.insert(item).await
    }

    /// Insert with hash dedupe in one critical section to avoid races.
    /// Returns the effective item id (existing or newly inserted).
    pub async fn insert_item_dedup_touch(
        &self,
        item: &ClipboardItem,
    ) -> Result<String, sqlx::Error> {
        let repo = self.repository.lock().await;

        if let Some(existing) = repo.find_by_hash(&item.content_hash).await? {
            let _ = repo.touch(&existing.id).await;
            return Ok(existing.id);
        }

        repo.insert(item).await?;
        Ok(item.id.clone())
    }

    pub async fn find_by_hash(
        &self,
        content_hash: &str,
    ) -> Result<Option<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.find_by_hash(content_hash).await
    }

    pub async fn touch(&self, id: &str) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.touch(id).await
    }

    pub async fn update_ocr_text(&self, id: &str, ocr_text: &str) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.update_ocr_text(id, ocr_text).await
    }

    pub async fn toggle_pin(&self, id: &str, max_pinned: usize) -> Result<bool, sqlx::Error> {
        let repo = self.repository.lock().await;

        if let Some(item) = repo.find_by_id(id).await? {
            let new_pinned_state = !item.is_pinned;

            if new_pinned_state {
                let pinned_items = repo.get_pinned_items().await?;
                if pinned_items.len() >= max_pinned {
                    if let Some(oldest_pinned) = pinned_items.first() {
                        println!(
                            "Pinned limit reached ({}), unpinning oldest item: {}",
                            max_pinned, oldest_pinned.id
                        );
                        repo.unpin(&oldest_pinned.id).await?;
                    }
                }
            }

            repo.set_pinned(id, new_pinned_state).await?;
            Ok(new_pinned_state)
        } else {
            Err(sqlx::Error::RowNotFound)
        }
    }

    pub async fn pin_item(&self, id: &str, max_pinned: usize) -> Result<bool, sqlx::Error> {
        let repo = self.repository.lock().await;

        if let Some(item) = repo.find_by_id(id).await? {
            if item.is_pinned {
                return Ok(true);
            }

            let pinned_items = repo.get_pinned_items().await?;
            if pinned_items.len() >= max_pinned {
                if let Some(oldest_pinned) = pinned_items.first() {
                    repo.unpin(&oldest_pinned.id).await?;
                }
            }

            repo.set_pinned(id, true).await?;
            Ok(true)
        } else {
            Err(sqlx::Error::RowNotFound)
        }
    }

    pub async fn toggle_favorite(&self, id: &str) -> Result<bool, sqlx::Error> {
        let repo = self.repository.lock().await;

        // 鑾峰彇褰撳墠椤圭洰
        if let Some(mut item) = repo.find_by_id(id).await? {
            // 鍒囨崲鏀惰棌鐘舵€?
            item.is_favorite = !item.is_favorite;

            repo.update(&item).await?;
            Ok(item.is_favorite)
        } else {
            Err(sqlx::Error::RowNotFound)
        }
    }

    pub fn update_ai_config(&self, config: AIConfig) {
        let mut ai_config = self.ai_config.lock().unwrap();
        *ai_config = config;
    }

    pub fn update_ocr_service(&self, service: Option<OcrService>) {
        let mut ocr_service = self.ocr_config.lock().unwrap();
        *ocr_service = service;
    }

    // ========== MCP 鐩稿叧鏂规硶 ==========

    /// 鎼滅储鍓创鏉挎潯鐩?
    pub async fn search_items(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        let filters = crate::core::models::SearchFilters::default();
        repo.search(query, &filters, limit as i32).await
    }

    /// 鑾峰彇鏈€杩戠殑鏉＄洰
    pub async fn get_recent_items(&self, limit: usize) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_recent(limit as i32).await
    }

    /// 鏍规嵁 ID 鑾峰彇鏉＄洰
    pub async fn get_item_by_id(&self, id: &str) -> Result<Option<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.find_by_id(id).await
    }

    /// 娣诲姞鏂囨湰鏉＄洰
    pub async fn add_text_item(
        &self,
        content: &str,
        notes: Option<&str>,
    ) -> Result<ClipboardItem, Box<dyn std::error::Error>> {
        use sha2::{Digest, Sha256};

        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let hash = format!("{:x}", hasher.finalize());

        let metadata = self.platform.get_active_window_info().unwrap_or_else(|_| {
            crate::core::models::WindowMetadata {
                source_app: "MCP".to_string(),
                window_title: "".to_string(),
                source_url: None,
            }
        });

        let mut item = ClipboardItem::new_text(content.to_string(), metadata);
        item.content_hash = hash;

        if let Some(note) = notes {
            item.user_note = Some(note.to_string());
        }

        let repo = self.repository.lock().await;
        repo.insert(&item).await?;

        Ok(item)
    }

    /// 鑾峰彇缁熻淇℃伅
    pub async fn get_statistics(&self) -> Result<serde_json::Value, sqlx::Error> {
        let repo = self.repository.lock().await;

        // 鑾峰彇鎬绘暟
        let total: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM clipboard_items WHERE is_deleted = 0")
                .fetch_one(repo.pool())
                .await?;

        // 鎸夌被鍨嬬粺璁?
        let text_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM clipboard_items WHERE type = 'text' AND is_deleted = 0",
        )
        .fetch_one(repo.pool())
        .await?;

        let image_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM clipboard_items WHERE type = 'image' AND is_deleted = 0",
        )
        .fetch_one(repo.pool())
        .await?;

        let file_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM clipboard_items WHERE type = 'file' AND is_deleted = 0",
        )
        .fetch_one(repo.pool())
        .await?;

        let pinned_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM clipboard_items WHERE is_pinned = 1 AND is_deleted = 0",
        )
        .fetch_one(repo.pool())
        .await?;

        let favorite_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM clipboard_items WHERE is_favorite = 1 AND is_deleted = 0",
        )
        .fetch_one(repo.pool())
        .await?;

        Ok(serde_json::json!({
            "total": total,
            "by_type": {
                "text": text_count,
                "image": image_count,
                "file": file_count
            },
            "pinned": pinned_count,
            "favorite": favorite_count
        }))
    }

    /// 娓呯┖鎵€鏈夊壀璐存澘鏁版嵁
    pub async fn clear_all_items(&self) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        sqlx::query("DELETE FROM clipboard_items")
            .execute(repo.pool())
            .await?;
        Ok(())
    }

    /// 鑾峰彇鎵€鏈夋湭鍒犻櫎鐨勬潯鐩紙瀵煎嚭鐢級
    pub async fn get_all_items(&self) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        let items = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items WHERE is_deleted = 0 ORDER BY created_at ASC",
        )
        .fetch_all(repo.pool())
        .await?;
        Ok(items)
    }

    /// 鎸?content_hash 鍘婚噸鎻掑叆锛堝鍏ョ敤锛夛紝杩斿洖鏄惁瀹為檯鎻掑叆
    pub async fn insert_item_if_not_exists(
        &self,
        item: &ClipboardItem,
    ) -> Result<bool, sqlx::Error> {
        let repo = self.repository.lock().await;
        let existing = repo.find_by_hash(&item.content_hash).await?;
        if existing.is_some() {
            return Ok(false);
        }
        repo.insert(item).await?;
        Ok(true)
    }

    /// 鑾峰彇鍥剧墖瀛樺偍鐩綍
    pub fn image_dir(&self) -> &std::path::Path {
        &self.image_dir
    }

    fn compute_content_hash(content: &ClipboardContent) -> String {
        match content {
            ClipboardContent::Text(text) => {
                use sha2::{Digest, Sha256};
                let mut hasher = Sha256::new();
                hasher.update(text.as_bytes());
                format!("{:x}", hasher.finalize())
            }
            ClipboardContent::Image(data) => format!("{:x}", md5::compute(data)),
            ClipboardContent::File(paths_str) => {
                use sha2::{Digest, Sha256};
                let mut hasher = Sha256::new();
                hasher.update(paths_str.as_bytes());
                format!("{:x}", hasher.finalize())
            }
        }
    }

    async fn load_max_pinned(&self) -> usize {
        self.config_repo
            .load_general_config()
            .await
            .ok()
            .flatten()
            .map(|c| c.max_pinned_items)
            .unwrap_or(3)
    }

    async fn pin_by_hash_with_retry(
        &self,
        content_hash: &str,
        max_pinned: usize,
        max_retries: usize,
        retry_delay_ms: u64,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        for attempt in 0..max_retries {
            let repo = self.repository.lock().await;
            if let Some(item) = repo.find_by_hash(content_hash).await? {
                if item.is_pinned {
                    return Ok(item.id);
                }

                let pinned_items = repo.get_pinned_items().await?;
                if pinned_items.len() >= max_pinned {
                    if let Some(oldest) = pinned_items.first() {
                        repo.unpin(&oldest.id).await?;
                    }
                }

                repo.set_pinned(&item.id, true).await?;
                return Ok(item.id);
            }
            drop(repo);

            if attempt + 1 < max_retries {
                tokio::time::sleep(std::time::Duration::from_millis(retry_delay_ms)).await;
            }
        }

        Err(format!(
            "Clipboard item not found in DB after {} retries (hash={})",
            max_retries, content_hash
        )
        .into())
    }

    async fn read_clipboard_with_retry(
        &self,
        max_retries: usize,
        retry_delay_ms: u64,
    ) -> Result<ClipboardContent, Box<dyn std::error::Error + Send + Sync>> {
        for attempt in 0..max_retries {
            match self.platform.get_content().await {
                Ok(content) => return Ok(content),
                Err(err) => {
                    if attempt + 1 >= max_retries {
                        return Err(format!("Failed to read clipboard: {}", err).into());
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(retry_delay_ms)).await;
        }

        Err("Failed to read clipboard".into())
    }

    #[cfg(target_os = "windows")]
    async fn wait_shortcut_modifiers_released(timeout_ms: u64) {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            GetAsyncKeyState, VK_CONTROL, VK_MENU, VK_SHIFT,
        };

        fn is_pressed(vk: i32) -> bool {
            unsafe { (GetAsyncKeyState(vk) as u16 & 0x8000) != 0 }
        }

        let started = std::time::Instant::now();
        let timeout = std::time::Duration::from_millis(timeout_ms);
        while started.elapsed() < timeout {
            if !is_pressed(VK_CONTROL.0 as i32)
                && !is_pressed(VK_SHIFT.0 as i32)
                && !is_pressed(VK_MENU.0 as i32)
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
    }

    #[cfg(target_os = "windows")]
    fn send_ctrl_c_input() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
            VK_CONTROL,
        };

        const VK_C_KEY: u16 = 0x43;

        fn key_input(vk: u16, key_up: bool) -> INPUT {
            let flags = if key_up {
                KEYEVENTF_KEYUP
            } else {
                Default::default()
            };

            INPUT {
                r#type: INPUT_KEYBOARD,
                Anonymous: INPUT_0 {
                    ki: KEYBDINPUT {
                        wVk: VIRTUAL_KEY(vk),
                        wScan: 0,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    },
                },
            }
        }

        let inputs = [
            key_input(VK_CONTROL.0, false),
            key_input(VK_C_KEY, false),
            key_input(VK_C_KEY, true),
            key_input(VK_CONTROL.0, true),
        ];

        let sent = unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
        if sent != inputs.len() as u32 {
            return Err(
                format!("SendInput sent {} events, expected {}", sent, inputs.len()).into(),
            );
        }

        Ok(())
    }

    #[cfg(target_os = "windows")]
    async fn wait_clipboard_sequence_change(previous_seq: u32, timeout_ms: u64) -> bool {
        use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;

        let started = std::time::Instant::now();
        let timeout = std::time::Duration::from_millis(timeout_ms);
        while started.elapsed() < timeout {
            let current = unsafe { GetClipboardSequenceNumber() };
            if current != 0 && current != previous_seq {
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }

        false
    }

    /// One-shot pipeline:
    /// 1) trigger a copy in the foreground app,
    /// 2) wait for clipboard change,
    /// 3) persist and dedupe clipboard content,
    /// 4) pin the resulting item.
    ///
    /// Falls back to pinning current clipboard when the synthetic copy path cannot complete.
    pub async fn copy_and_pin_foreground_selection(
        &self,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        #[cfg(target_os = "windows")]
        {
            use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;

            Self::wait_shortcut_modifiers_released(350).await;
            let seq_before = unsafe { GetClipboardSequenceNumber() };

            if let Err(err) = Self::send_ctrl_c_input() {
                eprintln!("[Shortcut] copy simulation failed: {}", err);
                return self.pin_current_clipboard().await;
            }

            let changed = Self::wait_clipboard_sequence_change(seq_before, 1500).await;
            if !changed {
                eprintln!("[Shortcut] clipboard sequence did not change after synthetic copy");
                return self.pin_current_clipboard().await;
            }

            let content = self.read_clipboard_with_retry(20, 30).await?;
            let content_hash = Self::compute_content_hash(&content);
            let metadata = self
                .platform
                .get_active_window_info()
                .unwrap_or(WindowMetadata {
                    source_app: "Unknown".to_string(),
                    window_title: "".to_string(),
                    source_url: None,
                });

            if let Err(err) = Self::handle_clipboard_change(
                content,
                self.repository.clone(),
                self.config_repo.clone(),
                metadata,
                self.image_dir.clone(),
                self.ai_config.clone(),
                self.ocr_config.clone(),
                self.ai_semaphore.clone(),
                self.double_copy_state.clone(),
                self.app_handle.clone(),
            )
            .await
            {
                eprintln!("[Shortcut] failed to persist copied content: {}", err);
            }

            let max_pinned = self.load_max_pinned().await;
            return self
                .pin_by_hash_with_retry(&content_hash, max_pinned, 20, 75)
                .await;
        }

        #[cfg(not(target_os = "windows"))]
        {
            self.pin_current_clipboard().await
        }
    }

    /// Pin current clipboard content without triggering an extra copy action.
    pub async fn pin_current_clipboard(
        &self,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let content = self.read_clipboard_with_retry(10, 40).await?;
        let content_hash = Self::compute_content_hash(&content);
        let max_pinned = self.load_max_pinned().await;

        self.pin_by_hash_with_retry(&content_hash, max_pinned, 20, 75)
            .await
    }
}
