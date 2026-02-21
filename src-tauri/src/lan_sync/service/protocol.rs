use crate::core::models::{SyncApplyResult, SyncIncomingSlot, SyncLatestSlot};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct DiscoveryPacket {
    pub kind: String,
    pub device_id: String,
    pub device_name: String,
    pub service_port: u16,
    pub ts_ms: i64,
}

#[derive(Debug, Clone)]
pub(super) struct ActivePairCode {
    pub code: String,
    pub expires_at_ms: i64,
    pub failed_attempts: u32,
    pub locked_until_ms: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(super) struct PairRequestBody {
    pub requester_device_id: String,
    pub requester_device_name: String,
    pub requester_service_port: u16,
    pub code: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct PairResponseBody {
    pub accepted: bool,
    pub reason: String,
    pub device_id: String,
    pub device_name: String,
    pub pair_token: Option<String>,
    pub latest_slot: Option<SyncLatestSlot>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub(super) struct PushRequestBody {
    pub from_device_id: String,
    pub from_service_port: u16,
    pub pair_token: String,
    pub slot: SyncIncomingSlot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct PushResponseBody {
    pub result: SyncApplyResult,
}

#[derive(Debug, Clone, Deserialize)]
pub(super) struct LatestQuery {
    pub device_id: String,
    pub pair_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct LatestResponseBody {
    pub slot: Option<SyncLatestSlot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(super) struct HealthResponseBody {
    pub device_id: String,
    pub device_name: String,
    pub service_port: u16,
    pub server_time_ms: i64,
}
