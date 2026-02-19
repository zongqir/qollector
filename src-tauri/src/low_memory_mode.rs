use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub struct LowMemoryModeState {
    enabled: AtomicBool,
}

impl LowMemoryModeState {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled: AtomicBool::new(enabled),
        }
    }

    pub fn set_enabled(&self, enabled: bool) {
        self.enabled.store(enabled, Ordering::SeqCst);
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::SeqCst)
    }
}

#[derive(Default)]
pub struct AppExitState {
    user_requested_exit: AtomicBool,
}

impl AppExitState {
    pub fn mark_user_requested_exit(&self) {
        self.user_requested_exit.store(true, Ordering::SeqCst);
    }

    pub fn is_user_requested_exit(&self) -> bool {
        self.user_requested_exit.load(Ordering::SeqCst)
    }
}
