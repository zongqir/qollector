pub mod ai;
pub mod commands;
pub mod collector;
pub mod config;
pub mod copy_on_select;
pub mod core;
pub mod crash_log;
pub mod http_client;
pub mod mcp;
pub mod ocr;
pub mod platform;
pub mod quick_action;
pub mod repository;
pub mod share;
pub mod shortcuts;
pub mod startup_metrics;
pub mod tray;
pub mod window_lifecycle;

#[cfg(test)]
mod tests;
