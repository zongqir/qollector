// MCP (Model Context Protocol) 模块
// 提供 AI 访问剪贴板的能力

pub mod config;
pub mod protocol;
pub mod server;
pub mod tools;

pub use config::McpConfig;
pub use server::McpServer;
