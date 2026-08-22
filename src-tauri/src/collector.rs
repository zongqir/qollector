use crate::config::CollectorConfig;
use crate::core::models::ClipboardItem;
use crate::http_client;
use chrono::Utc;
use serde::Serialize;
use std::sync::Arc;
use std::time::Duration;

const MAX_UPLOAD_AGE_SECS: i64 = 24 * 60 * 60;

#[derive(Debug, Clone, Serialize)]
struct CollectorEvent<'a> {
    event_id: &'a str,
    captured_at: String,
    content_type: &'a str,
    content: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_app: Option<String>,
}

pub fn is_recent(item: &ClipboardItem, now: i64) -> bool {
    item.created_at >= now.saturating_sub(MAX_UPLOAD_AGE_SECS)
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
    if !config.enabled
        || config.endpoint.is_empty()
        || config.token.is_empty()
        || !is_recent(&item, Utc::now().timestamp())
    {
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
