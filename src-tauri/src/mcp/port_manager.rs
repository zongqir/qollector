use std::net::TcpListener;
use std::process::Command;
use sysinfo::{Pid, ProcessesToUpdate, System};

/// 端口管理器 - 处理端口占用和僵尸进程清理
pub struct PortManager {
    app_name: String,
}

impl PortManager {
    pub fn new(app_name: &str) -> Self {
        Self {
            app_name: app_name.to_string(),
        }
    }

    /// 尝试绑定端口，如果被占用则尝试清理
    pub async fn bind_port(&self, port: u16) -> Result<TcpListener, String> {
        // 第一次尝试直接绑定
        match TcpListener::bind(("127.0.0.1", port)) {
            Ok(listener) => {
                println!("[PortManager] 端口 {} 绑定成功", port);
                return Ok(listener);
            }
            Err(_) => {
                println!("[PortManager] 端口 {} 被占用，开始检测占用进程...", port);
            }
        }

        // 检测占用端口的进程
        match self.find_port_owner(port).await {
            Some(pid) => {
                println!("[PortManager] 端口 {} 被进程 {} 占用", port, pid);

                // 检查是否是自己的进程
                if self.is_own_process(pid).await {
                    println!("[PortManager] 检测到僵尸进程 {}，尝试清理...", pid);

                    if self.kill_process(pid).await {
                        println!("[PortManager] 僵尸进程已清理，重新尝试绑定...");

                        // 等待端口释放
                        tokio::time::sleep(tokio::time::Duration::from_millis(500)).await;

                        // 重新尝试绑定
                        return TcpListener::bind(("127.0.0.1", port))
                            .map_err(|e| format!("清理后仍无法绑定端口: {}", e));
                    } else {
                        return Err(format!("无法清理僵尸进程 {}", pid));
                    }
                } else {
                    return Err(format!("端口被其他程序占用 (PID: {})", pid));
                }
            }
            None => {
                return Err("无法检测占用端口的进程".to_string());
            }
        }
    }

    /// 查找占用端口的进程 ID
    async fn find_port_owner(&self, port: u16) -> Option<u32> {
        #[cfg(target_os = "windows")]
        {
            self.find_port_owner_windows(port).await
        }

        #[cfg(target_os = "linux")]
        {
            self.find_port_owner_linux(port).await
        }

        #[cfg(target_os = "macos")]
        {
            self.find_port_owner_macos(port).await
        }
    }

    #[cfg(target_os = "windows")]
    async fn find_port_owner_windows(&self, port: u16) -> Option<u32> {
        // 使用 netstat 查找端口占用
        let output = Command::new("netstat").args(&["-ano"]).output().ok()?;

        let output_str = String::from_utf8_lossy(&output.stdout);
        let port_str = format!(":{}", port);

        for line in output_str.lines() {
            if line.contains(&port_str) && line.contains("LISTENING") {
                // 提取 PID (最后一列)
                if let Some(pid_str) = line.split_whitespace().last() {
                    if let Ok(pid) = pid_str.parse::<u32>() {
                        return Some(pid);
                    }
                }
            }
        }

        None
    }

    #[cfg(target_os = "linux")]
    async fn find_port_owner_linux(&self, port: u16) -> Option<u32> {
        // 使用 lsof 或 ss 查找端口占用
        let output = Command::new("lsof")
            .args(&["-i", &format!(":{}", port), "-t"])
            .output()
            .ok()?;

        let output_str = String::from_utf8_lossy(&output.stdout);
        output_str.trim().parse::<u32>().ok()
    }

    #[cfg(target_os = "macos")]
    async fn find_port_owner_macos(&self, port: u16) -> Option<u32> {
        // macOS 使用 lsof
        let output = Command::new("lsof")
            .args(&["-i", &format!(":{}", port), "-t"])
            .output()
            .ok()?;

        let output_str = String::from_utf8_lossy(&output.stdout);
        output_str.trim().parse::<u32>().ok()
    }

    /// 检查进程是否是自己的应用
    async fn is_own_process(&self, pid: u32) -> bool {
        let mut system = System::new();
        system.refresh_processes(ProcessesToUpdate::All, true);

        if let Some(process) = system.process(Pid::from_u32(pid)) {
            let process_name = process.name().to_string_lossy().to_lowercase();
            let app_name_lower = self.app_name.to_lowercase();

            println!("[PortManager] 进程 {} 名称: {}", pid, process_name);

            // 检查进程名是否包含应用名
            return process_name.contains(&app_name_lower);
        }

        false
    }

    /// 杀掉进程
    async fn kill_process(&self, pid: u32) -> bool {
        #[cfg(target_os = "windows")]
        {
            Command::new("taskkill")
                .args(&["/F", "/PID", &pid.to_string()])
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
        }

        #[cfg(any(target_os = "linux", target_os = "macos"))]
        {
            Command::new("kill")
                .args(&["-9", &pid.to_string()])
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
        }
    }
}
