use serde::Serialize;
use parking_lot::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupMetricsSnapshot {
    pub process_started_at_unix_ms: u64,
    pub setup_complete_since_start_ms: Option<u64>,
    pub core_init_since_start_ms: Option<u64>,
    pub monitor_spawn_since_start_ms: Option<u64>,
}

pub struct StartupMetricsState {
    process_started_at_unix_ms: u64,
    process_started_at: Instant,
    setup_complete_since_start_ms: Mutex<Option<u64>>,
    core_init_since_start_ms: Mutex<Option<u64>>,
    monitor_spawn_since_start_ms: Mutex<Option<u64>>,
}

impl StartupMetricsState {
    pub fn new() -> Self {
        let process_started_at_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        Self {
            process_started_at_unix_ms,
            process_started_at: Instant::now(),
            setup_complete_since_start_ms: Mutex::new(None),
            core_init_since_start_ms: Mutex::new(None),
            monitor_spawn_since_start_ms: Mutex::new(None),
        }
    }

    fn elapsed_since_start_ms(&self) -> u64 {
        self.process_started_at.elapsed().as_millis() as u64
    }

    pub fn mark_core_init_complete(&self) {
        *self.core_init_since_start_ms.lock() = Some(self.elapsed_since_start_ms());
    }

    pub fn mark_monitor_spawn_complete(&self) {
        *self.monitor_spawn_since_start_ms.lock() = Some(self.elapsed_since_start_ms());
    }

    pub fn mark_setup_complete(&self) {
        *self.setup_complete_since_start_ms.lock() = Some(self.elapsed_since_start_ms());
    }

    pub fn snapshot(&self) -> StartupMetricsSnapshot {
        StartupMetricsSnapshot {
            process_started_at_unix_ms: self.process_started_at_unix_ms,
            setup_complete_since_start_ms: *self.setup_complete_since_start_ms.lock(),
            core_init_since_start_ms: *self.core_init_since_start_ms.lock(),
            monitor_spawn_since_start_ms: *self.monitor_spawn_since_start_ms.lock(),
        }
    }
}
