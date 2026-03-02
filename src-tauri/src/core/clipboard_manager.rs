use crate::ai::{AIConfig, AIService};
use crate::core::models::{
    ClipboardContent, ClipboardItem, SyncApplyResult, SyncIncomingSlot, SyncLatestSlot,
    WindowMetadata,
};
use crate::ocr::OcrService;
use crate::platform::clipboard_trait::{ClipboardCallback, ClipboardError, PlatformClipboard};
use crate::repository::clipboard_repo::ClipboardRepository;
use crate::repository::config_repo::ConfigRepository;
use crate::lan_sync::PairedSyncDevice;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use parking_lot::Mutex;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::{Mutex as TokioMutex, Semaphore};
use url::Host;

const APP_NAME: &str = "Qollect";
const DOUBLE_COPY_MIN_INTERVAL_MS: u128 = 60;
const DOUBLE_COPY_COOLDOWN_MS: u128 = 900;
const LINK_PREVIEW_MAX_BYTES: usize = 262_144;

#[derive(Default)]
struct DoubleCopyEmphasisState {
    last_hash: Option<String>,
    last_source_app: Option<String>,
    last_seen_at_ms: u128,
    last_emphasis_at_ms: u128,
    last_emphasis_hash: Option<String>,
    last_emphasis_source_app: Option<String>,
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
    pub paused: Arc<AtomicBool>,
    last_cleanup_at: Arc<AtomicI64>,
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
            ai_semaphore: Arc::new(Semaphore::new(1)), // Allow only one AI request at a time.
            double_copy_state: Arc::new(Mutex::new(DoubleCopyEmphasisState::default())),
            app_handle,
            paused: Arc::new(AtomicBool::new(false)),
            last_cleanup_at: Arc::new(AtomicI64::new(0)),
        }
    }

    pub fn pause(&self) {
        self.paused.store(true, Ordering::Relaxed);
    }

    pub fn resume(&self) {
        self.paused.store(false, Ordering::Relaxed);
    }

    pub fn is_paused(&self) -> bool {
        self.paused.load(Ordering::Relaxed)
    }

    pub async fn start_monitoring(&self) -> Result<(), ClipboardError> {
        // Spawn one-time startup cleanup
        {
            let repo = self.repository.clone();
            let config_repo = self.config_repo.clone();
            let image_dir = self.image_dir.clone();
            let last_cleanup_at = self.last_cleanup_at.clone();
            tokio::spawn(async move {
                Self::run_cleanup(repo, config_repo, image_dir, last_cleanup_at).await;
            });
        }

        let repo = self.repository.clone();
        let config_repo = self.config_repo.clone();
        let image_dir = self.image_dir.clone();
        let ai_config = self.ai_config.clone();
        let ocr_config = self.ocr_config.clone();
        let ai_semaphore = self.ai_semaphore.clone();
        let double_copy_state = self.double_copy_state.clone();
        let app_handle = self.app_handle.clone();
        let paused = self.paused.clone();
        let last_cleanup_at = self.last_cleanup_at.clone();

        let callback: ClipboardCallback = Box::new(move |content, metadata| {
            let repo = repo.clone();
            let config_repo = config_repo.clone();
            let image_dir = image_dir.clone();
            let ai_config = ai_config.clone();
            let ocr_config = ocr_config.clone();
            let ai_semaphore = ai_semaphore.clone();
            let double_copy_state = double_copy_state.clone();
            let app_handle = app_handle.clone();
            let paused = paused.clone();
            let last_cleanup_at = last_cleanup_at.clone();

            Box::pin(async move {
                if paused.load(Ordering::Relaxed) {
                    return Ok(());
                }
                if let Err(e) = Self::handle_clipboard_change(
                    content,
                    repo.clone(),
                    config_repo.clone(),
                    metadata,
                    image_dir.clone(),
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

                // Debounced cleanup after each clipboard change
                tokio::spawn(async move {
                    Self::run_cleanup(repo, config_repo, image_dir, last_cleanup_at).await;
                });

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

        // Extract source_app early, before metadata is moved into item constructors
        let source_app = metadata.source_app.clone();

        let item = match &content {
            ClipboardContent::Text { plain: text, .. } => {
                // Handle whitespace-only text carefully.
                if text.trim().is_empty() {
                    // Count newline characters.
                    let newline_count = text.matches('\n').count();

                    // Skip short blank snippets that are likely accidental copies.
                    if newline_count < 3 {
                        println!(
                            "Clipboard text is empty or too short (newlines: {}), skipping",
                            newline_count
                        );
                        return Ok(());
                    }

                    // Keep multi-line blanks because they may preserve formatting intent.
                    println!(
                        "Clipboard text is blank but has {} newlines, keeping",
                        newline_count
                    );
                }
                println!("Creating clipboard item for text: {} chars", text.len());
                ClipboardItem::new_text(text.clone(), metadata)
            }
            ClipboardContent::Image(data) => {
                println!("Image clipboard content detected, saving...");

                // Build a stable hash from image bytes for deduplication.
                let image_hash = blake3::hash(&data).to_hex().to_string();

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
                    let thumbnail = crate::core::thumbnail::generate_thumbnail(&img, 300);
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
                    content_hash: image_hash, // Use image content hash for deduplication.
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
                    has_raw_formats: false,
                    content_truncated: false,
                    ocr_truncated: false,
                    content_updated: false,
                }
            }
            ClipboardContent::File(paths_str) => {
                println!("File clipboard content detected");

                if let Some(image_item) = Self::promote_pixpin_image_file_to_item(
                    paths_str,
                    &metadata,
                    &image_dir,
                    &source_app,
                )? {
                    println!("Promoted PixPin file payload to image item");
                    image_item
                } else {
                    let paths: Vec<&str> = paths_str
                        .lines()
                        .map(str::trim)
                        .filter(|p| !p.is_empty())
                        .collect();
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

                    let summary = if file_count == 1 && !file_names.is_empty() {
                        format!("File: {}", file_names[0])
                    } else {
                        format!("{} files: {}", file_count, file_names.join(", "))
                    };

                    println!("Files: {}", summary);

                    let mut item = ClipboardItem::new_text(summary, metadata);
                    item.type_ = "file".to_string();
                    item.content = Some(paths_str.to_string());
                    // Use full path payload hash to avoid false collisions on same filename.
                    item.content_hash = blake3::hash(paths_str.as_bytes()).to_hex().to_string();
                    item
                }
            }
        };

        let content_hash = item.content_hash.clone();
        let mut item_id = item.id.clone();
        let mut inserted_new_item = false;

        // Evaluate double-copy BEFORE acquiring repo lock so timing is accurate
        let general_config = config_repo
            .load_general_config()
            .await
            .ok()
            .flatten()
            .unwrap_or_default();
        let is_double_copy = Self::should_pin_on_double_copy(
            &double_copy_state,
            &content_hash,
            &source_app,
            general_config.double_copy_emphasis_enabled,
            general_config.double_copy_window_ms,
        );

        let repo_lock = repo.lock().await;
        if let Some(existing) = repo_lock.find_by_hash(&content_hash).await? {
            println!("Duplicate detected, moving to top: {}", existing.id);
            repo_lock.touch(&existing.id).await?;
            item_id = existing.id;

            // Keep raw formats aligned with the latest clipboard payload for this hash.
            if let ClipboardContent::Text { raw_formats, .. } = &content {
                match raw_formats {
                    Some(formats) if !formats.is_empty() => {
                        if let Err(e) = repo_lock.delete_raw_formats(&item_id).await {
                            eprintln!("Failed to clear stale raw formats: {}", e);
                        } else if let Err(e) = repo_lock.insert_raw_formats(&item_id, formats).await
                        {
                            eprintln!("Failed to refresh raw formats: {}", e);
                        } else {
                            println!(
                                "Refreshed {} raw format(s) for duplicate item {}",
                                formats.len(),
                                item_id
                            );
                        }
                    }
                    _ => {
                        if let Err(e) = repo_lock.delete_raw_formats(&item_id).await {
                            eprintln!(
                                "Failed to clear raw formats for plain-text duplicate: {}",
                                e
                            );
                        } else {
                            println!(
                                "Cleared raw formats for plain-text duplicate item {}",
                                item_id
                            );
                        }
                    }
                }
            }
        } else {
            println!("Inserting new clipboard item: {}", item.id);
            repo_lock.insert(&item).await?;
            inserted_new_item = true;

            // Save raw clipboard formats (HTML, RTF) if present
            if let ClipboardContent::Text {
                raw_formats: Some(formats),
                ..
            } = &content
            {
                if !formats.is_empty() {
                    if let Err(e) = repo_lock.insert_raw_formats(&item.id, formats).await {
                        eprintln!("Failed to save raw formats: {}", e);
                    } else {
                        println!("Saved {} raw format(s) for item {}", formats.len(), item.id);
                    }
                }
            }
        }

        let item_type = item.type_.clone();
        let item_content = item.content.clone();
        let item_image_paths = item.image_paths.clone();
        let item_metadata = item.metadata.clone();
        drop(repo_lock);
        let _ = app_handle.emit("clipboard-changed", ());
        println!("[Clipboard] item saved");

        if is_double_copy {
            let repo_lock = repo.lock().await;
            if let Some(existing) = repo_lock.find_by_id(&item_id).await? {
                if !existing.is_pinned {
                    let pinned_items = repo_lock.get_pinned_items().await?;
                    println!(
                        "[DoubleCopyPin] item_id={} pinned_count={} max_pinned_items={}",
                        item_id,
                        pinned_items.len(),
                        general_config.max_pinned_items
                    );
                    if pinned_items.len() >= general_config.max_pinned_items {
                        if let Some(oldest_pinned) = pinned_items.first() {
                            println!(
                                "[DoubleCopyPin] unpin oldest item_id={} before pinning {}",
                                oldest_pinned.id, item_id
                            );
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
        let app_handle_clone = app_handle.clone();

        if inserted_new_item {
            tokio::spawn(async move {
                if item_type == "link" {
                    if let Some(url) = item_content.as_deref() {
                        Self::try_enrich_link_preview(
                            repo_clone.clone(),
                            app_handle_clone.clone(),
                            item_id.clone(),
                            item_metadata.as_deref(),
                            url,
                        )
                        .await;
                    }
                }

                if item_type == "image" {
                    if let Some(image_paths_str) = item_image_paths {
                        let ocr_service_opt = ocr_config_clone.lock().clone();
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
                            let ai_config = ai_config_clone.lock().clone();
                            if ai_config.enabled && !ai_config.get_current_api_key().is_empty() {
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
                            } else {
                                println!(
                                    "[AI] skipped OCR text tags: enabled={}, has_api_key={}",
                                    ai_config.enabled,
                                    !ai_config.get_current_api_key().is_empty()
                                );
                            }
                        } else {
                            println!("Image has no OCR text, skipping AI tags");
                        }
                    }
                } else if let Some(content) = item_content.as_ref() {
                    let ai_config = ai_config_clone.lock().clone();
                    if ai_config.enabled && !ai_config.get_current_api_key().is_empty() {
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
                            Ok((tags, code_language))
                                if !tags.is_empty() || code_language.is_some() =>
                            {
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
                                    println!(
                                        "[AI] tags added: {:?}, code_language: {:?}",
                                        tags, code_language
                                    );
                                }
                            }
                            Ok(_) => println!("[AI] empty tag result"),
                            Err(e) => eprintln!("[AI] tag generation failed: {}", e),
                        }
                        println!("[AI] lock released");
                    } else {
                        println!(
                            "[AI] skipped content tags: enabled={}, has_api_key={}",
                            ai_config.enabled,
                            !ai_config.get_current_api_key().is_empty()
                        );
                    }
                }
            });
        }

        Ok(())
    }

    async fn try_enrich_link_preview(
        repo: Arc<TokioMutex<ClipboardRepository>>,
        app_handle: AppHandle,
        item_id: String,
        metadata_json: Option<&str>,
        url: &str,
    ) {
        if let Some(existing_title) =
            metadata_json.and_then(Self::extract_link_preview_title_from_metadata)
        {
            if !existing_title.is_empty() {
                return;
            }
        }

        let title = match Self::fetch_link_title(url).await {
            Some(value) => value,
            None => return,
        };

        let new_metadata = match Self::merge_link_preview_metadata(metadata_json, &title, url) {
            Some(value) => value,
            None => return,
        };

        let repo_lock = repo.lock().await;
        if let Err(error) = repo_lock
            .update_metadata_only(&item_id, &new_metadata)
            .await
        {
            eprintln!(
                "[LinkPreview] failed to persist title for {}: {}",
                item_id, error
            );
            return;
        }
        drop(repo_lock);

        let _ = app_handle.emit("clipboard-changed", ());
    }

    fn extract_link_preview_title_from_metadata(metadata_json: &str) -> Option<String> {
        let value = serde_json::from_str::<serde_json::Value>(metadata_json).ok()?;
        let title = value
            .get("link_preview")
            .and_then(|v| v.get("title"))
            .and_then(|v| v.as_str())?
            .trim();
        if title.is_empty() {
            None
        } else {
            Some(title.to_string())
        }
    }

    fn merge_link_preview_metadata(
        metadata_json: Option<&str>,
        title: &str,
        url: &str,
    ) -> Option<String> {
        let mut value = if let Some(raw) = metadata_json {
            serde_json::from_str::<serde_json::Value>(raw).ok()?
        } else {
            serde_json::json!({})
        };

        let object = value.as_object_mut()?;
        object.insert(
            "link_preview".to_string(),
            serde_json::json!({
                "title": title,
                "url": url,
                "fetched_at": chrono::Utc::now().timestamp(),
            }),
        );
        Some(value.to_string())
    }

    async fn fetch_link_title(url: &str) -> Option<String> {
        let parsed = url::Url::parse(url).ok()?;
        let scheme = parsed.scheme();
        if scheme != "http" && scheme != "https" {
            return None;
        }
        if Self::is_local_or_private_host(&parsed) {
            return None;
        }

        let client = crate::http_client::client();

        let mut response = client
            .get(parsed)
            .header(
                reqwest::header::ACCEPT,
                "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
            )
            .send()
            .await
            .ok()?;

        if !response.status().is_success() {
            return None;
        }

        if let Some(content_type) = response.headers().get(reqwest::header::CONTENT_TYPE) {
            if let Ok(value) = content_type.to_str() {
                let normalized = value.to_ascii_lowercase();
                if !normalized.contains("text/html")
                    && !normalized.contains("application/xhtml+xml")
                {
                    return None;
                }
            }
        }

        let mut bytes = Vec::with_capacity(8192);
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) => {
                    let remaining = LINK_PREVIEW_MAX_BYTES.saturating_sub(bytes.len());
                    if remaining == 0 {
                        break;
                    }
                    if chunk.len() > remaining {
                        bytes.extend_from_slice(&chunk[..remaining]);
                        break;
                    }
                    bytes.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                Err(_) => return None,
            }
        }

        if bytes.is_empty() {
            return None;
        }

        let html = String::from_utf8_lossy(&bytes);
        Self::extract_title_from_html(&html)
    }

    fn is_local_or_private_host(parsed: &url::Url) -> bool {
        match parsed.host() {
            Some(Host::Ipv4(ip)) => {
                ip.is_private()
                    || ip.is_loopback()
                    || ip.is_link_local()
                    || ip.is_broadcast()
                    || ip.is_documentation()
                    || ip.is_unspecified()
            }
            Some(Host::Ipv6(ip)) => ip.is_loopback() || ip.is_unique_local() || ip.is_unspecified(),
            Some(Host::Domain(domain)) => {
                let host = domain.to_ascii_lowercase();
                host == "localhost" || host.ends_with(".localhost") || host.ends_with(".local")
            }
            None => true,
        }
    }

    fn extract_title_from_html(html: &str) -> Option<String> {
        Self::extract_meta_title(html, "property", "og:title")
            .or_else(|| Self::extract_meta_title(html, "name", "twitter:title"))
            .or_else(|| Self::extract_title_tag(html))
            .and_then(|title| Self::normalize_link_title(&title))
    }

    fn extract_meta_title(html: &str, attr_name: &str, attr_value: &str) -> Option<String> {
        let lower = html.to_ascii_lowercase();
        let mut offset = 0usize;

        while let Some(meta_rel) = lower[offset..].find("<meta") {
            let start = offset + meta_rel;
            let Some(end_rel) = lower[start..].find('>') else {
                break;
            };
            let end = start + end_rel + 1;

            let tag = &html[start..end];
            let attr = Self::extract_attribute(tag, attr_name);
            if attr
                .as_deref()
                .map(|value| value.eq_ignore_ascii_case(attr_value))
                .unwrap_or(false)
            {
                if let Some(content) = Self::extract_attribute(tag, "content") {
                    return Some(content);
                }
            }
            offset = end;
        }

        None
    }

    fn extract_title_tag(html: &str) -> Option<String> {
        let lower = html.to_ascii_lowercase();
        let title_start = lower.find("<title")?;
        let title_open_end_rel = lower[title_start..].find('>')?;
        let content_start = title_start + title_open_end_rel + 1;
        let title_end_rel = lower[content_start..].find("</title>")?;
        let content_end = content_start + title_end_rel;
        Some(html[content_start..content_end].to_string())
    }

    fn extract_attribute(tag: &str, attr_name: &str) -> Option<String> {
        let lower = tag.to_ascii_lowercase();
        let pattern = format!("{}=", attr_name.to_ascii_lowercase());
        let start = lower.find(&pattern)? + pattern.len();
        let bytes = tag.as_bytes();

        let mut i = start;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= bytes.len() {
            return None;
        }

        let quote = bytes[i];
        if quote == b'"' || quote == b'\'' {
            let value_start = i + 1;
            let mut value_end = value_start;
            while value_end < bytes.len() && bytes[value_end] != quote {
                value_end += 1;
            }
            return Some(tag[value_start..value_end].to_string());
        }

        let value_start = i;
        let mut value_end = value_start;
        while value_end < bytes.len()
            && !bytes[value_end].is_ascii_whitespace()
            && bytes[value_end] != b'>'
        {
            value_end += 1;
        }
        Some(tag[value_start..value_end].to_string())
    }

    fn normalize_link_title(raw: &str) -> Option<String> {
        let decoded = raw
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&nbsp;", " ");
        let collapsed = decoded.split_whitespace().collect::<Vec<_>>().join(" ");
        let trimmed = collapsed.trim();
        if trimmed.is_empty() {
            return None;
        }
        let max_len = 180usize;
        if trimmed.chars().count() > max_len {
            let clipped = trimmed.chars().take(max_len).collect::<String>();
            return Some(clipped);
        }
        Some(trimmed.to_string())
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

        let mut state = state.lock();
        let same_hash = state.last_hash.as_deref() == Some(content_hash);
        let source_app_valid = !source_app.is_empty() && source_app != "Unknown";
        let last_source_app_valid = state
            .last_source_app
            .as_deref()
            .map(|s| !s.is_empty() && s != "Unknown")
            .unwrap_or(false);
        // If source app cannot be identified on either side, do not block double-copy.
        let same_source_app = if source_app_valid && last_source_app_valid {
            state.last_source_app.as_deref() == Some(source_app)
        } else {
            true
        };
        let delta_ms = now_ms.saturating_sub(state.last_seen_at_ms);
        let interval_ok = delta_ms >= DOUBLE_COPY_MIN_INTERVAL_MS && delta_ms <= window_ms;
        let same_as_last_emphasis = state.last_emphasis_hash.as_deref() == Some(content_hash)
            && state.last_emphasis_source_app.as_deref() == Some(source_app);
        let cooldown_ok = !same_as_last_emphasis
            || now_ms.saturating_sub(state.last_emphasis_at_ms) >= DOUBLE_COPY_COOLDOWN_MS;

        let should_pin = enabled && same_hash && same_source_app && interval_ok && cooldown_ok;

        println!(
            "[DoubleCopy] enabled={} same_hash={} same_source_app={} source_app_valid={} last_source_app_valid={} interval_ok={} cooldown_ok={} same_as_last_emphasis={} delta_ms={} window_ms={} source_app={:?} last_source_app={:?} => {}",
            enabled, same_hash, same_source_app, source_app_valid, last_source_app_valid,
            interval_ok, cooldown_ok, same_as_last_emphasis, delta_ms, window_ms,
            source_app, state.last_source_app, should_pin
        );

        state.last_hash = Some(content_hash.to_string());
        state.last_source_app = Some(source_app.to_string());
        state.last_seen_at_ms = now_ms;
        if should_pin {
            state.last_emphasis_at_ms = now_ms;
            state.last_emphasis_hash = Some(content_hash.to_string());
            state.last_emphasis_source_app = Some(source_app.to_string());
        }

        should_pin
    }

    /// Run auto-cleanup if enabled. Returns number of deleted items.
    pub async fn run_cleanup(
        repo: Arc<TokioMutex<ClipboardRepository>>,
        config_repo: Arc<ConfigRepository>,
        _image_dir: PathBuf,
        last_cleanup_at: Arc<AtomicI64>,
    ) -> usize {
        let now = chrono::Utc::now().timestamp();
        let last = last_cleanup_at.load(Ordering::Relaxed);
        if now - last < 60 {
            return 0;
        }
        last_cleanup_at.store(now, Ordering::Relaxed);

        let config = config_repo
            .load_general_config()
            .await
            .ok()
            .flatten()
            .unwrap_or_default();

        if !config.auto_cleanup_enabled {
            return 0;
        }

        let repo_lock = repo.lock().await;
        let targets = match repo_lock
            .cleanup_expired_items(config.cleanup_max_items, config.cleanup_max_age_days)
            .await
        {
            Ok(t) => t,
            Err(e) => {
                eprintln!("[Cleanup] query failed: {}", e);
                return 0;
            }
        };
        drop(repo_lock);

        let count = targets.len();
        if count == 0 {
            return 0;
        }

        // Delete image files for image-type items
        for target in &targets {
            Self::cleanup_image_files(&target.type_, target.image_paths.as_deref());
            // file type: never touch disk files
        }

        println!("[Cleanup] deleted {} expired items", count);
        count
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

    pub async fn get_items_by_date_range(
        &self,
        start: i64,
        end: i64,
    ) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_items_by_date_range(start, end).await
    }

    pub async fn get_history_group_counts(
        &self,
        start_today: i64,
        start_yesterday: i64,
        start_last7: i64,
    ) -> Result<(i64, i64, i64, i64), sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_history_group_counts(start_today, start_yesterday, start_last7)
            .await
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
            // Check if user edited the text (stale raw formats should not be restored).
            // Note: get_recent_light returns original_content as empty string,
            // so we must treat empty/None original_content as "unknown" (not edited).
            let edited = match (&item.content, &item.original_content) {
                (Some(c), Some(o)) if !o.is_empty() => c != o,
                _ => false,
            };

            let raw_formats = if edited {
                None
            } else {
                // Try to load raw formats from DB
                let repo = self.repository.lock().await;
                match repo.get_raw_formats(&item.id).await {
                    Ok(formats) if !formats.is_empty() => Some(formats),
                    _ => None,
                }
            };

            ClipboardContent::Text {
                plain: text.clone(),
                raw_formats,
            }
        } else {
            return Err(ClipboardError::UnsupportedType);
        };

        // Refresh pinned timestamps so ordering remains stable.
        if item.is_pinned {
            let repo = self.repository.lock().await;
            let _ = repo.touch(&item.id).await;
        }

        self.platform.set_content(content).await
    }

    pub async fn copy_plain_text(&self, text: &str) -> Result<(), ClipboardError> {
        let content = ClipboardContent::Text {
            plain: text.to_string(),
            raw_formats: None,
        };
        self.platform.set_content(content).await
    }

    pub async fn update_item(&self, item: &ClipboardItem) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.update(item).await
    }

    pub async fn delete_item(&self, id: &str) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        // Fetch item before deletion to get image paths
        if let Ok(Some(item)) = repo.find_by_id(id).await {
            Self::cleanup_image_files(&item.type_, item.image_paths.as_deref());
        }
        repo.delete(id).await?;
        let _ = repo.delete_raw_formats(id).await;
        Ok(())
    }

    pub async fn insert_item(&self, item: &ClipboardItem) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.insert(item).await?;
        drop(repo);
        self.schedule_link_preview_enrichment(item);
        Ok(())
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
        drop(repo);
        self.schedule_link_preview_enrichment(item);
        Ok(item.id.clone())
    }

    pub async fn get_sync_latest_slot(&self) -> Result<Option<SyncLatestSlot>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_sync_latest_slot().await
    }

    pub async fn get_next_sync_source_seq_hint(
        &self,
        source_device_id: &str,
    ) -> Result<i64, String> {
        let source_device_id = source_device_id.trim();
        if source_device_id.is_empty() {
            return Err("source_device_id is required".to_string());
        }
        let repo = self.repository.lock().await;
        repo.get_next_sync_source_seq_hint(source_device_id)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn publish_sync_slot_from_item(
        &self,
        item_id: &str,
        source_device_id: &str,
    ) -> Result<SyncLatestSlot, String> {
        let source_device_id = source_device_id.trim();
        if source_device_id.is_empty() {
            return Err("source_device_id is required".to_string());
        }

        let repo = self.repository.lock().await;
        let item = repo
            .find_by_id(item_id)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Item not found: {}", item_id))?;

        if item.is_deleted {
            return Err("Cannot publish a deleted item".to_string());
        }

        let payload_json = serde_json::to_string(&item)
            .map_err(|e| format!("Failed to encode sync payload: {}", e))?;

        repo.publish_sync_slot_local(
            &payload_json,
            &item.type_,
            source_device_id,
            &item.content_hash,
            Some(chrono::Utc::now().timestamp_millis()),
        )
        .await
        .map_err(|e| e.to_string())
    }

    pub async fn publish_sync_slot_payload(
        &self,
        payload_json: &str,
        payload_type: &str,
        source_device_id: &str,
        content_hash: &str,
        logical_ts_ms: Option<i64>,
    ) -> Result<SyncLatestSlot, String> {
        let payload_json_trimmed = payload_json.trim();
        let payload_type = payload_type.trim();
        let source_device_id = source_device_id.trim();
        let content_hash = content_hash.trim();

        if payload_json_trimmed.is_empty() {
            return Err("payload_json is required".to_string());
        }
        if payload_type.is_empty() {
            return Err("payload_type is required".to_string());
        }
        if source_device_id.is_empty() {
            return Err("source_device_id is required".to_string());
        }
        if content_hash.is_empty() {
            return Err("content_hash is required".to_string());
        }

        let repo = self.repository.lock().await;
        repo.publish_sync_slot_local(
            payload_json,
            payload_type,
            source_device_id,
            content_hash,
            logical_ts_ms,
        )
        .await
        .map_err(|e| e.to_string())
    }

    pub async fn apply_remote_sync_slot(
        &self,
        incoming: SyncIncomingSlot,
    ) -> Result<SyncApplyResult, String> {
        let repo = self.repository.lock().await;
        repo.apply_remote_sync_slot(&incoming)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn list_paired_sync_devices(&self) -> Result<Vec<PairedSyncDevice>, String> {
        let repo = self.repository.lock().await;
        repo.list_paired_sync_devices()
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn get_paired_sync_device(
        &self,
        device_id: &str,
    ) -> Result<Option<PairedSyncDevice>, String> {
        let repo = self.repository.lock().await;
        repo.get_paired_sync_device(device_id)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn upsert_paired_sync_device(
        &self,
        device_id: &str,
        device_name: &str,
        pair_token: &str,
        last_host: Option<&str>,
        last_port: Option<u16>,
    ) -> Result<PairedSyncDevice, String> {
        let repo = self.repository.lock().await;
        repo.upsert_paired_sync_device(device_id, device_name, pair_token, last_host, last_port)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn touch_paired_sync_device(
        &self,
        device_id: &str,
        last_host: Option<&str>,
        last_port: Option<u16>,
    ) -> Result<(), String> {
        let repo = self.repository.lock().await;
        repo.touch_paired_sync_device(device_id, last_host, last_port)
            .await
            .map_err(|e| e.to_string())
    }

    pub async fn remove_paired_sync_device(&self, device_id: &str) -> Result<(), String> {
        let repo = self.repository.lock().await;
        repo.remove_paired_sync_device(device_id)
            .await
            .map_err(|e| e.to_string())
    }

    fn schedule_link_preview_enrichment(&self, item: &ClipboardItem) {
        if item.type_ != "link" {
            return;
        }

        let Some(url) = item.content.clone() else {
            return;
        };

        let repo = self.repository.clone();
        let app_handle = self.app_handle.clone();
        let item_id = item.id.clone();
        let metadata = item.metadata.clone();

        tokio::spawn(async move {
            Self::try_enrich_link_preview(repo, app_handle, item_id, metadata.as_deref(), &url)
                .await;
        });
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

        // Load the current item first.
        if let Some(mut item) = repo.find_by_id(id).await? {
            // Toggle favorite state.
            item.is_favorite = !item.is_favorite;

            repo.update(&item).await?;
            Ok(item.is_favorite)
        } else {
            Err(sqlx::Error::RowNotFound)
        }
    }

    pub fn update_ai_config(&self, config: AIConfig) {
        let mut ai_config = self.ai_config.lock();
        *ai_config = config;
    }

    pub fn update_ocr_service(&self, service: Option<OcrService>) {
        let mut ocr_service = self.ocr_config.lock();
        *ocr_service = service;
    }

    // ========== MCP Methods ==========

    /// Search clipboard items.
    pub async fn search_items(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        self.search_items_with_filters(query, crate::core::models::SearchFilters::default(), limit)
            .await
    }

    /// Search clipboard items with explicit filters.
    pub async fn search_items_with_filters(
        &self,
        query: &str,
        filters: crate::core::models::SearchFilters,
        limit: usize,
    ) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.search(query, &filters, limit as i32).await
    }

    /// Get recent items.
    pub async fn get_recent_items(&self, limit: usize) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_recent(limit as i32).await
    }

    /// Get one item by ID.
    pub async fn get_item_by_id(&self, id: &str) -> Result<Option<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.find_by_id(id).await
    }

    /// Add a text item.
    pub async fn add_text_item(
        &self,
        content: &str,
        notes: Option<&str>,
    ) -> Result<ClipboardItem, Box<dyn std::error::Error>> {
        let hash = blake3::hash(content.as_bytes()).to_hex().to_string();

        let metadata = self.platform.get_active_window_info().unwrap_or_else(|_| {
            crate::core::models::WindowMetadata {
                source_app: "MCP".to_string(),
                window_title: "".to_string(),
                source_url: None,
                is_self: false,
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

    /// Get aggregate statistics.
    pub async fn get_statistics(&self) -> Result<serde_json::Value, sqlx::Error> {
        let repo = self.repository.lock().await;

        // Total active items.
        let total: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM clipboard_items WHERE is_deleted = 0")
                .fetch_one(repo.pool())
                .await?;

        // Count by item type.
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

    /// Clear all clipboard data.
    pub async fn clear_all_items(&self) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        // Fetch all image items and delete their files before clearing DB
        let image_items: Vec<ClipboardItem> = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items WHERE type = 'image'",
        )
        .fetch_all(repo.pool())
        .await
        .unwrap_or_default();
        for item in &image_items {
            Self::cleanup_image_files(&item.type_, item.image_paths.as_deref());
        }
        sqlx::query("DELETE FROM clipboard_items")
            .execute(repo.pool())
            .await?;
        let _ = repo.delete_all_raw_formats().await;
        let _ = repo.clear_sync_latest_slot().await;
        let _ = repo.clear_paired_sync_devices().await;
        Ok(())
    }

    /// Get all non-deleted items (for export).
    pub async fn get_all_items(&self) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        let items = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items WHERE is_deleted = 0 ORDER BY created_at ASC",
        )
        .fetch_all(repo.pool())
        .await?;
        Ok(items)
    }

    /// Insert by content hash if not exists (used by import).
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

    /// Resolve image storage paths.
    /// Delete image files (original + thumbnail) using type and stored path payload.
    fn cleanup_image_files(item_type: &str, image_paths: Option<&str>) {
        if item_type != "image" {
            return;
        }
        if let Some(paths_str) = image_paths {
            if let Ok(paths) = serde_json::from_str::<serde_json::Value>(paths_str) {
                for key in &["original", "thumbnail"] {
                    if let Some(p) = paths[key].as_str() {
                        if let Err(e) = std::fs::remove_file(p) {
                            if e.kind() != std::io::ErrorKind::NotFound {
                                eprintln!("[Delete] failed to delete {}: {}", p, e);
                            }
                        }
                    }
                }
            } else {
                // Legacy single-path format
                let _ = std::fs::remove_file(paths_str);
                let thumb = paths_str.replace(".png", "_thumb.png");
                let _ = std::fs::remove_file(&thumb);
            }
        }
    }

    fn promote_pixpin_image_file_to_item(
        paths_str: &str,
        metadata: &WindowMetadata,
        image_dir: &Path,
        source_app: &str,
    ) -> Result<Option<ClipboardItem>, Box<dyn std::error::Error>> {
        let Some(path_str) = Self::single_file_path(paths_str) else {
            return Ok(None);
        };

        let source_path = Path::new(path_str);
        if !source_path.is_file() {
            return Ok(None);
        }

        let pixpin_source =
            Self::is_pixpin_source(source_app) || Self::is_pixpin_capture_path(source_path);
        if !pixpin_source {
            return Ok(None);
        }

        let extension = source_path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();

        if !Self::is_promotable_image_extension(&extension) {
            return Ok(None);
        }

        let Some((source_bytes, decoded)) = Self::read_and_decode_image_with_retry(source_path, 8, 25)
        else {
            eprintln!(
                "Skipped PixPin image-file promotion: decode failed after retries for '{}'",
                path_str
            );
            return Ok(None);
        };

        let rgba = decoded.to_rgba8();
        let mut normalized_png = Vec::new();
        {
            use image::codecs::png::PngEncoder;
            use image::ImageEncoder;
            let encoder = PngEncoder::new(&mut normalized_png);
            encoder
                .write_image(
                    rgba.as_raw(),
                    decoded.width(),
                    decoded.height(),
                    image::ColorType::Rgba8.into(),
                )
                .map_err(|e| format!("Failed to encode promoted image as png: {}", e))?;
        }

        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)?
            .as_millis();
        let filename = format!("{}.png", timestamp);
        let thumb_filename = format!("{}_thumb.png", timestamp);
        let image_path = image_dir.join(&filename);
        let thumb_path = image_dir.join(&thumb_filename);

        std::fs::write(&image_path, &normalized_png)?;

        let thumbnail = crate::core::thumbnail::generate_thumbnail(&decoded, 300);
        if let Err(error) = thumbnail.save(&thumb_path) {
            eprintln!(
                "Failed to save promoted image thumbnail for '{}': {}. Fallback to source copy.",
                path_str, error
            );
            std::fs::copy(&image_path, &thumb_path)?;
        }

        let image_paths_json = serde_json::json!({
            "original": image_path.to_string_lossy().to_string(),
            "thumbnail": thumb_path.to_string_lossy().to_string()
        })
        .to_string();

        let now = chrono::Utc::now().timestamp();
        let item = ClipboardItem {
            id: uuid::Uuid::new_v4().to_string(),
            type_: "image".to_string(),
            content: Some(format!("[Image: {}]", filename)),
            original_content: None,
            content_hash: blake3::hash(&normalized_png).to_hex().to_string(),
            image_paths: Some(image_paths_json),
            ocr_text: None,
            code_language: None,
            embedding: None,
            tags: None,
            user_note: None,
            metadata: Some(serde_json::to_string(metadata).unwrap()),
            is_pinned: false,
            is_favorite: false,
            is_deleted: false,
            pinned_at: None,
            created_at: now,
            updated_at: now,
            has_raw_formats: false,
            content_truncated: false,
            ocr_truncated: false,
            content_updated: false,
        };

        Ok(Some(item))
    }

    fn single_file_path(paths_str: &str) -> Option<&str> {
        let mut iter = paths_str.lines().map(str::trim).filter(|p| !p.is_empty());
        let path = iter.next()?;
        if iter.next().is_some() {
            return None;
        }
        Some(path)
    }

    fn is_pixpin_source(source_app: &str) -> bool {
        source_app.to_ascii_lowercase().contains("pixpin")
    }

    fn is_pixpin_capture_path(path: &Path) -> bool {
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        if file_name.starts_with("pixpin_") {
            return true;
        }

        let full_path = path.to_string_lossy().to_ascii_lowercase();
        full_path.contains("pixpin")
    }

    fn read_and_decode_image_with_retry(
        path: &Path,
        retries: usize,
        delay_ms: u64,
    ) -> Option<(Vec<u8>, image::DynamicImage)> {
        let total = retries.max(1);
        for attempt in 0..total {
            if let Ok(bytes) = std::fs::read(path) {
                if !bytes.is_empty() {
                    if let Ok(image) = image::load_from_memory(&bytes) {
                        return Some((bytes, image));
                    }
                }
            }

            if attempt + 1 < total {
                std::thread::sleep(std::time::Duration::from_millis(delay_ms));
            }
        }
        None
    }

    fn is_promotable_image_extension(extension: &str) -> bool {
        matches!(
            extension,
            "bmp" | "png" | "jpg" | "jpeg" | "webp" | "gif" | "tif" | "tiff"
        )
    }

    pub fn image_dir(&self) -> &std::path::Path {
        &self.image_dir
    }

    /// Get raw clipboard formats for an item (for export).
    pub async fn get_raw_formats(
        &self,
        item_id: &str,
    ) -> Result<Vec<(String, Vec<u8>)>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_raw_formats(item_id).await
    }

    /// Insert raw clipboard formats for an item (for import).
    pub async fn insert_raw_formats(
        &self,
        item_id: &str,
        formats: &[(String, Vec<u8>)],
    ) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.insert_raw_formats(item_id, formats).await
    }

    /// Clear all clipboard data (items and images).
    pub async fn clear_all_data(&self) -> Result<(), String> {
        let repo = self.repository.lock().await;

        // Delete all items from database
        sqlx::query("DELETE FROM clipboard_items")
            .execute(repo.pool())
            .await
            .map_err(|e| format!("Failed to delete items: {}", e))?;

        // Delete all raw formats
        sqlx::query("DELETE FROM clipboard_raw_formats")
            .execute(repo.pool())
            .await
            .map_err(|e| format!("Failed to delete raw formats: {}", e))?;

        sqlx::query("DELETE FROM sync_latest_slot")
            .execute(repo.pool())
            .await
            .map_err(|e| format!("Failed to delete sync latest slot: {}", e))?;

        sqlx::query("DELETE FROM sync_paired_devices")
            .execute(repo.pool())
            .await
            .map_err(|e| format!("Failed to delete paired sync devices: {}", e))?;

        // Delete all image files
        if self.image_dir.exists() {
            std::fs::remove_dir_all(&self.image_dir)
                .map_err(|e| format!("Failed to delete images: {}", e))?;
            std::fs::create_dir_all(&self.image_dir)
                .map_err(|e| format!("Failed to recreate image directory: {}", e))?;
        }

        Ok(())
    }

    fn compute_content_hash(content: &ClipboardContent) -> String {
        match content {
            ClipboardContent::Text {
                plain: ref text, ..
            } => blake3::hash(text.as_bytes()).to_hex().to_string(),
            ClipboardContent::Image(data) => blake3::hash(data).to_hex().to_string(),
            ClipboardContent::File(paths_str) => {
                blake3::hash(paths_str.as_bytes()).to_hex().to_string()
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
                    is_self: false,
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
