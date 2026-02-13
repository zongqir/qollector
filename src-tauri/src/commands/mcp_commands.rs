use tauri::State;
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::mcp::{McpConfig, McpServer};
use crate::core::clipboard_manager::ClipboardManager;

/// MCP 状态
pub struct McpState {
    pub config: Arc<Mutex<McpConfig>>,
    pub server: Option<Arc<McpServer>>,
}

/// 获取 MCP 配置
#[tauri::command]
pub async fn get_mcp_config(state: State<'_, Arc<Mutex<McpConfig>>>) -> Result<McpConfig, String> {
    let config = state.lock().await;
    Ok(config.clone())
}

/// 获取 MCP 实际运行端口
#[tauri::command]
pub async fn get_mcp_port(state: State<'_, Arc<Mutex<McpConfig>>>) -> Result<u16, String> {
    let config = state.lock().await;
    Ok(config.port.unwrap_or(38470))
}

/// 更新 MCP 配置
#[tauri::command]
pub async fn update_mcp_config(
    config: McpConfig,
    state: State<'_, Arc<Mutex<McpConfig>>>,
) -> Result<(), String> {
    let mut current_config = state.lock().await;
    *current_config = config;
    Ok(())
}

/// 测试 MCP 连接
#[tauri::command]
pub async fn test_mcp_connection(
    state: State<'_, Arc<Mutex<McpConfig>>>,
) -> Result<String, String> {
    let config = state.lock().await;
    if config.enabled {
        Ok("MCP 服务已启用".to_string())
    } else {
        Err("MCP 服务未启用".to_string())
    }
}
