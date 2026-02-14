# 配置持久化实现

## 概述

所有应用配置（AI、OCR、MCP）现在都会自动保存到数据库中，重启应用后会自动加载。

## 实现细节

### 数据库表结构

新增 `app_config` 表：

```sql
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
)
```

### 配置键

- `ai_config` - AI 服务配置（供应商、API Key、模型等）
- `ocr_config` - OCR 服务配置（供应商、API Key、语言等）
- `mcp_config` - MCP 服务配置（启用状态、端口等）

### 配置仓库

新增 `ConfigRepository` (`src-tauri/src/repository/config_repo.rs`)：

- `save_ai_config()` - 保存 AI 配置
- `load_ai_config()` - 加载 AI 配置
- `save_ocr_config()` - 保存 OCR 配置
- `load_ocr_config()` - 加载 OCR 配置
- `save_mcp_config()` - 保存 MCP 配置
- `load_mcp_config()` - 加载 MCP 配置

### 启动流程

1. 初始化数据库和配置表
2. 从数据库加载配置，如果不存在则使用默认值
3. 根据配置初始化服务（OCR、MCP）
4. 将配置注入到各个 State 中

### 保存流程

当用户在设置页面点击"保存"时：

1. 前端调用 `update_*_config` 命令
2. 后端更新内存中的配置
3. 同步更新 ClipboardManager 中的配置
4. 调用 `ConfigRepository` 持久化到数据库

## 使用示例

### 前端

```javascript
// 保存 AI 配置
await invoke('update_ai_config', { config: aiConfig });

// 加载 AI 配置
const config = await invoke('get_ai_config');
```

### 后端

```rust
// 保存配置
state.config_repo.save_ai_config(&config).await?;

// 加载配置
let config = config_repo.load_ai_config().await?
    .unwrap_or_default();
```

## 配置文件位置

配置保存在应用数据目录的 `clipbox.db` 数据库中：

- Windows: `%APPDATA%\com.clipbox.app\clipbox.db`
- macOS: `~/Library/Application Support/com.clipbox.app/clipbox.db`
- Linux: `~/.local/share/com.clipbox.app/clipbox.db`

## 注意事项

1. 配置以 JSON 格式存储在数据库中
2. API Key 等敏感信息存储在本地数据库，不会上传到云端
3. 如果配置损坏，应用会自动使用默认配置
4. 语言设置仍然使用 localStorage（前端）
