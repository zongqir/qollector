use crate::core::clipboard_manager::ClipboardManager;
use crate::core::models::{SyncApplyResult, SyncIncomingSlot};
use crate::lan_sync::{
    DiscoveredSyncDevice, LanSyncConfig, LocalSyncIdentity, PairCodeSession, PairWithDeviceResult,
    PairedSyncDevice,
};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::net::UdpSocket;
use tokio::sync::{watch, Mutex as TokioMutex};
use tokio::time::{self, Duration};

const DISCOVERY_KIND: &str = "qollect_lan_sync_v1";
mod discovery;
mod http_server;
mod protocol;
use protocol::{
    ActivePairCode, DiscoveryPacket, LatestResponseBody, PairRequestBody, PairResponseBody,
    PushRequestBody, PushResponseBody,
};

pub struct LanSyncService {
    manager: Arc<ClipboardManager>,
    config: Arc<TokioMutex<LanSyncConfig>>,
    identity: Arc<TokioMutex<LocalSyncIdentity>>,
    discovered: Arc<TokioMutex<HashMap<String, DiscoveredSyncDevice>>>,
    pair_code: Arc<TokioMutex<Option<ActivePairCode>>>,
    stop_tx: Arc<TokioMutex<Option<watch::Sender<bool>>>>,
    running: AtomicBool,
}

impl LanSyncService {
    pub fn new(manager: Arc<ClipboardManager>, config: LanSyncConfig) -> Self {
        let sanitized = Self::sanitize_config(config);
        let identity = LocalSyncIdentity {
            device_id: sanitized.device_id.clone(),
            device_name: sanitized.device_name.clone(),
        };
        Self {
            manager,
            config: Arc::new(TokioMutex::new(sanitized)),
            identity: Arc::new(TokioMutex::new(identity)),
            discovered: Arc::new(TokioMutex::new(HashMap::new())),
            pair_code: Arc::new(TokioMutex::new(None)),
            stop_tx: Arc::new(TokioMutex::new(None)),
            running: AtomicBool::new(false),
        }
    }

    pub async fn get_config(&self) -> LanSyncConfig {
        self.config.lock().await.clone()
    }

    pub async fn get_identity(&self) -> LocalSyncIdentity {
        self.identity.lock().await.clone()
    }

    pub async fn is_running(&self) -> bool {
        self.running.load(Ordering::SeqCst)
    }

    pub async fn update_config(self: &Arc<Self>, config: LanSyncConfig) -> Result<(), String> {
        let sanitized = Self::sanitize_config(config);
        {
            let mut cfg = self.config.lock().await;
            *cfg = sanitized.clone();
        }
        {
            let mut identity = self.identity.lock().await;
            identity.device_id = sanitized.device_id.clone();
            identity.device_name = sanitized.device_name.clone();
        }

        self.stop().await;
        if sanitized.enabled {
            tokio::time::sleep(Duration::from_millis(120)).await;
            self.start().await?;
        }
        Ok(())
    }

    pub async fn start(self: &Arc<Self>) -> Result<(), String> {
        if self.running.swap(true, Ordering::SeqCst) {
            return Ok(());
        }

        let config = self.get_config().await;
        let (stop_tx, stop_rx) = watch::channel(false);
        {
            let mut slot = self.stop_tx.lock().await;
            *slot = Some(stop_tx.clone());
        }

        if let Err(error) =
            discovery::spawn_discovery_listener(self, config.clone(), stop_rx.clone()).await
        {
            self.running.store(false, Ordering::SeqCst);
            let mut slot = self.stop_tx.lock().await;
            *slot = None;
            return Err(error);
        }

        if let Err(error) =
            discovery::spawn_discovery_broadcast(self, config.clone(), stop_rx.clone()).await
        {
            let _ = stop_tx.send(true);
            self.running.store(false, Ordering::SeqCst);
            let mut slot = self.stop_tx.lock().await;
            *slot = None;
            return Err(error);
        }

        http_server::spawn_http_server(self, config.service_port, stop_rx).await;
        Ok(())
    }

    pub async fn stop(&self) {
        if !self.running.swap(false, Ordering::SeqCst) {
            return;
        }

        let tx = {
            let mut slot = self.stop_tx.lock().await;
            slot.take()
        };
        if let Some(stop_tx) = tx {
            let _ = stop_tx.send(true);
        }
    }

    pub async fn list_discovered_devices(&self) -> Vec<DiscoveredSyncDevice> {
        let config = self.get_config().await;
        let now_ms = Self::now_unix_ms();
        let ttl_ms = config.discovery_ttl_ms as i64;

        let mut map = self.discovered.lock().await;
        map.retain(|_, device| now_ms.saturating_sub(device.last_seen_ms) <= ttl_ms);
        let mut values = map.values().cloned().collect::<Vec<_>>();
        values.sort_by(|a, b| b.last_seen_ms.cmp(&a.last_seen_ms));
        values
    }

