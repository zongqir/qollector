use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum LicenseStatus {
    Free,
    Active,
    Expired,
    Revoked,
}

impl Default for LicenseStatus {
    fn default() -> Self {
        Self::Free
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LicenseConfig {
    pub license_key: Option<String>,
    pub device_id: String,
    pub status: LicenseStatus,
    pub activated_at: Option<i64>,
    pub expires_at: Option<i64>,
    pub last_verified_at: Option<i64>,
    pub max_devices: i32,
    pub activated_devices: i32,
}

impl Default for LicenseConfig {
    fn default() -> Self {
        let device_id = super::device::get_device_id().unwrap_or_default();
        Self {
            license_key: None,
            device_id,
            status: LicenseStatus::Free,
            activated_at: None,
            expires_at: None,
            last_verified_at: None,
            max_devices: 3,
            activated_devices: 0,
        }
    }
}

impl LicenseConfig {
    pub fn is_active(&self) -> bool {
        self.status == LicenseStatus::Active
    }
}
