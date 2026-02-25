use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct LanSyncConfig {
    pub enabled: bool,
    pub device_id: String,
    pub device_name: String,
    pub service_port: u16,
    pub discovery_port: u16,
    pub discovery_interval_ms: u64,
    pub discovery_ttl_ms: u64,
    pub pair_code_ttl_secs: u64,
    pub pair_max_failures: u32,
    pub pair_lockout_secs: u64,
    pub request_timeout_ms: u64,
}

impl Default for LanSyncConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            device_id: uuid::Uuid::new_v4().to_string(),
            device_name: default_device_name(),
            service_port: 39211,
            discovery_port: 39212,
            discovery_interval_ms: 3000,
            discovery_ttl_ms: 12000,
            pair_code_ttl_secs: 60,
            pair_max_failures: 5,
            pair_lockout_secs: 300,
            request_timeout_ms: 4000,
        }
    }
}

fn default_device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Qollect Device".to_string())
}