    pub async fn start_pair_code(&self) -> PairCodeSession {
        let config = self.get_config().await;
        let now_ms = Self::now_unix_ms();
        let session = ActivePairCode {
            code: Self::generate_pair_code(),
            expires_at_ms: now_ms.saturating_add((config.pair_code_ttl_secs * 1000) as i64),
            failed_attempts: 0,
            locked_until_ms: 0,
        };
        let remaining_attempts = config.pair_max_failures;

        {
            let mut state = self.pair_code.lock().await;
            *state = Some(session.clone());
        }

        PairCodeSession {
            code: session.code,
            expires_at_ms: session.expires_at_ms,
            locked_until_ms: session.locked_until_ms,
            remaining_attempts,
        }
    }

    pub async fn cancel_pair_code(&self) {
        let mut state = self.pair_code.lock().await;
        *state = None;
    }

    pub async fn get_pair_code_session(&self) -> Option<PairCodeSession> {
        let config = self.get_config().await;
        let now_ms = Self::now_unix_ms();
        let mut state = self.pair_code.lock().await;
        let active = state.clone()?;
        if now_ms > active.expires_at_ms {
            *state = None;
            return None;
        }

        let remaining_attempts = config
            .pair_max_failures
            .saturating_sub(active.failed_attempts.min(config.pair_max_failures));

        Some(PairCodeSession {
            code: active.code,
            expires_at_ms: active.expires_at_ms,
            locked_until_ms: active.locked_until_ms,
            remaining_attempts,
        })
    }

    pub async fn list_paired_devices(&self) -> Result<Vec<PairedSyncDevice>, String> {
        self.manager.list_paired_sync_devices().await
    }

    pub async fn unpair_device(&self, device_id: &str) -> Result<(), String> {
        self.manager.remove_paired_sync_device(device_id).await
    }

    pub async fn pair_with_device(
        &self,
        target_host: &str,
        target_port: u16,
        code: &str,
    ) -> Result<PairWithDeviceResult, String> {
        let host = target_host.trim();
        if host.is_empty() {
            return Err("target_host is required".to_string());
        }
        if code.trim().is_empty() {
            return Err("pair code is required".to_string());
        }

        let config = self.get_config().await;
        let identity = self.get_identity().await;

        let body = PairRequestBody {
            requester_device_id: identity.device_id.clone(),
            requester_device_name: identity.device_name.clone(),
            requester_service_port: config.service_port,
            code: code.trim().to_string(),
        };

        let client = crate::http_client::client();
        let url = format!("http://{}:{}/lan-sync/pair/request", host, target_port);
        let response = client
            .post(url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Pair request failed: {}", e))?;
        let status = response.status();
        let payload: PairResponseBody = response
            .json()
            .await
            .map_err(|e| format!("Invalid pair response: {}", e))?;

        if !status.is_success() || !payload.accepted {
            let reason = if payload.reason.trim().is_empty() {
                "pair_rejected".to_string()
            } else {
                payload.reason
            };
            return Err(reason);
        }

        let token = payload
            .pair_token
            .clone()
            .ok_or_else(|| "missing_pair_token".to_string())?;

        let paired_device = self
            .manager
            .upsert_paired_sync_device(
                &payload.device_id,
                &payload.device_name,
                &token,
                Some(host),
                Some(target_port),
            )
            .await?;

        if let Some(slot) = payload.latest_slot.as_ref() {
            let _ = self
                .manager
                .apply_remote_sync_slot(SyncIncomingSlot {
                    payload_json: slot.payload_json.clone(),
                    payload_type: slot.payload_type.clone(),
                    source_device_id: slot.source_device_id.clone(),
                    source_seq: slot.source_seq,
                    logical_ts_ms: slot.logical_ts_ms,
                    content_hash: slot.content_hash.clone(),
                })
                .await;
        }

        Ok(PairWithDeviceResult {
            paired_device,
            remote_slot: payload.latest_slot,
        })
    }

    pub async fn push_latest_slot_to_device(
        &self,
        device_id: &str,
    ) -> Result<SyncApplyResult, String> {
        let identity = self.get_identity().await;
        let config = self.get_config().await;
        let paired = self
            .manager
            .get_paired_sync_device(device_id)
            .await?
            .ok_or_else(|| format!("paired device not found: {}", device_id))?;

        let (host, port) = self.resolve_target_for_device(&paired).await?;
        let local_slot = self
            .manager
            .get_sync_latest_slot()
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "local_sync_slot_is_empty".to_string())?;

        let body = PushRequestBody {
            from_device_id: identity.device_id,
            from_service_port: config.service_port,
            pair_token: paired.pair_token.clone(),
            slot: SyncIncomingSlot {
                payload_json: local_slot.payload_json,
                payload_type: local_slot.payload_type,
                source_device_id: local_slot.source_device_id,
                source_seq: local_slot.source_seq,
                logical_ts_ms: local_slot.logical_ts_ms,
                content_hash: local_slot.content_hash,
            },
        };

        let client = crate::http_client::client();
        let url = format!("http://{}:{}/lan-sync/sync/push", host, port);
        let response = client
            .post(url)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Sync push failed: {}", e))?;
        let status = response.status();
        let payload: PushResponseBody = response
            .json()
            .await
            .map_err(|e| format!("Invalid sync push response: {}", e))?;

        if !status.is_success() {
            return Err(format!("sync_push_http_{}", status.as_u16()));
        }

        self.manager
            .touch_paired_sync_device(device_id, Some(&host), Some(port))
            .await?;
        Ok(payload.result)
    }

