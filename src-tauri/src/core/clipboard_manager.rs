use crate::core::models::{ClipboardItem, ClipboardContent, WindowMetadata};
use crate::platform::clipboard_trait::{PlatformClipboard, ClipboardError, ClipboardCallback};
use crate::repository::clipboard_repo::ClipboardRepository;
use crate::repository::config_repo::ConfigRepository;
use crate::ai::{AIConfig, AIService};
use crate::ocr::OcrService;
use std::sync::{Arc, Mutex};
use tokio::sync::{Mutex as TokioMutex, Semaphore};
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Emitter;

pub struct ClipboardManager {
    platform: Arc<dyn PlatformClipboard>,
    repository: Arc<TokioMutex<ClipboardRepository>>,
    config_repo: Arc<ConfigRepository>,
    image_dir: PathBuf,
    ai_config: Arc<Mutex<AIConfig>>,
    ocr_config: Arc<Mutex<Option<OcrService>>>,
    ai_semaphore: Arc<Semaphore>, // AI请求串行化控制
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
            ai_semaphore: Arc::new(Semaphore::new(1)), // 只允许1个AI请求同时执行
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
        let app_handle = self.app_handle.clone();

        let callback: ClipboardCallback = Box::new(move |content, metadata| {
            let repo = repo.clone();
            let config_repo = config_repo.clone();
            let image_dir = image_dir.clone();
            let ai_config = ai_config.clone();
            let ocr_config = ocr_config.clone();
            let ai_semaphore = ai_semaphore.clone();
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
                    app_handle,
                ).await {
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
        app_handle: AppHandle,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("Handling clipboard change...");

        let item = match content {
            ClipboardContent::Text(text) => {
                // 检查是否为空白内容
                if text.trim().is_empty() {
                    // 统计换行符数量
                    let newline_count = text.matches('\n').count();

                    // 如果换行符少于3个，认为是无意义的短空白，跳过
                    if newline_count < 3 {
                        println!("Clipboard text is empty or too short (newlines: {}), skipping", newline_count);
                        return Ok(());
                    }

                    // 超过3行的空白可能有意义，保留
                    println!("Clipboard text is blank but has {} newlines, keeping", newline_count);
                }
                println!("Creating clipboard item for text: {} chars", text.len());
                ClipboardItem::new_text(text, metadata)
            }
            ClipboardContent::Image(data) => {
                println!("Image clipboard content detected, saving...");

                // 计算图片内容的MD5哈希
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
                }).to_string();

                let now = chrono::Utc::now().timestamp();
                ClipboardItem {
                    id: uuid::Uuid::new_v4().to_string(),
                    type_: "image".to_string(),
                    content: Some(format!("[Image: {}]", filename)),
                    original_content: None,
                    content_hash: image_hash, // 使用图片内容的MD5
                    image_paths: Some(image_paths_json),
                    ocr_text: None,
                    embedding: None,
                    tags: None,
                    user_note: None,
                    metadata: Some(serde_json::to_string(&metadata).unwrap()),
                    is_pinned: false,
                    is_favorite: false,
                    is_deleted: false,
                    created_at: now,
                    updated_at: now,
                }
            }
            ClipboardContent::File(paths_str) => {
                println!("File clipboard content detected");

                let paths: Vec<&str> = paths_str.lines().collect();
                let file_count = paths.len();

                // Create a summary of files
                let file_names: Vec<String> = paths.iter()
                    .map(|p| {
                        std::path::Path::new(p)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or(p)
                            .to_string()
                    })
                    .collect();

                let summary = if file_count == 1 {
                    format!("文件: {}", file_names[0])
                } else {
                    format!("{} 个文件: {}", file_count, file_names.join(", "))
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

        let repo_lock = repo.lock().await;

        if let Some(existing) = repo_lock.find_by_hash(&item.content_hash).await? {
            println!("Duplicate detected, moving to top: {}", existing.id);
            repo_lock.touch(&existing.id).await?;
            drop(repo_lock);
            let _ = app_handle.emit("clipboard-changed", ());
            return Ok(());
        }

        println!("Inserting new clipboard item: {}", item.id);
        let item_id = item.id.clone();
        let item_type = item.type_.clone();
        let item_content = item.content.clone();
        let item_image_paths = item.image_paths.clone();

        repo_lock.insert(&item).await?;
        drop(repo_lock); // 释放锁
        let _ = app_handle.emit("clipboard-changed", ());
        println!("Clipboard item saved successfully!");

        // 后台异步处理AI标签和OCR
        let repo_clone = repo.clone();
        let config_repo_clone = config_repo.clone();
        let ai_config_clone = ai_config.clone();
        let ocr_config_clone = ocr_config.clone();
        let ai_semaphore_clone = ai_semaphore.clone();

        tokio::spawn(async move {
            // 根据类型决定处理流程
            if item_type == "image" {
                // 图片：先OCR，再基于OCR文字生成AI标签
                if let Some(image_paths_str) = item_image_paths {
                    let ocr_service_opt = ocr_config_clone.lock().unwrap().clone();
                    let mut ocr_text = String::new();

                    // 步骤1: 执行OCR
                    if let Some(service) = ocr_service_opt {
                        let config = service.get_config();
                        if config.enabled && config.auto_ocr {
                            println!("自动执行OCR: item_id={}", item_id);

                            // 解析图片路径
                            let image_path = if let Ok(paths) = serde_json::from_str::<serde_json::Value>(&image_paths_str) {
                                paths["original"].as_str().unwrap_or("").to_string()
                            } else {
                                image_paths_str.clone()
                            };

                            if !image_path.is_empty() {
                                match service.recognize(&image_path).await {
                                    Ok(result) if !result.text.trim().is_empty() => {
                                        ocr_text = result.text.clone();
                                        let repo_lock = repo_clone.lock().await;
                                        let _ = repo_lock.update_ocr_text(&item_id, &result.text).await;
                                        println!("OCR文本已自动识别: {} 字符", result.text.len());
                                    }
                                    Ok(_) => println!("OCR识别返回空文本"),
                                    Err(e) => eprintln!("OCR识别失败: {}", e),
                                }
                            }
                        }
                    }

                    // 步骤2: 基于OCR文字生成AI标签（串行化）
                    if !ocr_text.is_empty() {
                        let ai_config = ai_config_clone.lock().unwrap().clone();
                        if !ai_config.get_current_api_key().is_empty() {
                            // 获取信号量许可，确保AI请求串行执行
                            let _permit = ai_semaphore_clone.acquire().await.unwrap();
                            println!("🔒 获取AI请求锁，基于OCR文字生成标签: item_id={}", item_id);

                            // 获取当前语言配置
                            let language = config_repo_clone.load_general_config().await
                                .ok()
                                .flatten()
                                .map(|c| c.language)
                                .unwrap_or_else(|| "zh-CN".to_string());

                            let service = AIService::new(ai_config);
                            match service.generate_tags(&ocr_text, &language).await {
                                Ok(tags) if !tags.is_empty() => {
                                    let ai_tags: Vec<String> = tags.iter()
                                        .map(|t| format!("AI:{}", t))
                                        .collect();

                                    let repo_lock = repo_clone.lock().await;
                                    if let Ok(Some(mut item)) = repo_lock.find_by_id(&item_id).await {
                                        let existing_tags: Vec<String> = item.tags
                                            .as_ref()
                                            .and_then(|t| serde_json::from_str(t).ok())
                                            .unwrap_or_default();

                                        let mut all_tags = existing_tags;
                                        all_tags.extend(ai_tags);

                                        item.tags = Some(serde_json::to_string(&all_tags).unwrap());
                                        let _ = repo_lock.update(&item).await;
                                        println!("✅ AI标签已自动添加（基于OCR）: {:?}", tags);
                                    }
                                }
                                Ok(_) => println!("AI标签生成返回空结果"),
                                Err(e) => eprintln!("❌ AI标签生成失败: {}", e),
                            }
                            // _permit 在这里自动释放
                            println!("🔓 释放AI请求锁");
                        }
                    } else {
                        println!("图片无OCR文字，跳过AI标签生成");
                    }
                }
            } else {
                // 文本/文件：直接生成AI标签（串行化）
                if let Some(content) = item_content.as_ref() {
                    let ai_config = ai_config_clone.lock().unwrap().clone();
                    if !ai_config.get_current_api_key().is_empty() {
                        // 获取信号量许可，确保AI请求串行执行
                        let _permit = ai_semaphore_clone.acquire().await.unwrap();
                        println!("🔒 获取AI请求锁，生成标签: item_id={}, type={}", item_id, item_type);

                        // 获取当前语言配置
                        let language = config_repo_clone.load_general_config().await
                            .ok()
                            .flatten()
                            .map(|c| c.language)
                            .unwrap_or_else(|| "zh-CN".to_string());

                        let service = AIService::new(ai_config);
                        match service.generate_tags(content, &language).await {
                            Ok(tags) if !tags.is_empty() => {
                                let ai_tags: Vec<String> = tags.iter()
                                    .map(|t| format!("AI:{}", t))
                                    .collect();

                                let repo_lock = repo_clone.lock().await;
                                if let Ok(Some(mut item)) = repo_lock.find_by_id(&item_id).await {
                                    let existing_tags: Vec<String> = item.tags
                                        .as_ref()
                                        .and_then(|t| serde_json::from_str(t).ok())
                                        .unwrap_or_default();

                                    let mut all_tags = existing_tags;
                                    all_tags.extend(ai_tags);

                                    item.tags = Some(serde_json::to_string(&all_tags).unwrap());
                                    let _ = repo_lock.update(&item).await;
                                    println!("✅ AI标签已自动添加: {:?}", tags);
                                }
                            }
                            Ok(_) => println!("AI标签生成返回空结果"),
                            Err(e) => eprintln!("❌ AI标签生成失败: {}", e),
                        }
                        // _permit 在这里自动释放
                        println!("🔓 释放AI请求锁");
                    }
                }
            }
        });

        Ok(())
    }

    pub async fn get_recent(&self, limit: i32) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_recent(limit).await
    }

    pub async fn get_recent_light(&self, limit: i32) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_recent_light(limit).await
    }

