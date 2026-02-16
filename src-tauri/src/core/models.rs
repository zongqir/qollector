use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ClipboardItem {
    pub id: String,
    #[sqlx(rename = "type")]
    pub type_: String,
    pub content: Option<String>,
    pub original_content: Option<String>,
    pub content_hash: String,
    pub image_paths: Option<String>,
    pub ocr_text: Option<String>,
    pub code_language: Option<String>,
    pub embedding: Option<Vec<u8>>,
    pub tags: Option<String>,
    pub user_note: Option<String>,
    pub metadata: Option<String>,
    pub is_pinned: bool,
    pub is_favorite: bool,
    pub is_deleted: bool,
    pub pinned_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    #[sqlx(default)]
    pub has_raw_formats: bool,
}

impl ClipboardItem {
    pub fn new_text(content: String, metadata: WindowMetadata) -> Self {
        let hash = Self::calculate_hash(&content);
        let now = chrono::Utc::now().timestamp();

        // 检测是否为链接
        let item_type = if Self::is_url(&content) {
            "link"
        } else {
            "text"
        };

        Self {
            id: uuid::Uuid::new_v4().to_string(),
            type_: item_type.to_string(),
            content: Some(content.clone()),
            original_content: Some(content),
            content_hash: hash,
            image_paths: None,
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

    // 检测是否为URL - 使用 url crate 进行正确的解析
    fn is_url(text: &str) -> bool {
        let trimmed = text.trim();

        // 必须是单行文本
        if trimmed.contains('\n') || trimmed.contains('\r') {
            return false;
        }

        // 长度限制
        if trimmed.is_empty() || trimmed.len() > 2048 {
            return false;
        }

        // 使用 url crate 解析
        if let Ok(parsed_url) = url::Url::parse(trimmed) {
            // 必须有scheme（协议）
            let scheme = parsed_url.scheme();

            // 只接受常见的网络协议
            let valid_schemes = ["http", "https", "ftp", "ftps", "ws", "wss"];
            if !valid_schemes.contains(&scheme) {
                return false;
            }

            // 必须有host（域名或IP）
            if parsed_url.host().is_none() {
                return false;
            }

            return true;
        }

        false
    }

    pub fn new_image(raw_path: String, thumb_path: String, metadata: WindowMetadata) -> Self {
        let hash = Self::calculate_hash(&raw_path);
        let now = chrono::Utc::now().timestamp();

        let image_paths = serde_json::json!({
            "raw": raw_path,
            "thumb": thumb_path,
        });

        Self {
            id: uuid::Uuid::new_v4().to_string(),
            type_: "image".to_string(),
            content: None,
            original_content: None,
            content_hash: hash,
            image_paths: Some(image_paths.to_string()),
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

    fn calculate_hash(content: &str) -> String {
        blake3::hash(content.as_bytes()).to_hex().to_string()
    }

    pub fn get_image_paths(&self) -> Option<ImagePaths> {
        self.image_paths
            .as_ref()
            .and_then(|json| serde_json::from_str(json).ok())
    }

    pub fn get_metadata(&self) -> Option<WindowMetadata> {
        self.metadata
            .as_ref()
            .and_then(|json| serde_json::from_str(json).ok())
    }

    pub fn get_tags(&self) -> Vec<String> {
        self.tags
            .as_ref()
            .and_then(|json| serde_json::from_str(json).ok())
            .unwrap_or_default()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImagePaths {
    pub raw: String,
    pub thumb: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowMetadata {
    pub source_app: String,
    pub window_title: String,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ClipboardContent {
    Text {
        plain: String,
        raw_formats: Option<Vec<(String, Vec<u8>)>>,
    },
    Image(Vec<u8>),
    File(String),
}

impl ClipboardContent {
    pub fn get_type(&self) -> &str {
        match self {
            Self::Text { .. } => "text",
            Self::Image(_) => "image",
            Self::File(_) => "file",
        }
    }

    pub fn to_string(&self) -> String {
        match self {
            Self::Text { plain, .. } => plain.clone(),
            Self::Image(_) => "[Image]".to_string(),
            Self::File(path) => path.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchFilters {
    pub type_filter: Option<String>,
    pub tag_filter: Option<Vec<String>>,
    pub date_range: Option<DateRange>,
    pub is_pinned: Option<bool>,
    pub is_favorite: Option<bool>,
}

impl Default for SearchFilters {
    fn default() -> Self {
        Self {
            type_filter: None,
            tag_filter: None,
            date_range: None,
            is_pinned: None,
            is_favorite: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DateRange {
    pub start: i64,
    pub end: i64,
}
