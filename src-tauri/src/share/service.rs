use base64::Engine;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::share::qr_generator::generate_qr_base64;
use crate::share::s3_uploader::upload_to_s3;
use crate::share::ShareError;

const LOCAL_QR_TEXT_LIMIT: usize = 400;

/// Resolve a .lnk shortcut to its target path on Windows.
/// Returns None if not a .lnk or resolution fails.
#[cfg(target_os = "windows")]
fn resolve_lnk_target(path: &std::path::Path) -> Option<std::path::PathBuf> {
    let ext = path.extension().and_then(|e| e.to_str())?;
    if !ext.eq_ignore_ascii_case("lnk") {
        return None;
    }
    let escaped = path.to_string_lossy().replace('"', "`\"");
    let script = format!(
        "$p=\"{}\"; if (Test-Path $p) {{ $s=(New-Object -ComObject WScript.Shell).CreateShortcut($p); if ($s.TargetPath) {{ Write-Output $s.TargetPath }} }}",
        escaped
    );
    let output = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let target = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if target.is_empty() {
        None
    } else {
        Some(std::path::PathBuf::from(target))
    }
}

#[cfg(not(target_os = "windows"))]
fn resolve_lnk_target(_path: &std::path::Path) -> Option<std::path::PathBuf> {
    None
}

