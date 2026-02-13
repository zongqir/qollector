use std::sync::Arc;
use tokio::sync::Mutex;
use serde_json::{json, Value};
use std::net::SocketAddr;
use warp::Filter;

use crate::core::clipboard_manager::ClipboardManager;
use super::config::{McpConfig, McpMode};
use super::protocol::{McpRequest, McpResponse};
use super::tools::ClipboardTools;

/// MCP 服务器
pub struct McpServer {
    config: Arc<Mutex<McpConfig>>,
    clipboard_manager: Arc<ClipboardManager>,
    tools: ClipboardTools,
}

impl McpServer {
    pub fn new(
        config: Arc<Mutex<McpConfig>>,
        clipboard_manager: Arc<ClipboardManager>,
    ) -> Self {
        let tools = ClipboardTools::new(clipboard_manager.clone());
        Self {
            config,
            clipboard_manager,
            tools,
        }
    }

    /// 启动 MCP 服务器
    pub async fn start(&self) -> Result<(), String> {
        let config = self.config.lock().await;
        if !config.enabled {
            return Ok(());
        }

        let mode = config.mode.clone();
        let mut port = config.port.unwrap_or(38470);
        drop(config);

        match mode {
            McpMode::Http => {
                // 尝试启动，如果端口被占用则自动切换
                let mut attempts = 0;
                let max_attempts = 10;

                loop {
                    println!("[MCP] 尝试启动 HTTP 服务器 (端口: {})", port);

                    match self.try_start_http(port).await {
                        Ok(_) => break,
                        Err(e) if attempts < max_attempts => {
                            println!("[MCP] 端口 {} 被占用，尝试下一个端口...", port);
                            port += 1;
                            attempts += 1;

                            // 更新配置中的端口
                            let mut config = self.config.lock().await;
                            config.port = Some(port);
                            drop(config);
                        }
                        Err(e) => {
                            return Err(format!("无法启动 MCP 服务器: {}", e));
                        }
                    }
                }

                println!("[MCP] HTTP 服务器成功启动在端口: {}", port);
                Ok(())
            }
            McpMode::Stdio => {
                Err("GUI 应用不支持 stdio 模式，请使用 HTTP 模式".to_string())
            }
        }
    }

    /// 尝试启动 HTTP 服务器
    async fn try_start_http(&self, port: u16) -> Result<(), String> {
        let tools = self.tools.clone();

        // POST /mcp - 处理 MCP 请求
        let mcp_route = warp::path("mcp")
            .and(warp::post())
            .and(warp::body::json())
            .and_then(move |request: McpRequest| {
                let tools = tools.clone();
                async move {
                    match Self::handle_request_static(request, tools).await {
                        Ok(response) => Ok::<_, warp::Rejection>(warp::reply::json(&response)),
                        Err(e) => {
                            let error_response = McpResponse::error(None, -32603, e);
                            Ok(warp::reply::json(&error_response))
                        }
                    }
                }
            });

        // GET /health - 健康检查
        let health_route = warp::path("health")
            .and(warp::get())
            .map(|| warp::reply::json(&json!({ "status": "ok" })));

        let routes = mcp_route.or(health_route);

        let addr: SocketAddr = ([127, 0, 0, 1], port).into();

        // 尝试绑定端口
        match tokio::net::TcpListener::bind(addr).await {
            Ok(_) => {
                // 端口可用，启动服务器
                println!("[MCP] HTTP 服务器监听: http://{}", addr);
                tokio::spawn(async move {
                    warp::serve(routes).run(addr).await;
                });
                Ok(())
            }
            Err(e) => Err(format!("端口绑定失败: {}", e)),
        }
    }

    /// 处理 MCP 请求（静态方法）
    async fn handle_request_static(
        request: McpRequest,
        tools: ClipboardTools,
    ) -> Result<McpResponse, String> {
        match request.method.as_str() {
            "initialize" => Self::handle_initialize_static(request.id).await,
            "tools/list" => Self::handle_tools_list_static(request.id, tools).await,
            "tools/call" => Self::handle_tools_call_static(request.id, request.params, tools).await,
            _ => Ok(McpResponse::error(
                request.id,
                -32601,
                format!("方法未找到: {}", request.method),
            )),
        }
    }

    /// 处理初始化请求
    async fn handle_initialize_static(id: Option<Value>) -> Result<McpResponse, String> {
        let result = json!({
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "tools": {}
            },
            "serverInfo": {
                "name": "clipbox-mcp",
                "version": "0.1.0"
            }
        });
        Ok(McpResponse::success(id, result))
    }

    /// 处理工具列表请求
    async fn handle_tools_list_static(
        id: Option<Value>,
        tools: ClipboardTools,
    ) -> Result<McpResponse, String> {
        let tool_list = tools.list_tools();
        let result = json!({ "tools": tool_list });
        Ok(McpResponse::success(id, result))
    }

    /// 处理工具调用请求
    async fn handle_tools_call_static(
        id: Option<Value>,
        params: Option<Value>,
        tools: ClipboardTools,
    ) -> Result<McpResponse, String> {
        let params = params.ok_or("缺少参数")?;
        let tool_name = params["name"]
            .as_str()
            .ok_or("缺少工具名称")?;
        let arguments = params["arguments"].clone();

        match tools.call_tool(tool_name, arguments).await {
            Ok(result) => Ok(McpResponse::success(id, result)),
            Err(e) => Ok(McpResponse::error(id, -32000, e.to_string())),
        }
    }
}
