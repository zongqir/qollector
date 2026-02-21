use crate::core::models::SyncLatestSlot;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalSyncIdentity {
    pub device_id: String,
    pub device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredSyncDevice {
    pub device_id: String,
    pub device_name: String,
    pub host: String,
    pub service_port: u16,
    pub last_seen_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairCodeSession {
    pub code: String,
    pub expires_at_ms: i64,
    pub locked_until_ms: i64,
    pub remaining_attempts: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct PairedSyncDevice {
    pub device_id: String,
    pub device_name: String,
    pub pair_token: String,
    pub last_host: Option<String>,
    pub last_port: Option<i64>,
    pub created_at_ms: i64,
    pub last_seen_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PairWithDeviceResult {
    pub paired_device: PairedSyncDevice,
    pub remote_slot: Option<SyncLatestSlot>,
}
