use crate::core::models::{ClipboardItem, ClipboardContent, WindowMetadata};
use crate::platform::clipboard_trait::{PlatformClipboard, ClipboardError, ClipboardCallback};
use crate::repository::clipboard_repo::ClipboardRepository;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::path::PathBuf;

pub struct ClipboardManager {
    platform: Arc<dyn PlatformClipboard>,
    repository: Arc<Mutex<ClipboardRepository>>,
    image_dir: PathBuf,
}

impl ClipboardManager {
    pub fn new(platform: Arc<dyn PlatformClipboard>, repository: ClipboardRepository, app_dir: PathBuf) -> Self {
        let image_dir = app_dir.join("images");
        std::fs::create_dir_all(&image_dir).expect("Failed to create images directory");

        Self {
            platform,
            repository: Arc::new(Mutex::new(repository)),
            image_dir,
        }
    }

    pub async fn start_monitoring(&self) -> Result<(), ClipboardError> {
        let repo = self.repository.clone();
        let platform = self.platform.clone();
        let image_dir = self.image_dir.clone();

        let callback: ClipboardCallback = Box::new(move |content| {
            let repo = repo.clone();
            let platform = platform.clone();
            let image_dir = image_dir.clone();

            Box::pin(async move {
                if let Err(e) = Self::handle_clipboard_change(content, repo, platform, image_dir).await {
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
        repo: Arc<Mutex<ClipboardRepository>>,
        platform: Arc<dyn PlatformClipboard>,
        image_dir: PathBuf,
    ) -> Result<(), Box<dyn std::error::Error>> {
        println!("Handling clipboard change...");

        let metadata = platform.get_active_window_info()
            .unwrap_or_else(|_| WindowMetadata {
                source_app: "Unknown".to_string(),
                window_title: "".to_string(),
                source_url: None,
            });

        let item = match content {
            ClipboardContent::Text(text) => {
                if text.trim().is_empty() {
                    println!("Clipboard text is empty, skipping");
                    return Ok(());
                }
                println!("Creating clipboard item for text: {} chars", text.len());
                ClipboardItem::new_text(text, metadata)
            }
            ClipboardContent::Image(data) => {
                println!("Image clipboard content detected, saving...");

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

                let mut item = ClipboardItem::new_text(
                    format!("[Image: {}]", filename),
                    metadata
                );
                item.type_ = "image".to_string();
                item.image_paths = Some(image_paths_json);
                item
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
                item
            }
        };

        let repo_lock = repo.lock().await;

        if let Some(existing) = repo_lock.find_by_hash(&item.content_hash).await? {
            println!("Duplicate detected, moving to top: {}", existing.id);
            repo_lock.touch(&existing.id).await?;
            return Ok(());
        }

        println!("Inserting new clipboard item: {}", item.id);
        repo_lock.insert(&item).await?;
        println!("Clipboard item saved successfully!");
        Ok(())
    }

    pub async fn get_recent(&self, limit: i32) -> Result<Vec<ClipboardItem>, sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.get_recent(limit).await
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

    pub async fn update_ocr_text(&self, id: &str, ocr_text: &str) -> Result<(), sqlx::Error> {
        let repo = self.repository.lock().await;
        repo.update_ocr_text(id, ocr_text).await
    }

    pub async fn toggle_pin(&self, id: &str) -> Result<bool, sqlx::Error> {
        let repo = self.repository.lock().await;

        // 获取当前项目
        if let Some(mut item) = repo.find_by_id(id).await? {
            // 切换置顶状态
            item.is_pinned = !item.is_pinned;
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
}
