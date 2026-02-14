# 单例与端口管理优化

## 问题背景

ClipBox 作为单例应用，在异常关闭后可能留下僵尸进程占用端口，导致重新启动时端口冲突。之前的简单递增端口号方案治标不治本。

## 解决方案

### 1. 应用级单例保护

**实现：** 使用 `tauri-plugin-single-instance` 插件

**效果：**
- 防止多个实例同时运行
- 尝试启动第二个实例时，自动聚焦到现有窗口
- 从根本上避免多实例冲突

**代码位置：** `src-tauri/src/main.rs:29`

```rust
.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
        let _ = window.unminimize();
    }
}))
```

### 2. 智能端口管理

**实现：** 新增 `PortManager` 模块

**功能：**
1. **端口占用检测** - 识别占用端口的进程 PID
2. **僵尸进程识别** - 判断是否是自己的残留进程
3. **自动清理** - 杀掉僵尸进程并重新绑定端口
4. **跨平台支持** - Windows/Linux/macOS 统一接口

**代码位置：** `src-tauri/src/mcp/port_manager.rs`

### 3. 优雅关闭机制

**实现：** 多层保障确保端口正确释放

**层级：**
1. **窗口关闭钩子** - 监听窗口关闭事件，主动关闭服务器
2. **Tauri 命令** - 提供前端主动关闭接口
3. **进程锁文件** - 记录端口占用信息，启动时自动清理
4. **Drop trait** - 对象销毁时的最后防线

**代码位置：**
- 窗口钩子: `src-tauri/src/main.rs:173`
- 关闭方法: `src-tauri/src/mcp/server.rs:shutdown()`
- 锁文件: `src-tauri/src/mcp/lock_file.rs`

### 4. 工作流程

```
启动应用
    ↓
单例检查 (Tauri Plugin)
    ↓ 已有实例？
    ├─ 是 → 聚焦现有窗口，退出
    └─ 否 → 继续启动
        ↓
检查旧锁文件
    ↓ 存在？
    ├─ 是 → 读取旧端口 → 删除锁文件
    └─ 否 → 继续
        ↓
尝试绑定端口 (PortManager)
    ↓ 端口被占用？
    ├─ 否 → 绑定成功 → 创建锁文件
    └─ 是 → 检测占用进程
        ↓ 是自己的僵尸进程？
        ├─ 是 → 杀掉进程 → 重新绑定 → 创建锁文件
        └─ 否 → 尝试下一个端口 (最多 5 次)
            ↓
        运行中...
            ↓
        关闭应用 (任意方式)
            ↓
        触发关闭钩子
            ↓
        发送关闭信号 → 等待服务器停止
            ↓
        清理锁文件 (Drop trait)
            ↓
        端口释放完成
```

## 技术细节

### 端口占用检测

**Windows:**
```bash
netstat -ano | findstr :<port>
```
解析输出获取 PID

**Linux/macOS:**
```bash
lsof -i :<port> -t
```
直接返回 PID

### 进程识别

使用 `sysinfo` crate 获取进程信息：
- 进程名称
- 进程路径
- 匹配应用名 "clipbox"

### 进程清理

**Windows:**
```bash
taskkill /F /PID <pid>
```

**Linux/macOS:**
```bash
kill -9 <pid>
```

## 配置

### 默认端口
`38470` (可在 `src-tauri/src/mcp/config.rs` 修改)

### 重试次数
最多尝试 5 个连续端口 (可在 `src-tauri/src/mcp/server.rs:48` 修改)

### 等待时间
清理进程后等待 500ms 让端口释放 (可在 `src-tauri/src/mcp/port_manager.rs:35` 修改)

## 依赖变更

### 新增依赖

**Cargo.toml:**
```toml
tauri-plugin-single-instance = "2"
sysinfo = "0.32"
```

## 测试场景

### 场景 1：正常启动
- 端口未占用
- 直接绑定成功

### 场景 2：僵尸进程占用
- 检测到自己的残留进程
- 自动清理并重新绑定
- 用户无感知

### 场景 3：其他程序占用
- 检测到非 ClipBox 进程
- 尝试下一个端口 (38471, 38472...)
- 最多尝试 5 次

### 场景 4：重复启动
- 单例插件拦截
- 聚焦现有窗口
- 不会启动第二个实例

## 日志输出

### 正常启动
```
[MCP] 尝试启动 HTTP 服务器 (端口: 38470)
[PortManager] 端口 38470 绑定成功
[LockFile] 锁文件已创建: "C:\Users\...\clipbox\mcp_server.lock" (PID: 12345, Port: 38470)
[MCP] HTTP 服务器成功启动在端口: 38470
```

### 检测到僵尸进程
```
[LockFile] 发现旧的锁文件: "C:\Users\...\clipbox\mcp_server.lock"
[LockFile] 旧锁文件记录的端口: 38470
[LockFile] 已删除旧锁文件
[MCP] 尝试启动 HTTP 服务器 (端口: 38470)
[PortManager] 端口 38470 被占用，开始检测占用进程...
[PortManager] 端口 38470 被进程 12345 占用
[PortManager] 进程 12345 名称: clipbox.exe
[PortManager] 检测到僵尸进程 12345，尝试清理...
[PortManager] 僵尸进程已清理，重新尝试绑定...
[PortManager] 端口 38470 绑定成功
[LockFile] 锁文件已创建: "C:\Users\...\clipbox\mcp_server.lock" (PID: 67890, Port: 38470)
[MCP] HTTP 服务器成功启动在端口: 38470
```

### 优雅关闭
```
[Shutdown] 窗口关闭事件触发
[MCP] 开始关闭 MCP 服务器...
[MCP] 已发送关闭信号
[MCP] 收到关闭信号，正在优雅关闭服务器...
[MCP] 服务器已完全关闭
[MCP] 锁文件已清理
[MCP] 端口 38470 已释放
[MCP] MCP 服务器已完全关闭
[LockFile] 锁文件已清理: "C:\Users\...\clipbox\mcp_server.lock"
```

### 重复启动
```
[SingleInstance] 检测到重复启动，已聚焦到现有窗口
```

## 优势

1. **用户体验** - 无需手动清理进程或修改配置
2. **稳定性** - 避免多实例冲突和资源竞争
3. **智能化** - 自动识别和处理异常情况
4. **跨平台** - 统一的处理逻辑
5. **可维护** - 模块化设计，易于扩展
6. **优雅关闭** - 多层保障确保资源正确释放

## 关闭方式支持

### 正常关闭
- 点击窗口关闭按钮
- 触发窗口关闭钩子
- 主动调用 `shutdown()` 方法
- 清理锁文件和端口

### 异常关闭
- 进程崩溃
- 强制结束 (Ctrl+C, 任务管理器)
- 锁文件残留
- 下次启动时自动检测并清理

### 前端主动关闭
```javascript
// 前端可以主动关闭 MCP 服务器
await invoke('shutdown_mcp_server');

// 查询当前运行端口
const port = await invoke('get_mcp_current_port');
```

## 新增 Tauri 命令

### shutdown_mcp_server
优雅关闭 MCP 服务器

**用途：** 前端主动关闭服务器，或在设置中禁用 MCP 时调用

### get_mcp_current_port
获取当前实际运行的端口

**用途：** 显示给用户，或用于调试

## 未来扩展

- 支持自定义端口范围
- 添加端口占用通知
- 记录端口切换历史
- 支持端口优先级配置