fn should_use_local_qr_for_text(text: &str, force_upload_non_ascii_text: bool) -> bool {
    if text.is_empty() || text.len() > LOCAL_QR_TEXT_LIMIT {
        return false;
    }
    if force_upload_non_ascii_text && !text.is_ascii() {
        return false;
    }
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ShareMethod {
    LocalQr,
    NeedUpload,
    CloudUpload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareResult {
    pub method: ShareMethod,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub qr_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_base64: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResponse {
    pub status_code: u16,
    pub body: String,
}

/// Prepare item data for sharing. For short text, returns LocalQr directly.
/// For longer content, returns base64 data + filename for the frontend to upload.
pub fn prepare_share_data(
    content_type: &str,
    content: Option<&str>,
    image_bytes: Option<Vec<u8>>,
    image_ext: Option<&str>,
    force_upload_non_ascii_text: bool,
) -> Result<ShareResult, ShareError> {
    match content_type {
        "text" | "link" | "code" => {
            let text = content.unwrap_or("");
            if text.is_empty() {
                return Err(ShareError::InvalidConfig("No content to share".into()));
            }
            if should_use_local_qr_for_text(text, force_upload_non_ascii_text) {
                let qr = generate_qr_base64(text)?;
                return Ok(ShareResult {
                    method: ShareMethod::LocalQr,
                    qr_code: Some(qr),
                    url: None,
                    text: Some(text.to_string()),
                    data_base64: None,
                    filename: None,
                });
            }
            let b64 = base64::engine::general_purpose::STANDARD.encode(text.as_bytes());
            Ok(ShareResult {
                method: ShareMethod::NeedUpload,
                qr_code: None,
                url: None,
                text: None,
                data_base64: Some(b64),
                filename: Some("clipboard.txt".into()),
            })
        }
        "image" => {
            let bytes =
                image_bytes.ok_or_else(|| ShareError::InvalidConfig("No image data".into()))?;
            let ext = image_ext.unwrap_or("png");
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            Ok(ShareResult {
                method: ShareMethod::NeedUpload,
                qr_code: None,
                url: None,
                text: None,
                data_base64: Some(b64),
                filename: Some(format!("clipboard.{}", ext)),
            })
        }
        "file" => {
            let paths_str = content.unwrap_or("");
            if paths_str.is_empty() {
                return Err(ShareError::InvalidConfig("No file paths".into()));
            }
            let first_path = paths_str.lines().next().unwrap_or("").trim();
            if first_path.is_empty() {
                return Err(ShareError::InvalidConfig("Empty file path".into()));
            }
            let path = std::path::Path::new(first_path);
            if !path.exists() {
                return Err(ShareError::InvalidConfig(format!(
                    "File not found: {}",
                    first_path
                )));
            }
            // Resolve .lnk shortcuts to their target on Windows
            let resolved = resolve_lnk_target(path);
            let actual_path = resolved.as_deref().unwrap_or(path);
            if !actual_path.exists() {
                return Err(ShareError::InvalidConfig(format!(
                    "Shortcut target not found: {}",
                    actual_path.display()
                )));
            }
            let bytes = std::fs::read(actual_path)?;
            let filename = actual_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string();
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            Ok(ShareResult {
                method: ShareMethod::NeedUpload,
                qr_code: None,
                url: None,
                text: None,
                data_base64: Some(b64),
                filename: Some(filename),
            })
        }
        _ => Err(ShareError::InvalidConfig(format!(
            "Unsupported content type: {}",
            content_type
        ))),
    }
}

/// Generic multipart upload proxy. Posts file data to the given URL and returns
/// the raw response status + body for the frontend to parse.
pub async fn upload_to_free_host(
    url: &str,
    file_field: &str,
    file_data: Vec<u8>,
    filename: &str,
    extra_fields: HashMap<String, String>,
) -> Result<UploadResponse, ShareError> {
    let part = reqwest::multipart::Part::bytes(file_data)
        .file_name(filename.to_string())
        .mime_str("application/octet-stream")
        .map_err(|e| ShareError::Upload(e.to_string()))?;

    let mut form = reqwest::multipart::Form::new();
    for (key, value) in extra_fields {
        form = form.text(key, value);
    }
    form = form.part(file_field.to_string(), part);

    let resp = crate::http_client::client()
        .post(url)
        .multipart(form)
        .send()
        .await
        .map_err(|e| ShareError::Upload(e.to_string()))?;

    let status_code = resp.status().as_u16();
    let body = resp
        .text()
        .await
        .map_err(|e| ShareError::Upload(format!("Failed to read response: {}", e)))?;

    Ok(UploadResponse { status_code, body })
}

/// S3 one-shot: read item, upload, generate QR, return result.
pub async fn share_via_s3(
    content_type: &str,
    content: Option<&str>,
    image_bytes: Option<Vec<u8>>,
    image_ext: Option<&str>,
    s3_config: &crate::share::config::S3Config,
    force_upload_non_ascii_text: bool,
) -> Result<ShareResult, ShareError> {
    // For short text, still do local QR
    if matches!(content_type, "text" | "link" | "code") {
        let text = content.unwrap_or("");
        if should_use_local_qr_for_text(text, force_upload_non_ascii_text) {
            let qr = generate_qr_base64(text)?;
            return Ok(ShareResult {
                method: ShareMethod::LocalQr,
                qr_code: Some(qr),
                url: None,
                text: Some(text.to_string()),
                data_base64: None,
                filename: None,
            });
        }
    }

    let (bytes, filename) = match content_type {
        "text" | "link" | "code" => {
            let text = content.unwrap_or("");
            if text.is_empty() {
                return Err(ShareError::InvalidConfig("No content to share".into()));
            }
            (text.as_bytes().to_vec(), "clipboard.txt".to_string())
        }
        "image" => {
            let bytes =
                image_bytes.ok_or_else(|| ShareError::InvalidConfig("No image data".into()))?;
            let ext = image_ext.unwrap_or("png");
            (bytes, format!("clipboard.{}", ext))
        }
        "file" => {
            let paths_str = content.unwrap_or("");
            let first_path = paths_str.lines().next().unwrap_or("").trim();
            if first_path.is_empty() {
                return Err(ShareError::InvalidConfig("No file paths".into()));
            }
            let path = std::path::Path::new(first_path);
            if !path.exists() {
                return Err(ShareError::InvalidConfig(format!(
                    "File not found: {}",
                    first_path
                )));
            }
            let bytes = tokio::fs::read(path).await?;
            let fname = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("file")
                .to_string();
            (bytes, fname)
        }
        _ => {
            return Err(ShareError::InvalidConfig(format!(
                "Unsupported content type: {}",
                content_type
            )));
        }
    };

    s3_config.validate().map_err(ShareError::InvalidConfig)?;
    let url = upload_to_s3(&bytes, &filename, s3_config).await?;
    let qr = generate_qr_base64(&url)?;
    Ok(ShareResult {
        method: ShareMethod::CloudUpload,
        qr_code: Some(qr),
        url: Some(url),
        text: None,
        data_base64: None,
        filename: None,
    })
}

#[cfg(test)]
mod tests {
    use super::should_use_local_qr_for_text;

    #[test]
    fn local_qr_kept_for_ascii_when_compat_mode_enabled() {
        assert!(should_use_local_qr_for_text("hello world", true));
    }

    #[test]
    fn local_qr_disabled_for_non_ascii_when_compat_mode_enabled() {
        assert!(!should_use_local_qr_for_text("中文文本", true));
    }

    #[test]
    fn local_qr_still_enabled_for_non_ascii_when_compat_mode_disabled() {
        assert!(should_use_local_qr_for_text("中文文本", false));
    }
}
