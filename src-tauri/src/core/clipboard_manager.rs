use crate::ai::{AIConfig, AIService};
use crate::core::models::{ClipboardContent, ClipboardItem, WindowMetadata};
use crate::ocr::OcrService;
use crate::platform::clipboard_trait::{ClipboardCallback, ClipboardError, PlatformClipboard};
use crate::repository::clipboard_repo::ClipboardRepository;
use crate::repository::config_repo::ConfigRepository;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::AppHandle;
use tauri::Emitter;
use tokio::sync::{Mutex as TokioMutex, Semaphore};
use url::Host;

const APP_NAME: &str = "ClipBox";
const DOUBLE_COPY_MIN_INTERVAL_MS: u128 = 180;
const DOUBLE_COPY_COOLDOWN_MS: u128 = 900;
const LINK_PREVIEW_MAX_BYTES: usize = 262_144;
const LINK_PREVIEW_TIMEOUT_SECS: u64 = 4;


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
            ai_semaphore: Arc::new(Semaphore::new(1)), // 鍙厑璁?涓狝I璇锋眰鍚屾椂鎵ц
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

        let item = match &content {
            ClipboardContent::Text { plain: text, .. } => {
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
                ClipboardItem::new_text(text.clone(), metadata)
            }
            ClipboardContent::Image(data) => {
                println!("Image clipboard content detected, saving...");

                // 璁＄畻鍥剧墖鍐呭鐨凪D5鍝堝笇
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
                    has_raw_formats: false,
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
                item.content = Some(paths_str.to_string());
                // Use full path payload hash to avoid false collisions on same filename.
                item.content_hash = blake3::hash(paths_str.as_bytes()).to_hex().to_string();
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

            // Save raw clipboard formats (HTML, RTF) if present
            if let ClipboardContent::Text { raw_formats: Some(formats), .. } = &content {
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

    async fn try_enrich_link_preview(
        repo: Arc<TokioMutex<ClipboardRepository>>,
        app_handle: AppHandle,
        item_id: String,
        metadata_json: Option<&str>,
        url: &str,
    ) {
        if let Some(existing_title) = metadata_json
            .and_then(Self::extract_link_preview_title_from_metadata)
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
        if let Err(error) = repo_lock.update_metadata_only(&item_id, &new_metadata).await {
            eprintln!("[LinkPreview] failed to persist title for {}: {}", item_id, error);
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

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(LINK_PREVIEW_TIMEOUT_SECS))
            .redirect(reqwest::redirect::Policy::limited(5))
            .user_agent("ClipBox/1.0")
            .build()
            .ok()?;

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

        // 濡傛灉鏄疆椤堕」,鏇存柊鍏舵椂闂存埑浠ヤ繚鎸佹椿璺?
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
            Self::try_enrich_link_preview(repo, app_handle, item_id, metadata.as_deref(), &url).await;
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

    pub fn image_dir(&self) -> &std::path::Path {
        &self.image_dir
    }

    /// Get raw clipboard formats for an item (for export).
    pub async fn get_raw_formats(&self, item_id: &str) -> Result<Vec<(String, Vec<u8>)>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_raw_formats(item_id).await
    }

    /// Insert raw clipboard formats for an item (for import).
    pub async fn insert_raw_formats(&self, item_id: &str, formats: &[(String, Vec<u8>)]) -> Result<(), sqlx::Error> {
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
            ClipboardContent::Text { plain: ref text, .. } => {
                blake3::hash(text.as_bytes()).to_hex().to_string()
            }
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
