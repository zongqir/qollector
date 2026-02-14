use std::fs::{File, OpenOptions};
use std::io::{Write, Read};
use std::path::PathBuf;

/// 进程锁文件管理器
pub struct LockFile {
    path: PathBuf,
    port: u16,
}

impl LockFile {
    /// 创建锁文件
    pub fn new(app_dir: &PathBuf, port: u16) -> Result<Self, String> {
        let path = app_dir.join("mcp_server.lock");

        // 检查是否存在旧的锁文件
        if path.exists() {
            println!("[LockFile] 发现旧的锁文件: {:?}", path);

            // 尝试读取旧的端口信息
            if let Ok(old_port) = Self::read_port(&path) {
                println!("[LockFile] 旧锁文件记录的端口: {}", old_port);
            }

            // 删除旧锁文件
            if let Err(e) = std::fs::remove_file(&path) {
                eprintln!("[LockFile] 无法删除旧锁文件: {}", e);
            } else {
                println!("[LockFile] 已删除旧锁文件");
            }
        }

        // 创建新的锁文件
        let mut file = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path)
            .map_err(|e| format!("无法创建锁文件: {}", e))?;

        // 写入当前进程 PID 和端口
        let pid = std::process::id();
        let content = format!("pid={}\nport={}\n", pid, port);
        file.write_all(content.as_bytes())
            .map_err(|e| format!("无法写入锁文件: {}", e))?;

        println!("[LockFile] 锁文件已创建: {:?} (PID: {}, Port: {})", path, pid, port);

        Ok(Self { path, port })
    }

    /// 读取锁文件中的端口
    fn read_port(path: &PathBuf) -> Result<u16, String> {
        let mut file = File::open(path)
            .map_err(|e| format!("无法打开锁文件: {}", e))?;

        let mut content = String::new();
        file.read_to_string(&mut content)
            .map_err(|e| format!("无法读取锁文件: {}", e))?;

        // 解析端口
        for line in content.lines() {
            if line.starts_with("port=") {
                if let Some(port_str) = line.strip_prefix("port=") {
                    return port_str.parse::<u16>()
                        .map_err(|e| format!("无法解析端口: {}", e));
                }
            }
        }

        Err("锁文件中未找到端口信息".to_string())
    }

    /// 获取端口
    pub fn port(&self) -> u16 {
        self.port
    }
}

/// 实现 Drop trait，自动清理锁文件
impl Drop for LockFile {
    fn drop(&mut self) {
        if self.path.exists() {
            if let Err(e) = std::fs::remove_file(&self.path) {
                eprintln!("[LockFile] 清理锁文件失败: {}", e);
            } else {
                println!("[LockFile] 锁文件已清理: {:?}", self.path);
            }
        }
    }
}