    pub async fn pull_latest_slot_from_device(
        &self,
        device_id: &str,
    ) -> Result<SyncApplyResult, String> {
        let identity = self.get_identity().await;
        let config = self.get_config().await;
        let paired = self
            .manager
            .get_paired_sync_device(device_id)
            .await?
            .ok_or_else(|| format!("paired device not found: {}", device_id))?;

        let (host, port) = self.resolve_target_for_device(&paired).await?;
        let mut url = reqwest::Url::parse(&format!("http://{}:{}/lan-sync/latest", host, port))
            .map_err(|e| format!("Invalid target URL: {}", e))?;
        url.query_pairs_mut()
            .append_pair("device_id", &identity.device_id)
            .append_pair("pair_token", &paired.pair_token);

        let client = crate::http_client::client();
        let response = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("Sync pull failed: {}", e))?;
        let status = response.status();
        let payload: LatestResponseBody = response
            .json()
            .await
            .map_err(|e| format!("Invalid sync pull response: {}", e))?;

        if !status.is_success() {
            return Err(format!("sync_pull_http_{}", status.as_u16()));
        }

        self.manager
            .touch_paired_sync_device(device_id, Some(&host), Some(port))
            .await?;

        if let Some(slot) = payload.slot {
            return self
                .manager
                .apply_remote_sync_slot(SyncIncomingSlot {
                    payload_json: slot.payload_json,
                    payload_type: slot.payload_type,
                    source_device_id: slot.source_device_id,
                    source_seq: slot.source_seq,
                    logical_ts_ms: slot.logical_ts_ms,
                    content_hash: slot.content_hash,
                })
                .await;
        }

        Ok(SyncApplyResult {
            applied: false,
            reason: "remote_slot_empty".to_string(),
            slot: self
                .manager
                .get_sync_latest_slot()
                .await
                .map_err(|e| e.to_string())?,
        })
    }

    async fn resolve_target_for_device(
        &self,
        paired: &PairedSyncDevice,
    ) -> Result<(String, u16), String> {
        let now_ms = Self::now_unix_ms();
        let ttl_ms = self.get_config().await.discovery_ttl_ms as i64;

        if let Some(discovered) = self.discovered.lock().await.get(&paired.device_id).cloned() {
            if now_ms.saturating_sub(discovered.last_seen_ms) <= ttl_ms {
                return Ok((discovered.host, discovered.service_port));
            }
        }

        let host = paired
            .last_host
            .clone()
            .ok_or_else(|| format!("No host available for paired device: {}", paired.device_id))?;
        let port = paired
            .last_port
            .and_then(|value| u16::try_from(value).ok())
            .ok_or_else(|| format!("No port available for paired device: {}", paired.device_id))?;
        Ok((host, port))
    }

    fn sanitize_config(mut config: LanSyncConfig) -> LanSyncConfig {
        // LAN sync is beta-gated for now; force disabled at runtime.
        config.enabled = false;
        if config.device_id.trim().is_empty() {
            config.device_id = uuid::Uuid::new_v4().to_string();
        }
        if config.device_name.trim().is_empty() {
            config.device_name = "Qollect Device".to_string();
        }
        config.service_port = config.service_port.clamp(1024, u16::MAX);
        config.discovery_port = config.discovery_port.clamp(1024, u16::MAX);
        if config.discovery_port == config.service_port {
            config.discovery_port = if config.service_port < u16::MAX {
                config.service_port + 1
            } else {
                config.service_port.saturating_sub(1).max(1024)
            };
        }
        if config.discovery_interval_ms < 800 {
            config.discovery_interval_ms = 800;
        }
        if config.discovery_ttl_ms < config.discovery_interval_ms.saturating_mul(2) {
            config.discovery_ttl_ms = config.discovery_interval_ms.saturating_mul(2);
        }
        if config.pair_code_ttl_secs < 20 {
            config.pair_code_ttl_secs = 20;
        }
        if config.pair_max_failures == 0 {
            config.pair_max_failures = 1;
        }
        if config.pair_lockout_secs < 30 {
            config.pair_lockout_secs = 30;
        }
        if config.request_timeout_ms < 1000 {
            config.request_timeout_ms = 1000;
        }
        config
    }

    fn now_unix_ms() -> i64 {
        chrono::Utc::now().timestamp_millis()
    }

    fn generate_pair_code() -> String {
        let value = (uuid::Uuid::new_v4().as_u128() % 1_000_000_u128) as u32;
        format!("{:06}", value)
    }
}
