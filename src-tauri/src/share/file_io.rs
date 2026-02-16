use crate::share::ShareError;
use reqwest::multipart;

/// Upload content to 0x0.st and return the download URL.
/// 0x0.st is a free, no-registration file hosting service.
/// Files under 256MB, retained for 30 days minimum.
pub async fn upload_to_file_hosting(content: &[u8], filename: &str) -> Result<String, ShareError> {
    let part = multipart::Part::bytes(content.to_vec())
        .file_name(filename.to_string())
        .mime_str("application/octet-stream")
        .map_err(|e| ShareError::Upload(e.to_string()))?;

    let form = multipart::Form::new().part("file", part);

    let client = reqwest::Client::builder()
        .user_agent("ClipBox/1.0")
        .build()
        .map_err(|e| ShareError::Upload(e.to_string()))?;
    let resp = client
        .post("https://0x0.st")
        .multipart(form)
        .send()
        .await
        .map_err(|e| ShareError::Upload(e.to_string()))?;

    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| ShareError::Upload(format!("Failed to read response: {}", e)))?;

    let text = text.trim().to_string();

    if !status.is_success() {
        if status.as_u16() == 429 {
            return Err(ShareError::RateLimited(
                "Upload rate limited. Try again later or configure S3.".into(),
            ));
        }
        return Err(ShareError::Upload(format!(
            "Upload failed (status {}): {}",
            status,
            &text[..text.len().min(200)]
        )));
    }

    // 0x0.st returns the URL directly as plain text
    if text.starts_with("http") {
        Ok(text)
    } else {
        Err(ShareError::Upload(format!(
            "Unexpected response: {}",
            &text[..text.len().min(200)]
        )))
    }
}
