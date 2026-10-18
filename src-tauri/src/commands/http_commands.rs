use crate::http_client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use std::time::{Duration, Instant};

const MAX_RESPONSE_BYTES: usize = 5 * 1024 * 1024; // 5 MB limit
const DEFAULT_TIMEOUT_MS: u64 = 30_000;

#[derive(Debug, Deserialize)]
pub struct HttpRequestOptions {
    pub method: String,
    pub url: String,
    pub headers: Option<Vec<(String, String)>>,
    pub body: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct HttpResponsePayload {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
    pub elapsed_ms: u64,
    pub size_bytes: usize,
    pub is_json: bool,
}

#[tauri::command]
pub async fn send_http_request(
    request: HttpRequestOptions,
) -> Result<HttpResponsePayload, String> {
    let raw_url = request.url.trim();
    if raw_url.is_empty() {
        return Err("URL cannot be empty".to_string());
    }

    if !raw_url.starts_with("http://") && !raw_url.starts_with("https://") {
        return Err("URL must start with http:// or https://".to_string());
    }

    let method = Method::from_str(&request.method.trim().to_uppercase())
        .map_err(|_| format!("Invalid HTTP method: {}", request.method))?;

    let timeout = Duration::from_millis(
        request.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(100, 120_000),
    );

    let client = http_client::client();
    let mut req_builder = client.request(method.clone(), raw_url).timeout(timeout);

    let mut header_map = HeaderMap::new();
    if let Some(headers) = request.headers {
        for (k, v) in headers {
            let trimmed_k = k.trim();
            if trimmed_k.is_empty() {
                continue;
            }
            if let (Ok(name), Ok(val)) = (
                HeaderName::from_str(trimmed_k),
                HeaderValue::from_str(&v),
            ) {
                header_map.insert(name, val);
            }
        }
    }
    req_builder = req_builder.headers(header_map);

    if let Some(body_text) = request.body {
        if !body_text.is_empty() && method != Method::GET && method != Method::HEAD {
            req_builder = req_builder.body(body_text);
        }
    }

    let start_time = Instant::now();
    let response = req_builder
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let elapsed_ms = start_time.elapsed().as_millis() as u64;

    let status = response.status();
    let status_code = status.as_u16();
    let status_text = status.canonical_reason().unwrap_or("").to_string();

    let mut resp_headers = Vec::new();
    for (name, value) in response.headers() {
        if let Ok(v_str) = value.to_str() {
            resp_headers.push((name.as_str().to_string(), v_str.to_string()));
        }
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let size_bytes = bytes.len();
    let body_slice = if size_bytes > MAX_RESPONSE_BYTES {
        &bytes[..MAX_RESPONSE_BYTES]
    } else {
        &bytes[..]
    };

    let body_str = String::from_utf8_lossy(body_slice).to_string();
    let is_json = serde_json::from_str::<serde_json::Value>(&body_str).is_ok();

    Ok(HttpResponsePayload {
        status: status_code,
        status_text,
        headers: resp_headers,
        body: body_str,
        elapsed_ms,
        size_bytes,
        is_json,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_empty_url_rejected() {
        let req = HttpRequestOptions {
            method: "GET".to_string(),
            url: "".to_string(),
            headers: None,
            body: None,
            timeout_ms: None,
        };
        let res = send_http_request(req).await;
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), "URL cannot be empty");
    }

    #[tokio::test]
    async fn test_invalid_scheme_rejected() {
        let req = HttpRequestOptions {
            method: "GET".to_string(),
            url: "ftp://example.com".to_string(),
            headers: None,
            body: None,
            timeout_ms: None,
        };
        let res = send_http_request(req).await;
        assert!(res.is_err());
        assert_eq!(res.unwrap_err(), "URL must start with http:// or https://");
    }

    #[tokio::test]
    async fn test_invalid_method_rejected() {
        let req = HttpRequestOptions {
            method: "INVALID_METHOD".to_string(),
            url: "https://example.com".to_string(),
            headers: None,
            body: None,
            timeout_ms: None,
        };
        let res = send_http_request(req).await;
        assert!(res.is_err());
        assert!(res.unwrap_err().contains("Invalid HTTP method"));
    }
}