    pub async fn get_recent_paged(&self, limit: i32, offset: i32) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_recent_paged(limit, offset).await
    }

    pub async fn copy_to_clipboard(&self, item: &ClipboardItem) -> Result<(), ClipboardError> {
        let content = if item.type_ == "image" {
            // Load original image from file
            if let Some(image_paths_str) = &item.image_paths {
                // Try to parse as JSON first (new format)
                let image_path = if let Ok(paths) = serde_json::from_str::<serde_json::Value>(image_paths_str) {
                    paths["original"].as_str().unwrap_or(image_paths_str).to_string()
                } else {
                    // Fallback to old format (direct path string)
                    image_paths_str.clone()
                };

                let data = std::fs::read(&image_path)
                    .map_err(|e| ClipboardError::PlatformError(format!("Failed to read image: {}", e)))?;
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

        // 如果是置顶项,更新其时间戳以保持活跃
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

    pub async fn find_by_hash(&self, content_hash: &str) -> Result<Option<ClipboardItem>, sqlx::Error> {
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

        // 获取当前项目
        if let Some(mut item) = repo.find_by_id(id).await? {
            // 切换置顶状态
            let new_pinned_state = !item.is_pinned;

            // 如果是要置顶(从未置顶变为置顶)
            if new_pinned_state {
                // 检查当前置顶数量
                let pinned_items = repo.get_pinned_items().await?;

                // 如果已经达到置顶上限,取消最早置顶的那个
                if pinned_items.len() >= max_pinned {
                    if let Some(oldest_pinned) = pinned_items.first() {
                        println!("已达到置顶上限({}个),取消最早置顶的项: {}", max_pinned, oldest_pinned.id);
                        repo.unpin(&oldest_pinned.id).await?;
                    }
                }
            }

            item.is_pinned = new_pinned_state;
            // 更新时间戳
            item.updated_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;

            repo.update(&item).await?;
            Ok(item.is_pinned)
        } else {
            Err(sqlx::Error::RowNotFound)
        }
    }

    pub async fn pin_item(&self, id: &str, max_pinned: usize) -> Result<bool, sqlx::Error> {
        let repo = self.repository.lock().await;

        if let Some(mut item) = repo.find_by_id(id).await? {
            if item.is_pinned {
                item.updated_at = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_secs() as i64;
                repo.update(&item).await?;
                return Ok(true);
            }

            let pinned_items = repo.get_pinned_items().await?;
            if pinned_items.len() >= max_pinned {
                if let Some(oldest_pinned) = pinned_items.first() {
                    repo.unpin(&oldest_pinned.id).await?;
                }
            }

            item.is_pinned = true;
            item.updated_at = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs() as i64;
            repo.update(&item).await?;
            Ok(true)
        } else {
            Err(sqlx::Error::RowNotFound)
        }
    }

    pub async fn toggle_favorite(&self, id: &str) -> Result<bool, sqlx::Error> {
        let repo = self.repository.lock().await;

        // 获取当前项目
        if let Some(mut item) = repo.find_by_id(id).await? {
            // 切换收藏状态
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

    // ========== MCP 相关方法 ==========

    /// 搜索剪贴板条目
    pub async fn search_items(&self, query: &str, limit: usize) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        let filters = crate::core::models::SearchFilters::default();
        repo.search(query, &filters, limit as i32).await
    }

    /// 获取最近的条目
    pub async fn get_recent_items(&self, limit: usize) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_recent(limit as i32).await
    }

    /// 根据 ID 获取条目
    pub async fn get_item_by_id(&self, id: &str) -> Result<Option<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.find_by_id(id).await
    }

    /// 添加文本条目
    pub async fn add_text_item(&self, content: &str, notes: Option<&str>) -> Result<ClipboardItem, Box<dyn std::error::Error>> {
        use sha2::{Sha256, Digest};

        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        let hash = format!("{:x}", hasher.finalize());

        let metadata = self.platform.get_active_window_info()
            .unwrap_or_else(|_| crate::core::models::WindowMetadata {
                source_app: "MCP".to_string(),
                window_title: "".to_string(),
                source_url: None,
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

    /// 获取统计信息
    pub async fn get_statistics(&self) -> Result<serde_json::Value, sqlx::Error> {
        let repo = self.repository.lock().await;

        // 获取总数
        let total: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clipboard_items WHERE is_deleted = 0")
            .fetch_one(repo.pool())
            .await?;

        // 按类型统计
        let text_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clipboard_items WHERE type = 'text' AND is_deleted = 0")
            .fetch_one(repo.pool())
            .await?;

        let image_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clipboard_items WHERE type = 'image' AND is_deleted = 0")
            .fetch_one(repo.pool())
            .await?;

        let file_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clipboard_items WHERE type = 'file' AND is_deleted = 0")
            .fetch_one(repo.pool())
            .await?;

        let pinned_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clipboard_items WHERE is_pinned = 1 AND is_deleted = 0")
            .fetch_one(repo.pool())
            .await?;

        let favorite_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM clipboard_items WHERE is_favorite = 1 AND is_deleted = 0")
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

    /// 清空所有剪贴板数据
    pub async fn clear_all_items(&self) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        sqlx::query("DELETE FROM clipboard_items")
            .execute(repo.pool())
            .await?;
        Ok(())
    }

    /// 获取所有未删除的条目（导出用）
    pub async fn get_all_items(&self) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        let items = sqlx::query_as::<_, ClipboardItem>(
            "SELECT * FROM clipboard_items WHERE is_deleted = 0 ORDER BY created_at ASC"
        )
        .fetch_all(repo.pool())
        .await?;
        Ok(items)
    }

    /// 按 content_hash 去重插入（导入用），返回是否实际插入
    pub async fn insert_item_if_not_exists(&self, item: &ClipboardItem) -> Result<bool, sqlx::Error> {
        let repo = self.repository.lock().await;
        let existing = repo.find_by_hash(&item.content_hash).await?;
        if existing.is_some() {
            return Ok(false);
        }
        repo.insert(item).await?;
        Ok(true)
    }

    /// 获取图片存储目录
    pub fn image_dir(&self) -> &std::path::Path {
        &self.image_dir
    }
}
