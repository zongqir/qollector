use hmac::{Hmac, Mac};
use sha2::Sha256;
use serde::{Deserialize, Serialize};

type HmacSha256 = Hmac<Sha256>;

/// Shared secret for HMAC signing (must match Worker env var).
const HMAC_SECRET: &str = "qollect-license-hmac-secret-v1";

/// License server base URL.
const LICENSE_SERVER_URL: &str = "https://license.qollect.com";

#[derive(Debug, Serialize)]
struct LicenseRequest {
    license_key: String,
    device_id: String,
    device_name: String,
    platform: String,
    timestamp: i64,
    signature: String,
}

#[derive(Debug, Deserialize)]
pub struct ActivateResponse {
    pub success: bool,
    pub message: String,
    pub max_devices: Option<i32>,
    pub activated_devices: Option<i32>,
    pub expires_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct VerifyResponse {
    pub valid: bool,
    pub message: String,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct DeactivateResponse {
    pub success: bool,
    pub message: String,
}

fn compute_signature(license_key: &str, device_id: &str, timestamp: i64) -> String {
    let payload = format!("{}{}{}", license_key, device_id, timestamp);
    let mut mac = HmacSha256::new_from_slice(HMAC_SECRET.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(payload.as_bytes());
    let result = mac.finalize();
    hex::encode(result.into_bytes())
}

fn build_request(
    license_key: &str,
    device_id: &str,
) -> LicenseRequest {
    let timestamp = chrono::Utc::now().timestamp();
    let signature = compute_signature(license_key, device_id, timestamp);
    LicenseRequest {
        license_key: license_key.to_string(),
        device_id: device_id.to_string(),
        device_name: super::device::get_device_name(),
        platform: super::device::get_platform().to_string(),
        timestamp,
        signature,
    }
}

pub async fn activate(
    license_key: &str,
    device_id: &str,
) -> Result<ActivateResponse, String> {
    let req = build_request(license_key, device_id);
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/v1/activate", LICENSE_SERVER_URL))
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if resp.status().is_success() {
        resp.json::<ActivateResponse>()
            .await
            .map_err(|e| format!("Parse error: {}", e))
    } else {
        let body = resp.text().await.unwrap_or_default();
        // Try to parse error response
        if let Ok(r) = serde_json::from_str::<ActivateResponse>(&body) {
            Ok(r)
        } else {
            Err(format!("Server error: {}", body))
        }
    }
}

pub async fn verify(
    license_key: &str,
    device_id: &str,
) -> Result<VerifyResponse, String> {
    let req = build_request(license_key, device_id);
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/v1/verify", LICENSE_SERVER_URL))
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if resp.status().is_success() {
        resp.json::<VerifyResponse>()
            .await
            .map_err(|e| format!("Parse error: {}", e))
    } else {
        let body = resp.text().await.unwrap_or_default();
        if let Ok(r) = serde_json::from_str::<VerifyResponse>(&body) {
            Ok(r)
        } else {
            Err(format!("Server error: {}", body))
        }
    }
}

pub async fn deactivate(
    license_key: &str,
    device_id: &str,
) -> Result<DeactivateResponse, String> {
    let req = build_request(license_key, device_id);
    let client = reqwest::Client::new();
    let resp = client
        .post(format!("{}/api/v1/deactivate", LICENSE_SERVER_URL))
        .json(&req)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if resp.status().is_success() {
        resp.json::<DeactivateResponse>()
            .await
            .map_err(|e| format!("Parse error: {}", e))
    } else {
        let body = resp.text().await.unwrap_or_default();
        if let Ok(r) = serde_json::from_str::<DeactivateResponse>(&body) {
            Ok(r)
        } else {
            Err(format!("Server error: {}", body))
        }
    }
}
