use std::sync::Arc;
use tauri::State;
use tokio::sync::Mutex;

use crate::commands::license_commands::LicenseState;
use crate::license::config::LicenseStatus;
use crate::mcp::{McpConfig, McpServer};
use crate::repository::config_repo::ConfigRepository;

/// MCP 状态
pub struct McpState {
    pub config: Arc<Mutex<McpConfig>>,
    pub config_repo: Arc<ConfigRepository>,
    pub server: Option<Arc<McpServer>>,
}

/// 获取 MCP 配置
#[tauri::command]
pub async fn get_mcp_config(state: State<'_, McpState>) -> Result<McpConfig, String> {
    let config = state.config.lock().await;
    Ok(config.clone())
}

/// 获取 MCP 实际运行端口
#[tauri::command]
pub async fn get_mcp_port(state: State<'_, McpState>) -> Result<u16, String> {
    let config = state.config.lock().await;
    Ok(config.port.unwrap_or(38470))
}

/// 更新 MCP 配置
#[tauri::command]
pub async fn update_mcp_config(
    config: McpConfig,
    state: State<'_, McpState>,
    license_state: State<'_, LicenseState>,
) -> Result<(), String> {
    // License gate: only allow enabling MCP with active license
    if config.enabled {
        let license = license_state.config.lock();
        if license.status != LicenseStatus::Active {
            return Err("PRO_REQUIRED".to_string());
        }
    }

    let mut current_config = state.config.lock().await;
    *current_config = config.clone();
    drop(current_config);

    // 持久化到数据库
    state
        .config_repo
        .save_mcp_config(&config)
        .await
        .map_err(|e| format!("保存配置失败: {}", e))?;

    Ok(())
}

/// 测试 MCP 连接
#[tauri::command]
pub async fn test_mcp_connection(state: State<'_, McpState>) -> Result<String, String> {
    let config = state.config.lock().await;
    if config.enabled {
        Ok("MCP 服务已启用".to_string())
    } else {
        Err("MCP 服务未启用".to_string())
    }
}

/// 关闭 MCP 服务器
#[tauri::command]
pub async fn shutdown_mcp_server(state: State<'_, McpState>) -> Result<(), String> {
    if let Some(server) = &state.server {
        server.shutdown().await;
        Ok(())
    } else {
        Err("MCP 服务器未运行".to_string())
    }
}

/// 获取 MCP 服务器当前端口
#[tauri::command]
pub async fn get_mcp_current_port(state: State<'_, McpState>) -> Result<Option<u16>, String> {
    if let Some(server) = &state.server {
        Ok(server.get_current_port().await)
    } else {
        Ok(None)
    }
}
