use serde::{Deserialize, Serialize};

/// MCP 配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpConfig {
    /// 是否启用 MCP 服务器
    pub enabled: bool,
    /// 服务器端口 (stdio 模式不需要)
    pub port: Option<u16>,
    /// 通信模式: stdio 或 http
    pub mode: McpMode,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum McpMode {
    Stdio,  // 标准输入输出
    Http,   // HTTP 服务器 (未来扩展)
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: true,  // 默认开启
            port: Some(38470),  // 更偏门的默认端口
            mode: McpMode::Http,  // 默认 HTTP 模式
        }
    }
}
