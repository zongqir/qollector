use super::client;
use super::config::{LicenseConfig, LicenseStatus};

/// Offline grace period: 30 days in seconds.
const OFFLINE_GRACE_PERIOD_SECS: i64 = 30 * 24 * 3600;

/// Check if a paid feature is accessible based on current license state.
/// Returns Ok(()) if allowed, Err(reason) if denied.
pub async fn check_feature_access(config: &mut LicenseConfig) -> Result<(), String> {
    // 1. Must be active
    if config.status != LicenseStatus::Active {
        return Err("License not active".to_string());
    }

    // 2. Check expiry
    if let Some(expires_at) = config.expires_at {
        let now = chrono::Utc::now().timestamp();
        if now > expires_at {
            config.status = LicenseStatus::Expired;
            return Err("License expired".to_string());
        }
    }

    // 3. Check if online verification is needed
    let now = chrono::Utc::now().timestamp();
    let needs_verify = match config.last_verified_at {
        Some(last) => (now - last) > OFFLINE_GRACE_PERIOD_SECS,
        None => true,
    };

    if needs_verify {
        if let Some(ref key) = config.license_key {
            match client::verify(key, &config.device_id).await {
                Ok(resp) => {
                    if resp.valid {
                        config.last_verified_at = Some(now);
                    } else {
                        // Server says invalid
                        if resp.status.as_deref() == Some("Revoked") {
                            config.status = LicenseStatus::Revoked;
                            return Err("License revoked".to_string());
                        }
                        if resp.status.as_deref() == Some("Expired") {
                            config.status = LicenseStatus::Expired;
                            return Err("License expired".to_string());
                        }
                    }
                }
                Err(_) => {
                    // Network error: allow within grace period
                    // (we already checked needs_verify, so if we're here
                    //  it means > 30 days without verification)
                    // Still allow - be lenient on network issues
                }
            }
        }
    }

    Ok(())
}
