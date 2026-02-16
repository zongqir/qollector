use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::{oneshot, Mutex};
use warp::Filter;

use super::config::{McpConfig, McpMode};
use super::lock_file::LockFile;
use super::port_manager::PortManager;
use super::protocol::{McpRequest, McpResponse};
use super::tools::ClipboardTools;
use crate::core::clipboard_manager::ClipboardManager;
use std::path::PathBuf;

/// MCP 服务器
pub struct McpServer {
    config: Arc<Mutex<McpConfig>>,
    clipboard_manager: Arc<ClipboardManager>,
    tools: ClipboardTools,
    shutdown_tx: Arc<Mutex<Option<oneshot::Sender<()>>>>,
    current_port: Arc<Mutex<Option<u16>>>,
    lock_file: Arc<Mutex<Option<LockFile>>>,
    app_dir: PathBuf,
}

impl McpServer {
    pub fn new(
        config: Arc<Mutex<McpConfig>>,
        clipboard_manager: Arc<ClipboardManager>,
        app_dir: PathBuf,
    ) -> Self {
        let tools = ClipboardTools::new(clipboard_manager.clone());
        Self {
            config,
            clipboard_manager,
            tools,
            shutdown_tx: Arc::new(Mutex::new(None)),
            current_port: Arc::new(Mutex::new(None)),
            lock_file: Arc::new(Mutex::new(None)),
            app_dir,
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
                let port_manager = PortManager::new("clipbox");
                let mut attempts = 0;
                let max_attempts = 5;

                loop {
                    println!("[MCP] 尝试启动 HTTP 服务器 (端口: {})", port);

                    // 使用智能端口管理器
                    match port_manager.bind_port(port).await {
                        Ok(listener) => {
                            // 端口绑定成功，关闭测试监听器
                            drop(listener);

                            // 更新配置中的端口
                            let mut config = self.config.lock().await;
                            config.port = Some(port);
                            drop(config);

                            // 创建锁文件
                            match LockFile::new(&self.app_dir, port) {
                                Ok(lock) => {
                                    let mut lock_file = self.lock_file.lock().await;
                                    *lock_file = Some(lock);
                                }
                                Err(e) => {
                                    eprintln!("[MCP] 创建锁文件失败: {}", e);
                                }
                            }

                            // 启动实际的 HTTP 服务器
                            if let Err(e) = self.start_http_server(port).await {
                                return Err(format!("启动 HTTP 服务器失败: {}", e));
                            }

                            println!("[MCP] HTTP 服务器成功启动在端口: {}", port);
                            return Ok(());
                        }
                        Err(e) if attempts < max_attempts => {
                            println!("[MCP] 端口 {} 处理失败: {}，尝试下一个端口...", port, e);
                            port += 1;
                            attempts += 1;
                        }
                        Err(e) => {
                            return Err(format!("无法启动 MCP 服务器: {}", e));
                        }
                    }
                }
            }
            McpMode::Stdio => Err("GUI 应用不支持 stdio 模式，请使用 HTTP 模式".to_string()),
        }
    }

    /// 启动 HTTP 服务器（实际的 warp 服务）
    async fn start_http_server(&self, port: u16) -> Result<(), String> {
        let tools = self.tools.clone();

        // 创建关闭信号通道
        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();

        // 保存关闭句柄
        {
            let mut tx = self.shutdown_tx.lock().await;
            *tx = Some(shutdown_tx);
        }

        // 保存当前端口
        {
            let mut port_lock = self.current_port.lock().await;
            *port_lock = Some(port);
        }

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

        println!("[MCP] HTTP 服务器监听: http://{}", addr);

        // 启动服务器，支持优雅关闭
        tokio::spawn(async move {
            let (_, server) = warp::serve(routes).bind_with_graceful_shutdown(addr, async {
                shutdown_rx.await.ok();
                println!("[MCP] 收到关闭信号，正在优雅关闭服务器...");
            });

            server.await;
            println!("[MCP] 服务器已完全关闭");
        });

        Ok(())
    }

    /// 优雅关闭服务器
    pub async fn shutdown(&self) {
        println!("[MCP] 开始关闭 MCP 服务器...");

        // 发送关闭信号
        let mut tx = self.shutdown_tx.lock().await;
        if let Some(sender) = tx.take() {
            let _ = sender.send(());
            println!("[MCP] 已发送关闭信号");
        }

        // 等待端口释放
        tokio::time::sleep(tokio::time::Duration::from_millis(200)).await;

        // 清除锁文件
        let mut lock_file = self.lock_file.lock().await;
        if lock_file.take().is_some() {
            println!("[MCP] 锁文件已清理");
        }

        // 清除端口记录
        let mut port_lock = self.current_port.lock().await;
        if let Some(port) = port_lock.take() {
            println!("[MCP] 端口 {} 已释放", port);
        }

        println!("[MCP] MCP 服务器已完全关闭");
    }

    /// 获取当前运行端口
    pub async fn get_current_port(&self) -> Option<u16> {
        let port_lock = self.current_port.lock().await;
        *port_lock
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
        let tool_name = params["name"].as_str().ok_or("缺少工具名称")?;
        let arguments = params["arguments"].clone();

        match tools.call_tool(tool_name, arguments).await {
            Ok(result) => Ok(McpResponse::success(id, result)),
            Err(e) => Ok(McpResponse::error(id, -32000, e.to_string())),
        }
    }
}

/// 实现 Drop trait，确保资源释放
impl Drop for McpServer {
    fn drop(&mut self) {
        println!("[MCP] McpServer 正在销毁，触发清理逻辑...");
        // 注意：Drop 中不能使用 async，但我们可以尝试发送关闭信号
        // 实际的优雅关闭应该在 main.rs 中显式调用
    }
}
