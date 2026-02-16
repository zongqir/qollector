use crate::share::ShareError;
use reqwest::multipart;

/// Upload content to file.io and return the download URL.
pub async fn upload_to_file_io(content: &[u8], filename: &str) -> Result<String, ShareError> {
    let part = multipart::Part::bytes(content.to_vec())
        .file_name(filename.to_string())
        .mime_str("application/octet-stream")
        .map_err(|e| ShareError::Upload(e.to_string()))?;

    let form = multipart::Form::new()
        .part("file", part)
        .text("expires", "1d");

    let client = reqwest::Client::new();
    let resp = client
        .post("https://file.io")
        .multipart(form)
        .send()
        .await
        .map_err(|e| ShareError::Upload(e.to_string()))?;

    let status = resp.status();
    if status.as_u16() == 429 {
        return Err(ShareError::RateLimited(
            "File.io rate limit exceeded. Try again later or configure S3.".into(),
        ));
    }

    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| ShareError::Upload(format!("Failed to parse response: {}", e)))?;

    if let Some(link) = body.get("link").and_then(|v| v.as_str()) {
        Ok(link.to_string())
    } else {
        let msg = body
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("Unknown error");
        Err(ShareError::Upload(format!(
            "file.io returned status {}: {}",
            status, msg
        )))
    }
}
