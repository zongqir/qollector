use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ClipboardItem {
    pub id: String,
    #[sqlx(rename = "type")]
    pub type_: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_content: Option<String>,
    pub content_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub image_paths: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ocr_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub embedding: Option<Vec<u8>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_note: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<String>,
    pub is_pinned: bool,
    pub is_favorite: bool,
    pub is_deleted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned_at: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    #[sqlx(default)]
    pub pin_order: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    #[sqlx(default)]
    pub favorite_order: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(default)]
    #[sqlx(default)]
    pub workbench_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    #[sqlx(default)]
    pub has_raw_formats: bool,
    #[serde(default)]
    #[sqlx(default)]
    pub content_truncated: bool,
    #[serde(default)]
    #[sqlx(default)]
    pub ocr_truncated: bool,
    #[serde(default)]
    #[sqlx(default)]
    pub content_updated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SyncLatestSlot {
    pub slot_id: String,
    pub payload_json: String,
    pub payload_type: String,
    pub source_device_id: String,
    pub source_seq: i64,
    pub logical_ts_ms: i64,
    pub content_hash: String,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncIncomingSlot {
    pub payload_json: String,
    pub payload_type: String,
    pub source_device_id: String,
    pub source_seq: i64,
    pub logical_ts_ms: i64,
    pub content_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncApplyResult {
    pub applied: bool,
    pub reason: String,
    pub slot: Option<SyncLatestSlot>,
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
            pin_order: None,
            favorite_order: None,
            workbench_id: None,
            created_at: now,
            updated_at: now,
            has_raw_formats: false,
            content_truncated: false,
            ocr_truncated: false,
            content_updated: false,
        }
    }

    fn has_disallowed_fullwidth_punctuation(text: &str) -> bool {
        text.chars().any(|c| {
            matches!(
                c,
                '。'
                    | '，'
                    | '、'
                    | '；'
                    | '：'
                    | '！'
                    | '？'
                    | '（'
                    | '）'
                    | '【'
                    | '】'
                    | '《'
                    | '》'
                    | '“'
                    | '”'
                    | '‘'
                    | '’'
                    | '…'
                    | '—'
            )
        })
    }

    fn is_likely_domain_host(host: &str) -> bool {
        if host.is_empty() || host.starts_with('.') || host.ends_with('.') {
            return false;
        }

        let labels: Vec<&str> = host.split('.').collect();
        if labels.len() < 2 {
            return false;
        }

        let mut has_alpha = false;
        for label in &labels {
            if label.is_empty() || label.len() > 63 {
                return false;
            }

            let bytes = label.as_bytes();
            let first = bytes.first().copied().unwrap_or_default();
            let last = bytes.last().copied().unwrap_or_default();
            if !first.is_ascii_alphanumeric() || !last.is_ascii_alphanumeric() {
                return false;
            }

            if !bytes
                .iter()
                .all(|b| b.is_ascii_alphanumeric() || *b == b'-')
            {
                return false;
            }

            if bytes.iter().any(|b| b.is_ascii_alphabetic()) {
                has_alpha = true;
            }
        }

        let tld = labels.last().copied().unwrap_or_default();
        if tld.len() < 2 {
            return false;
        }

        has_alpha
    }

    fn is_bare_url_candidate(text: &str) -> bool {
        if text.is_empty()
            || text.contains(char::is_whitespace)
            || text.starts_with('.')
            || text.ends_with('.')
            // Bare text containing '@' is usually an email address, not a link.
            || text.contains('@')
        {
            return false;
        }

        if Self::has_disallowed_fullwidth_punctuation(text) {
            return false;
        }

        true
    }

    fn is_supported_link_scheme(scheme: &str) -> bool {
        matches!(scheme, "http" | "https" | "ftp" | "ftps" | "ws" | "wss")
    }

    fn is_valid_link_host(host: &str) -> bool {
        if host.parse::<std::net::IpAddr>().is_ok() {
            return true;
        }

        Self::is_likely_domain_host(host)
    }

    // 检测是否为URL：显式链接 + 裸域名（无协议）两段式判断
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

        // 1) 显式 URL（带协议）
        if let Ok(parsed_url) = url::Url::parse(trimmed) {
            if !Self::is_supported_link_scheme(parsed_url.scheme()) {
                return false;
            }

            if let Some(host) = parsed_url.host_str() {
                return Self::is_valid_link_host(host);
            }

            return false;
        }

        // 2) 裸域名 / 无协议链接（如 mp.weixin.qq.com、tmp.link/abc）
        if !Self::is_bare_url_candidate(trimmed) {
            return false;
        }

        if let Ok(parsed_url) = url::Url::parse(&format!("https://{}", trimmed)) {
            if !Self::is_supported_link_scheme(parsed_url.scheme()) {
                return false;
            }

            if let Some(host) = parsed_url.host_str() {
                return Self::is_valid_link_host(host);
            }
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
            pin_order: None,
            favorite_order: None,
            workbench_id: None,
            created_at: now,
            updated_at: now,
            has_raw_formats: false,
            content_truncated: false,
            ocr_truncated: false,
            content_updated: false,
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
    pub is_self: bool,
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
    pub source_filter: Option<Vec<String>>,
    pub type_tag_filter: Option<Vec<String>>,
    pub date_range: Option<DateRange>,
    pub is_pinned: Option<bool>,
    pub is_favorite: Option<bool>,
    pub workbench_id: Option<String>,
    pub require_code_language: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Workbench {
    pub id: String,
    pub name: String,
    pub is_default: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[cfg(test)]
mod tests {
    use super::ClipboardItem;

    #[test]
    fn detects_bare_domain_without_scheme() {
        assert!(ClipboardItem::is_url("mp.weixin.qq.com"));
        assert!(ClipboardItem::is_url("tmp.link/abc"));
    }

    #[test]
    fn rejects_plain_text_with_fullwidth_period() {
        assert!(!ClipboardItem::is_url("你好。"));
        assert!(!ClipboardItem::is_url("这是一句话。"));
    }

    #[test]
    fn rejects_invalid_domain_shape() {
        assert!(!ClipboardItem::is_url("a."));
        assert!(!ClipboardItem::is_url("example"));
    }

    #[test]
    fn keeps_explicit_url_and_ip() {
        assert!(ClipboardItem::is_url("https://mp.weixin.qq.com/path"));
        assert!(ClipboardItem::is_url("https://127.0.0.1:5173"));
        assert!(ClipboardItem::is_url("127.0.0.1:5173"));
    }

    #[test]
    fn real_world_clipboard_samples() {
        // Common bare domains should still be treated as links.
        assert!(ClipboardItem::is_url("www.qq.com"));
        assert!(ClipboardItem::is_url("docs.rs/serde"));
        assert!(!ClipboardItem::is_url("mp.weixin.qq.com。"));

        // Wrapped links copied from Chinese text are treated as plain text.
        assert!(!ClipboardItem::is_url("（mp.weixin.qq.com）"));
        assert!(!ClipboardItem::is_url("“mp.weixin.qq.com”"));

        // Full sentences that contain a domain are not pure-link clipboard items.
        assert!(!ClipboardItem::is_url("我在搜 mp.weixin.qq.com"));

        // Email-like strings should remain text when no explicit scheme is provided.
        assert!(!ClipboardItem::is_url("foo@bar.com"));

        // Explicit URL with user info is still a valid URL.
        assert!(ClipboardItem::is_url("https://user:pass@example.com/path"));
    }
}

impl Default for SearchFilters {
    fn default() -> Self {
        Self {
            type_filter: None,
            tag_filter: None,
            source_filter: None,
            type_tag_filter: None,
            date_range: None,
            is_pinned: None,
            is_favorite: None,
            workbench_id: None,
            require_code_language: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DateRange {
    pub start: i64,
    pub end: i64,
}
