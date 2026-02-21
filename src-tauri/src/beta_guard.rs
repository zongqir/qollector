use once_cell::sync::Lazy;
use serde::Serialize;

static BUILD_TIMESTAMP: Lazy<u64> = Lazy::new(|| {
    env!("BUILD_TIMESTAMP").parse::<u64>().unwrap_or(0)
});

const BETA_EXPIRY_DAYS: i64 = 30;

#[derive(Debug, Clone, Serialize)]
pub struct BetaStatus {
    pub expired: bool,
    pub build_date: String,
    pub expiry_date: String,
    pub days_remaining: i64,
}

pub fn check_beta_expiry() -> BetaStatus {
    use chrono::{DateTime, TimeDelta, Utc};

    let build_dt = DateTime::from_timestamp(*BUILD_TIMESTAMP as i64, 0)
        .unwrap_or_else(|| Utc::now());
    let expiry_dt = build_dt + TimeDelta::days(BETA_EXPIRY_DAYS);
    let now = Utc::now();
    let remaining = (expiry_dt - now).num_days();

    let status = BetaStatus {
        expired: now >= expiry_dt,
        build_date: build_dt.format("%Y-%m-%d").to_string(),
        expiry_date: expiry_dt.format("%Y-%m-%d").to_string(),
        days_remaining: remaining.max(0),
    };

    println!(
        "[BetaGuard] Build date: {}, expires: {}, days remaining: {}",
        status.build_date, status.expiry_date, status.days_remaining
    );

    status
}

#[tauri::command]
pub fn get_beta_status() -> BetaStatus {
    check_beta_expiry()
}
