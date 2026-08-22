pub mod ai;
pub mod commands;
pub mod config;
pub mod core;
pub mod crash_log;
pub mod http_client;
pub mod lan_sync;
pub mod license;
pub mod low_memory_mode;
pub mod mcp;
pub mod ocr;
pub mod platform;
pub mod repository;
pub mod share;
pub mod shortcuts;
pub mod startup_metrics;
pub mod tray;
pub mod window_lifecycle;

#[cfg(test)]
mod tests;
