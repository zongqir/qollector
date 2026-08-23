use crate::config::CollectorConfig;
use crate::core::models::ClipboardItem;
use crate::http_client;
use chrono::{Local, Utc};
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;

const MAX_UPLOAD_AGE_SECS: i64 = 24 * 60 * 60;

#[derive(Debug, Clone, Serialize)]
pub struct CollectorUploadStatus {
    pub today_uploaded: i64,
    pub pending: i64,
    pub last_sync_at: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectorSyncResult {
    pub uploaded: i64,
    pub failed: i64,
    pub today_uploaded: i64,
    pub pending: i64,
    pub last_sync_at: Option<i64>,
    pub failure_reasons: Vec<CollectorFailureReason>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CollectorFailureReason {
    pub message: String,
    pub count: i64,
}

#[derive(Debug, Clone, Serialize)]
struct CollectorEvent<'a> {
    event_id: &'a str,
    captured_at: String,
    content_type: &'a str,
    content: &'a str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    ai_tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_app: Option<String>,
}

fn ai_tags_from_item(item: &ClipboardItem) -> Vec<String> {
    item.tags
        .as_deref()
        .and_then(|raw_tags| serde_json::from_str::<Vec<String>>(raw_tags).ok())
        .unwrap_or_default()
        .into_iter()
        .filter_map(|tag| {
            let tag = tag.trim();
            let ai_tag = tag.strip_prefix("AI:")?.trim();
            (!ai_tag.is_empty()).then(|| ai_tag.to_string())
        })
        .collect()
}

pub fn is_recent(item: &ClipboardItem, now: i64) -> bool {
    item.created_at >= now.saturating_sub(MAX_UPLOAD_AGE_SECS)
}

pub fn is_ready(config: &CollectorConfig) -> bool {
    config.enabled && !config.endpoint.is_empty() && !config.token.is_empty()
}

pub fn local_day_start() -> i64 {
    let now = Local::now();
    now.date_naive()
        .and_hms_opt(0, 0, 0)
        .and_then(|start| start.and_local_timezone(Local).single())
        .unwrap_or(now)
        .timestamp()
}

pub fn event_url(config: &CollectorConfig) -> String {
    format!(
        "{}/v1/clipboard-events",
        config.endpoint.trim_end_matches('/')
    )
}

pub async fn test_connection(config: &CollectorConfig) -> Result<(), String> {
    let endpoint = format!("{}/healthz", config.endpoint.trim_end_matches('/'));
    let response = http_client::client()
        .get(endpoint)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|e| format!("连接失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("服务器返回 HTTP {}", response.status()));
    }
    Ok(())
}

pub async fn upload_item(config: &CollectorConfig, item: Arc<ClipboardItem>) -> Result<(), String> {
    if !is_ready(config) || !is_recent(&item, Utc::now().timestamp()) {
        return Ok(());
    }
    if item.type_ != "text" && item.type_ != "link" {
        return Ok(());
    }
    let Some(content) = item.content.as_deref() else {
        return Ok(());
    };

    let source_app = item
        .get_metadata()
        .map(|metadata| metadata.source_app)
        .filter(|value| !value.trim().is_empty());
    let event = CollectorEvent {
        event_id: &item.id,
        captured_at: chrono::DateTime::from_timestamp(item.created_at, 0)
            .unwrap_or_else(Utc::now)
            .to_rfc3339(),
        content_type: &item.type_,
        content,
        ai_tags: ai_tags_from_item(&item),
        source_app,
    };

    let response = http_client::client()
        .post(event_url(config))
        .bearer_auth(&config.token)
        .json(&event)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| format!("上传失败: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("服务器返回 HTTP {}", response.status()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_requires_enabled_config_with_endpoint_and_token() {
        let mut config = CollectorConfig::default();
        assert!(!is_ready(&config));

        config.enabled = true;
        config.endpoint = "https://collector.example.com".to_string();
        assert!(!is_ready(&config));

        config.token = "token".to_string();
        assert!(is_ready(&config));
    }

    #[test]
    fn extracts_only_ai_tags_from_item() {
        let mut item = ClipboardItem::new_text(
            "collector test".to_string(),
            crate::core::models::WindowMetadata {
                source_app: "test".to_string(),
                window_title: "collector test".to_string(),
                source_url: None,
                is_self: false,
            },
        );
        item.tags = Some(r#"["project", "AI: Rust", "AI:analysis", "AI:  "]"#.to_string());

        assert_eq!(ai_tags_from_item(&item), vec!["Rust", "analysis"]);
    }

    #[test]
    fn serializes_ai_tags_only_when_present() {
        let base_event = |ai_tags: Vec<String>| CollectorEvent {
            event_id: "event-1",
            captured_at: "2026-08-22T10:20:30Z".to_string(),
            content_type: "text",
            content: "collector test",
            ai_tags,
            source_app: None,
        };

        let with_tags = serde_json::to_value(base_event(vec!["Rust".to_string()])).unwrap();
        assert_eq!(with_tags["ai_tags"], serde_json::json!(["Rust"]));

        let without_tags = serde_json::to_value(base_event(Vec::new())).unwrap();
        assert!(without_tags.get("ai_tags").is_none());
    }
}
